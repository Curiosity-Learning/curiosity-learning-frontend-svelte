import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { dispatchNotification } from './notificationsModel';
import { getProfileByAuthUserId, requireGlobalAdmin } from './permissions';

// PRD 6.14.4/6.14.7 (CL-730): admin moderation queue, content takedown, user suspension, and
// minimal user/club management. v1 is deliberately pragmatic — audit logging is deferred, this
// only appends lightweight `moderationActions` records (see recordAction below). Every export in
// this file must call `requireGlobalAdmin` first, following the `admin.ts` template.

const recordAction = async (
	ctx: MutationCtx,
	actorProfileId: Id<'profiles'>,
	action: Doc<'moderationActions'>['action'],
	targetType: Doc<'moderationActions'>['targetType'],
	targetId: string,
	reason?: string
) => {
	await ctx.db.insert('moderationActions', {
		actorProfileId,
		action,
		targetType,
		targetId,
		reason,
		createdAt: Date.now()
	});
};

const requireAdminProfile = async (ctx: MutationCtx) => {
	const identity = await requireGlobalAdmin(ctx);
	const profile = await getProfileByAuthUserId(ctx, identity.subject);
	if (!profile) {
		throw new ConvexError('Profile not found');
	}
	return profile;
};

// ---------------------------------------------------------------------------
// Moderation queue (PRD 6.14.4): open reports + flagged media, newest first.
// ---------------------------------------------------------------------------

type QueueReportItem = {
	kind: 'report';
	reportId: Id<'reports'>;
	category: Doc<'reports'>['category'];
	targetType: Doc<'reports'>['targetType'];
	targetId: string;
	contextText: string | null;
	reporterProfileId: Id<'profiles'>;
	reporterName: string;
	createdAt: number;
};

type QueueMediaItem = {
	kind: 'flagged_media';
	mediaAssetId: Id<'mediaAssets'>;
	ownerUserId: string;
	mediaKind: Doc<'mediaAssets'>['mediaKind'];
	moderationLabels: Doc<'mediaAssets'>['moderation'];
	createdAt: number;
};

export type ModerationQueueItem = QueueReportItem | QueueMediaItem;

const profileDisplayName = (profile: Doc<'profiles'> | null) => {
	if (!profile) return 'Unknown';
	const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
	return fullName || profile.username || 'Unknown';
};

export const listQueue = query({
	args: {},
	handler: async (ctx): Promise<ModerationQueueItem[]> => {
		await requireGlobalAdmin(ctx);

		const openReports = await ctx.db
			.query('reports')
			.withIndex('by_status_and_created', (q) => q.eq('status', 'open'))
			.collect();

		const reportItems: QueueReportItem[] = await Promise.all(
			openReports.map(async (report) => {
				const reporter = await ctx.db.get(report.reporterProfileId);
				return {
					kind: 'report' as const,
					reportId: report._id,
					category: report.category,
					targetType: report.targetType,
					targetId: report.targetId,
					contextText: report.contextText ?? null,
					reporterProfileId: report.reporterProfileId,
					reporterName: profileDisplayName(reporter),
					createdAt: report.createdAt
				};
			})
		);

		const flaggedMedia = await ctx.db
			.query('mediaAssets')
			.withIndex('by_moderation_status', (q) => q.eq('moderation.status', 'flagged'))
			.collect();

		const mediaItems: QueueMediaItem[] = flaggedMedia
			// Already-reviewed assets are dismissed but keep `moderation.status: 'flagged'` history
			// unless explicitly re-scanned; `moderationReviewedAt` is what actually removes them
			// from the open queue.
			.filter((asset) => !asset.moderationReviewedAt)
			.map((asset) => ({
				kind: 'flagged_media' as const,
				mediaAssetId: asset._id,
				ownerUserId: asset.ownerUserId,
				mediaKind: asset.mediaKind,
				moderationLabels: asset.moderation,
				createdAt: asset.createdAt
			}));

		return [...reportItems, ...mediaItems].sort((a, b) => b.createdAt - a.createdAt);
	}
});

export const listRecentActions = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		await requireGlobalAdmin(ctx);
		const limit = Math.min(args.limit ?? 20, 50);
		const actions = await ctx.db.query('moderationActions').withIndex('by_created').order('desc').take(limit);
		return await Promise.all(
			actions.map(async (action) => {
				const actor = await ctx.db.get(action.actorProfileId);
				return {
					...action,
					actorName: profileDisplayName(actor)
				};
			})
		);
	}
});

// ---------------------------------------------------------------------------
// Report transitions: dismiss / escalate / takedown-and-action.
// ---------------------------------------------------------------------------

const requireOpenReport = async (ctx: MutationCtx, reportId: Id<'reports'>) => {
	const report = await ctx.db.get(reportId);
	if (!report) {
		throw new ConvexError('Report not found');
	}
	if (report.status !== 'open') {
		throw new ConvexError('Report is not open');
	}
	return report;
};

export const dismissReport = mutation({
	args: { reportId: v.id('reports'), note: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const admin = await requireAdminProfile(ctx);
		const report = await requireOpenReport(ctx, args.reportId);

		await ctx.db.patch(report._id, {
			status: 'dismissed',
			resolvedAt: Date.now(),
			resolvedByProfileId: admin._id,
			resolutionNote: args.note?.trim() || undefined
		});
		await recordAction(ctx, admin._id, 'dismiss_report', 'report', report._id, args.note);
		return { ok: true as const };
	}
});

export const escalateReport = mutation({
	args: { reportId: v.id('reports'), note: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const admin = await requireAdminProfile(ctx);
		const report = await requireOpenReport(ctx, args.reportId);

		await ctx.db.patch(report._id, {
			status: 'escalated',
			resolvedAt: Date.now(),
			resolvedByProfileId: admin._id,
			resolutionNote: args.note?.trim() || undefined
		});
		await recordAction(ctx, admin._id, 'escalate_report', 'report', report._id, args.note);
		return { ok: true as const };
	}
});

// Marks the underlying report (if any) tied to this target as 'actioned'. Best-effort: a piece
// of content can be taken down without an originating report (e.g. from flagged media), so this
// silently no-ops if no matching open report exists.
const markReportsActionedForTarget = async (
	ctx: MutationCtx,
	targetType: Doc<'reports'>['targetType'],
	targetId: string,
	adminProfileId: Id<'profiles'>
) => {
	const openReports = await ctx.db
		.query('reports')
		.withIndex('by_status_and_created', (q) => q.eq('status', 'open'))
		.collect();
	for (const report of openReports) {
		if (report.targetType !== targetType || report.targetId !== targetId) continue;
		await ctx.db.patch(report._id, {
			status: 'actioned',
			resolvedAt: Date.now(),
			resolvedByProfileId: adminProfileId
		});
	}
};

export const takedownUpdate = mutation({
	args: { updateId: v.id('updates'), reason: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const admin = await requireAdminProfile(ctx);
		const update = await ctx.db.get(args.updateId);
		if (!update) {
			throw new ConvexError('Update not found');
		}
		if (update.takedown) {
			return { ok: true as const };
		}

		await ctx.db.patch(update._id, {
			takedown: { byProfileId: admin._id, at: Date.now(), reason: args.reason?.trim() || undefined }
		});
		await recordAction(ctx, admin._id, 'takedown_update', 'update', update._id, args.reason);
		await markReportsActionedForTarget(ctx, 'project_update', update._id, admin._id);
		return { ok: true as const };
	}
});

export const takedownComment = mutation({
	args: { commentId: v.id('updateComments'), reason: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const admin = await requireAdminProfile(ctx);
		const comment = await ctx.db.get(args.commentId);
		if (!comment) {
			throw new ConvexError('Comment not found');
		}
		if (comment.takedown) {
			return { ok: true as const };
		}

		await ctx.db.patch(comment._id, {
			takedown: { byProfileId: admin._id, at: Date.now(), reason: args.reason?.trim() || undefined }
		});
		await recordAction(ctx, admin._id, 'takedown_comment', 'comment', comment._id, args.reason);
		await markReportsActionedForTarget(ctx, 'comment', comment._id, admin._id);
		return { ok: true as const };
	}
});

export const takedownProject = mutation({
	args: { projectId: v.id('projects'), reason: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const admin = await requireAdminProfile(ctx);
		const project = await ctx.db.get(args.projectId);
		if (!project) {
			throw new ConvexError('Project not found');
		}
		if (project.takedown) {
			return { ok: true as const };
		}

		await ctx.db.patch(project._id, {
			takedown: { byProfileId: admin._id, at: Date.now(), reason: args.reason?.trim() || undefined }
		});
		await recordAction(ctx, admin._id, 'takedown_project', 'project', project._id, args.reason);
		await markReportsActionedForTarget(ctx, 'project_update', project._id, admin._id);
		return { ok: true as const };
	}
});

export const takedownMessage = mutation({
	args: { messageId: v.id('messages'), reason: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const admin = await requireAdminProfile(ctx);
		const message = await ctx.db.get(args.messageId);
		if (!message) {
			throw new ConvexError('Message not found');
		}
		if (message.removedByModeration) {
			return { ok: true as const };
		}

		await ctx.db.patch(message._id, {
			removedByModeration: {
				byProfileId: admin._id,
				at: Date.now(),
				reason: args.reason?.trim() || undefined
			}
		});
		await recordAction(ctx, admin._id, 'takedown_message', 'message', message._id, args.reason);
		await markReportsActionedForTarget(ctx, 'chat_message', message._id, admin._id);
		return { ok: true as const };
	}
});

export const dismissFlaggedMedia = mutation({
	args: { mediaAssetId: v.id('mediaAssets'), note: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const admin = await requireAdminProfile(ctx);
		const asset = await ctx.db.get(args.mediaAssetId);
		if (!asset) {
			throw new ConvexError('Media asset not found');
		}

		await ctx.db.patch(asset._id, {
			moderationReviewedAt: Date.now(),
			moderationReviewedByProfileId: admin._id,
			moderationReviewNote: args.note?.trim() || undefined
		});
		await recordAction(ctx, admin._id, 'dismiss_flagged_media', 'media_asset', asset._id, args.note);
		return { ok: true as const };
	}
});

// ---------------------------------------------------------------------------
// User suspension (PRD 6.14.7).
// ---------------------------------------------------------------------------

export const suspendUser = mutation({
	args: { profileId: v.id('profiles'), reason: v.string() },
	handler: async (ctx, args) => {
		const admin = await requireAdminProfile(ctx);
		const target = await ctx.db.get(args.profileId);
		if (!target) {
			throw new ConvexError('Profile not found');
		}
		if (target.suspendedAt) {
			return { ok: true as const };
		}
		const reason = args.reason.trim();
		if (!reason) {
			throw new ConvexError('A suspension reason is required');
		}

		await ctx.db.patch(target._id, {
			suspendedAt: Date.now(),
			suspendedReason: reason,
			updatedAt: Date.now()
		});
		await recordAction(ctx, admin._id, 'suspend_user', 'profile', target._id, reason);

		// PRD 6.13.2: suspension notices are critical-tier — always delivered in-app + email,
		// ignoring mute preferences.
		await dispatchNotification(ctx, {
			recipientProfileId: target._id,
			kind: 'account_suspended',
			title: 'Your account has been suspended',
			message: reason,
			url: '/'
		});

		return { ok: true as const };
	}
});

export const unsuspendUser = mutation({
	args: { profileId: v.id('profiles') },
	handler: async (ctx, args) => {
		const admin = await requireAdminProfile(ctx);
		const target = await ctx.db.get(args.profileId);
		if (!target) {
			throw new ConvexError('Profile not found');
		}
		if (!target.suspendedAt) {
			return { ok: true as const };
		}

		await ctx.db.patch(target._id, {
			suspendedAt: undefined,
			suspendedReason: undefined,
			updatedAt: Date.now()
		});
		await recordAction(ctx, admin._id, 'unsuspend_user', 'profile', target._id);

		await dispatchNotification(ctx, {
			recipientProfileId: target._id,
			kind: 'account_unsuspended',
			title: 'Your account has been reinstated',
			message: 'Your account is no longer suspended. Welcome back!',
			url: '/'
		});

		return { ok: true as const };
	}
});

// PRD 6.14.7: /admin/users search + list, extending profiles.searchByUsername with admin-only
// suspension/role state (not exposed to the regular member-facing endpoint).
export const searchUsers = query({
	args: { usernamePrefix: v.string() },
	handler: async (ctx, args) => {
		await requireGlobalAdmin(ctx);
		const prefix = args.usernamePrefix.trim().toLowerCase();
		if (!prefix) {
			return [];
		}

		const matches = await ctx.db
			.query('profiles')
			.withIndex('by_username', (q) => q.gte('username', prefix).lt('username', `${prefix}￿`))
			.take(25);

		return matches.map((profile) => ({
			profileId: profile._id,
			firstName: profile.firstName ?? null,
			lastName: profile.lastName ?? null,
			username: profile.username ?? null,
			globalRole: profile.globalRole ?? null,
			suspendedAt: profile.suspendedAt ?? null,
			suspendedReason: profile.suspendedReason ?? null
		}));
	}
});

// ---------------------------------------------------------------------------
// Minimal club override (PRD 6.14.4): admin-gated variant of clubs.updateClub for
// name/description/discoverable only. Deliberately does not touch codes/location/video — v1
// scope is a moderation override valve, not full club management.
// ---------------------------------------------------------------------------

// No name index exists on `clubs` (see schema.ts) — this is a small-table scan-and-filter, which
// is fine at current data volume and matches `admin.getOverviewCounts`'s existing precedent of
// `.collect()`-ing whole tables for admin-only reads.
export const searchClubs = query({
	args: { namePrefix: v.string() },
	handler: async (ctx, args) => {
		await requireGlobalAdmin(ctx);
		const prefix = args.namePrefix.trim().toLowerCase();
		if (!prefix) {
			return [];
		}
		const clubs = await ctx.db.query('clubs').collect();
		return clubs
			.filter((club) => club.name.toLowerCase().includes(prefix))
			.slice(0, 25)
			.map((club) => ({
				clubId: club._id,
				name: club.name,
				description: club.description ?? null,
				discoverable: club.discoverable
			}));
	}
});

export const adminUpdateClub = mutation({
	args: {
		clubId: v.id('clubs'),
		name: v.optional(v.string()),
		description: v.optional(v.union(v.string(), v.null())),
		discoverable: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const admin = await requireAdminProfile(ctx);
		const club = await ctx.db.get(args.clubId);
		if (!club) {
			throw new ConvexError('Club not found');
		}

		const nextName = args.name !== undefined ? args.name.trim() || club.name : club.name;
		const nextDescription =
			args.description === undefined
				? club.description
				: (args.description?.trim() || undefined);

		await ctx.db.patch(args.clubId, {
			name: nextName,
			description: nextDescription,
			discoverable: args.discoverable ?? club.discoverable,
			updatedAt: Date.now()
		});
		await recordAction(ctx, admin._id, 'update_club', 'club', args.clubId);

		return await ctx.db.get(args.clubId);
	}
});
