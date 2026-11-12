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
	ownerProfileId: Id<'profiles'> | null;
	ownerName: string;
	mediaKind: Doc<'mediaAssets'>['mediaKind'];
	moderationLabels: Doc<'mediaAssets'>['moderation'];
	originalFilename: string | null;
	contentType: string | null;
	sizeBytes: number | null;
	status: Doc<'mediaAssets'>['status'];
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

		const mediaItems: QueueMediaItem[] = await Promise.all(
			flaggedMedia
				// Already-reviewed assets are dismissed but keep `moderation.status: 'flagged'` history
				// unless explicitly re-scanned; `moderationReviewedAt` is what actually removes them
				// from the open queue.
				.filter((asset) => !asset.moderationReviewedAt)
				.map(async (asset) => {
					const owner = await getProfileByAuthUserId(ctx, asset.ownerUserId);
					return {
						kind: 'flagged_media' as const,
						mediaAssetId: asset._id,
						ownerUserId: asset.ownerUserId,
						ownerProfileId: owner?._id ?? null,
						ownerName: profileDisplayName(owner),
						mediaKind: asset.mediaKind,
						moderationLabels: asset.moderation,
						originalFilename: asset.originalFilename ?? null,
						contentType: asset.contentType ?? asset.clientContentType ?? null,
						sizeBytes: asset.sizeBytes ?? asset.clientSizeBytes ?? null,
						status: asset.status,
						createdAt: asset.createdAt
					};
				})
		);

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

// Shared shape for the takedown/removal stamp written to `updates.takedown`,
// `updateComments.takedown`, `projects.takedown`, and `messages.removedByModeration` — all four
// tables use the identical { byProfileId, at, reason } object (see schema.ts), just under two
// different field names ('takedown' vs. the messages table's 'removedByModeration').
type TakedownStamp = { byProfileId: Id<'profiles'>; at: number; reason?: string };
type Takedownable = { _id: string; takedown?: TakedownStamp; removedByModeration?: TakedownStamp };

// Generic backbone for the four admin "take this content down" mutations below: fetch the
// entity, no-op if it's already taken down, stamp the takedown/removal field, record the
// moderation action, and mark any matching open report(s) as actioned. Parameterized by table +
// field name + targetType/action so each public mutation stays a thin wrapper around its own
// argument validator and entity type.
const applyTakedown = async <TableName extends 'updates' | 'updateComments' | 'projects' | 'messages'>(
	ctx: MutationCtx,
	config: {
		table: TableName;
		id: Id<TableName>;
		field: 'takedown' | 'removedByModeration';
		notFoundMessage: string;
		// `moderationActions.targetType` and `reports.targetType` are two DIFFERENT string unions
		// (see schema.ts) that happen to share some literals — e.g. an update's takedown is
		// recorded as moderationActions targetType 'update' but resolves 'project_update' reports.
		// Kept as separate config fields (rather than one shared `targetType`) so each is checked
		// against its own union instead of silently widening to `string`.
		action: Doc<'moderationActions'>['action'];
		moderationTargetType: Doc<'moderationActions'>['targetType'];
		// null when this content type has no corresponding `reports.targetType` of its own (e.g.
		// projects — reports only ever target a project's *updates* as 'project_update', never
		// the project itself), so the generic report-resolution step is skipped.
		reportTargetType: Doc<'reports'>['targetType'] | null;
		reason?: string;
		// takedownProject's extra step: resolve every open report against the project's own
		// updates too, since 'project_update' reports carry an *update* id as their targetId,
		// never a project id (see the doc comment on the call site below).
		afterTakedown?: (ctx: MutationCtx, admin: Doc<'profiles'>) => Promise<void>;
	}
) => {
	const admin = await requireAdminProfile(ctx);
	const entity = (await ctx.db.get(config.id)) as Takedownable | null;
	if (!entity) {
		throw new ConvexError(config.notFoundMessage);
	}
	if (entity[config.field]) {
		return { ok: true as const };
	}

	await ctx.db.patch(config.id, {
		[config.field]: {
			byProfileId: admin._id,
			at: Date.now(),
			reason: config.reason?.trim() || undefined
		}
	} as Partial<Doc<TableName>>);
	await recordAction(ctx, admin._id, config.action, config.moderationTargetType, entity._id, config.reason);
	if (config.reportTargetType) {
		await markReportsActionedForTarget(ctx, config.reportTargetType, entity._id, admin._id);
	}
	if (config.afterTakedown) {
		await config.afterTakedown(ctx, admin);
	}
	return { ok: true as const };
};

export const takedownUpdate = mutation({
	args: { updateId: v.id('updates'), reason: v.optional(v.string()) },
	handler: (ctx, args) =>
		applyTakedown(ctx, {
			table: 'updates',
			id: args.updateId,
			field: 'takedown',
			notFoundMessage: 'Update not found',
			action: 'takedown_update',
			moderationTargetType: 'update',
			reportTargetType: 'project_update',
			reason: args.reason
		})
});

export const takedownComment = mutation({
	args: { commentId: v.id('updateComments'), reason: v.optional(v.string()) },
	handler: (ctx, args) =>
		applyTakedown(ctx, {
			table: 'updateComments',
			id: args.commentId,
			field: 'takedown',
			notFoundMessage: 'Comment not found',
			action: 'takedown_comment',
			moderationTargetType: 'comment',
			reportTargetType: 'comment',
			reason: args.reason
		})
});

export const takedownProject = mutation({
	args: { projectId: v.id('projects'), reason: v.optional(v.string()) },
	handler: (ctx, args) =>
		applyTakedown(ctx, {
			table: 'projects',
			id: args.projectId,
			field: 'takedown',
			notFoundMessage: 'Project not found',
			action: 'takedown_project',
			moderationTargetType: 'project',
			reportTargetType: null,
			reason: args.reason,
			// 'project_update' reports carry an *update* id as their targetId (see takedownUpdate
			// above), never a project id — so taking down a project must resolve every open report
			// against that project's updates, not one (nonexistent) report keyed by the project id
			// itself.
			afterTakedown: async (ctx, admin) => {
				const projectUpdates = await ctx.db
					.query('updates')
					.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
					.collect();
				for (const update of projectUpdates) {
					await markReportsActionedForTarget(ctx, 'project_update', update._id, admin._id);
				}
			}
		})
});

export const takedownMessage = mutation({
	args: { messageId: v.id('messages'), reason: v.optional(v.string()) },
	handler: (ctx, args) =>
		applyTakedown(ctx, {
			table: 'messages',
			id: args.messageId,
			field: 'removedByModeration',
			notFoundMessage: 'Message not found',
			action: 'takedown_message',
			moderationTargetType: 'message',
			reportTargetType: 'chat_message',
			reason: args.reason
		})
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

// Delivery half of the flagged-media preview: the object key the admin portal's signing action
// (moderationNode.getFlaggedMediaSignedUrl) turns into a CloudFront-signed URL. Same split as
// clubApplications.getApplicationVideoDeliveryAsset / clubApplicationsNode. No status gate —
// a flagged asset is exactly what an admin needs to see, ready or not, so serve the processed
// rendition when it exists and fall back to the original upload.
export const getFlaggedMediaDeliveryAsset = query({
	args: { mediaAssetId: v.id('mediaAssets') },
	handler: async (ctx, args) => {
		await requireGlobalAdmin(ctx);
		const asset = await ctx.db.get(args.mediaAssetId);
		if (!asset) {
			return null;
		}
		return {
			assetId: asset._id,
			storageProvider: asset.storageProvider,
			deliveryBucket: asset.processedBucket ?? asset.sourceBucket ?? null,
			deliveryObjectKey: asset.processedObjectKey ?? asset.sourceObjectKey ?? null,
			mediaKind: asset.mediaKind ?? null,
			contentType: asset.contentType ?? asset.clientContentType ?? null,
			durationSeconds: asset.durationSeconds ?? null
		};
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
// is fine at current data volume and matches `admin.getDashboardOverview`'s existing precedent of
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
