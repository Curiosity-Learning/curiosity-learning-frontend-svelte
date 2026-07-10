import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import {
	getMembershipByProfileId,
	hasPermission,
	getProjectRoleByKey,
	getRelatedProfile,
	isProjectPermissionAllowed,
	listMembershipsForProfile,
	requireIdentity,
	requireProfile
} from './permissions';
import { ensureProjectRoom } from './chatModel';
import {
	assertNotDoneMember,
	canViewProject,
	getProjectMemberState,
	insertProjectChangeLog,
	isProjectArchived,
	requireOwnProjectMembership
} from './projectsModel';

const memberDisplayName = (member: {
	firstName?: string | null;
	lastName?: string | null;
	username?: string | null;
}) => [member.firstName ?? '', member.lastName ?? ''].join(' ').trim() || member.username || 'A member';

// Mirrors clubs.ts's `requireOwnedReadyClubVideo` pattern for the `projectCover` media-field
// kind: the asset must belong to the caller and be a fully-processed image before it can be
// attached as a project's cover.
const requireOwnedReadyProjectCover = async (
	ctx: MutationCtx,
	userId: string,
	assetId: Id<'mediaAssets'>
) => {
	const asset = await ctx.db.get(assetId);
	if (!asset || asset.ownerUserId !== userId) {
		throw new ConvexError('Cover image not found');
	}
	if (asset.status !== 'ready') {
		throw new ConvexError('Cover image is not ready');
	}
	if (asset.mediaKind !== 'image') {
		throw new ConvexError('Cover image must be an image');
	}

	return asset;
};

export const listByClub = query({
	args: {
		clubId: v.id('clubs')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const canRead = await hasPermission(ctx, args.clubId, identity.subject, 'project:read');
		if (!canRead) {
			throw new ConvexError('Permission denied');
		}

		const attributionRows = await ctx.db
			.query('projectAttributions')
			.withIndex('by_club', (q) => q.eq('clubId', args.clubId))
			.collect();
		const projectIds = [...new Set(attributionRows.map((row) => row.projectId))];

		const projects = await Promise.all(projectIds.map((projectId) => ctx.db.get(projectId)));
		return projects.filter((project): project is NonNullable<typeof project> => Boolean(project));
	}
});

export const countForViewer = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const memberships = await listMembershipsForProfile(ctx, profile);
		const activeMemberships = memberships.filter((membership) => !membership.leftAt);
		const seen = new Set<Id<'projects'>>();

		for (const membership of activeMemberships) {
			const canRead = await hasPermission(ctx, membership.clubId, identity.subject, 'project:read');
			if (!canRead) continue;

			const attributionRows = await ctx.db
				.query('projectAttributions')
				.withIndex('by_club', (q) => q.eq('clubId', membership.clubId))
				.collect();
			for (const row of attributionRows) {
				seen.add(row.projectId);
			}
		}

		return seen.size;
	}
});

export const listPreviewsByClub = query({
	args: {
		clubId: v.id('clubs'),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const canRead = await hasPermission(ctx, args.clubId, identity.subject, 'project:read');
		if (!canRead) {
			throw new ConvexError('Permission denied');
		}

		const attributionRows = await ctx.db
			.query('projectAttributions')
			.withIndex('by_club', (q) => q.eq('clubId', args.clubId))
			.collect();
		const projectIds = [...new Set(attributionRows.map((row) => row.projectId))];

		const projects = (await Promise.all(projectIds.map((projectId) => ctx.db.get(projectId)))).filter(
			(project): project is NonNullable<typeof project> => Boolean(project)
		);

		const result: Array<{
			project: (typeof projects)[number];
			members: Array<{
				name: string;
				imageUrl: string | null;
				profileImageMediaAssetId: Id<'mediaAssets'> | null;
			}>;
			// PRD 6.6.7: Showcase = archived OR zero active (not-left, not-done) members left in
			// this club's view of the project. `projects.archivedAt` alone isn't enough once every
			// member has left without ever marking done.
			isShowcase: boolean;
		}> = [];

		for (const project of projects) {
			const memberships = await ctx.db
				.query('projectMembers')
				.withIndex('by_project', (q) => q.eq('projectId', project._id))
				.collect();
			const currentMemberships = memberships.filter((membership) => !membership.leftAt);
			const activeMemberships = currentMemberships.filter((membership) => !membership.doneDate);
			const archived = Boolean(project.archivedAt) || (await isProjectArchived(ctx, project._id));

			// PRD 6.6.7: Current = attributed to this club AND >=1 ACTIVE project member (any
			// active member, not just ones who personally attributed here) is currently a member
			// of this club. Showcase = attributed AND (archived OR zero active members in this
			// club). Checked per active member's club membership rather than reusing the
			// attribution rows, since attribution and current club membership can diverge (e.g. a
			// member attributed the project here but has since left the club, while a different
			// active member who never attributed is still in the club).
			let hasActiveMemberInClub = false;
			for (const membership of activeMemberships) {
				const clubMembership = await getMembershipByProfileId(ctx, args.clubId, membership.profileId);
				if (clubMembership) {
					hasActiveMemberInClub = true;
					break;
				}
			}
			const isShowcase = archived || !hasActiveMemberInClub;

			const previewMembers = currentMemberships.slice(0, 3);
			const members = await Promise.all(
				previewMembers.map(async (membership) => {
					const profile = await getRelatedProfile(ctx, membership.profileId);
					const fullName = [membership.firstName, membership.lastName]
						.filter(Boolean)
						.join(' ')
						.trim();
					const name = fullName || membership.username || 'Project member';
					return {
						name,
						imageUrl: null,
						profileImageMediaAssetId: profile?.profileImageMediaAssetId ?? null
					};
				})
			);

			result.push({ project, members, isShowcase });
		}

		result.sort((a, b) => (a.project.dueDate ?? 0) - (b.project.dueDate ?? 0));
		const limit = args.limit ?? result.length;
		return result.slice(0, Math.max(0, limit));
	}
});

export const getById = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		// PRD 6.6.2/6.6.11: visibility governs direct access. 'global' → any authenticated user;
		// 'clubs' → members of attributed clubs or the project's own members. This is the primary
		// read gate for a specific project; role-permission checks (`isProjectPermissionAllowed`)
		// remain for action-scoped mutations/queries below.
		const canView = await canViewProject(ctx, args.projectId, identity.subject);
		if (!canView) {
			throw new ConvexError('Permission denied');
		}

		const project = await ctx.db.get(args.projectId);
		if (!project) {
			throw new ConvexError('Project not found');
		}
		return project;
	}
});

export const create = mutation({
	args: {
		// PRD 5.11/6.6.2/6.6.6: attribution is optional and per-member from the start — a project
		// can be created with zero club attribution. When provided, the creator's own attribution
		// row for that club is created alongside the project (defaults handled client-side: the
		// dashboard context club, or the caller's sole club, per 6.6.2's "Club attribution
		// defaults").
		clubId: v.optional(v.id('clubs')),
		name: v.string(),
		description: v.optional(v.string()),
		dueDate: v.number(),
		// PRD 6.6.2: visibility toggle is required at creation, default TBD by the PRD itself —
		// we default new projects to 'clubs' (the safer, more restrictive option) when omitted.
		// This default is a CEO-decision item, not an engineering one; flagging for follow-up.
		visibility: v.optional(v.union(v.literal('clubs'), v.literal('global'))),
		coverImageMediaAssetId: v.optional(v.id('mediaAssets'))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);

		if (args.clubId) {
			const canCreate = await hasPermission(ctx, args.clubId, identity.subject, 'project:create');
			if (!canCreate) {
				throw new ConvexError('Permission denied');
			}
		} else {
			// No club context: PRD 6.6.2 "Any Learner or Guide can create a project" — require the
			// caller to hold `project:create` in at least one of their current club memberships,
			// same bar as creating from within a specific club dashboard.
			const profile = await requireProfile(ctx, identity.subject);
			const memberships = await listMembershipsForProfile(ctx, profile);
			const activeMemberships = memberships.filter((membership) => !membership.leftAt);
			let canCreate = false;
			for (const membership of activeMemberships) {
				if (await hasPermission(ctx, membership.clubId, identity.subject, 'project:create')) {
					canCreate = true;
					break;
				}
			}
			if (!canCreate) {
				throw new ConvexError('Permission denied');
			}
		}

		const profile = await requireProfile(ctx, identity.subject);

		if (args.coverImageMediaAssetId) {
			await requireOwnedReadyProjectCover(ctx, identity.subject, args.coverImageMediaAssetId);
		}

		const now = Date.now();
		const projectId = await ctx.db.insert('projects', {
			name: args.name,
			description: args.description,
			dueDate: args.dueDate,
			visibility: args.visibility ?? 'clubs',
			coverImageMediaAssetId: args.coverImageMediaAssetId,
			createdByProfileId: profile._id,
			createdAt: now,
			updatedAt: now
		});
		await ensureProjectRoom(ctx, projectId);

		if (args.clubId) {
			await ctx.db.insert('projectAttributions', {
				projectId,
				profileId: profile._id,
				clubId: args.clubId,
				createdAt: now
			});
		}

		const creatorRole = await getProjectRoleByKey(ctx, 'creator');
		if (creatorRole) {
			await ctx.db.insert('projectMembers', {
				projectId,
				profileId: profile._id,
				roleId: creatorRole._id,
				firstName: profile.firstName,
				lastName: profile.lastName,
				username: profile.username,
				coverPhotoUrl: profile.coverPhotoUrl,
				createdAt: now
			});
			await insertProjectChangeLog(ctx, {
				projectId,
				actorProfileId: profile._id,
				entryType: 'member_joined',
				text: `${memberDisplayName(profile)} created the project`
			});
		}

		return await ctx.db.get(projectId);
	}
});

export const update = mutation({
	args: {
		projectId: v.id('projects'),
		name: v.optional(v.string()),
		description: v.optional(v.string()),
		dueDate: v.optional(v.number()),
		visibility: v.optional(v.union(v.literal('clubs'), v.literal('global'))),
		// v.null() lets the caller explicitly clear the cover image; omitting the field leaves it
		// untouched (same convention as `clubs.updateClub`'s optional-nullable fields).
		coverImageMediaAssetId: v.optional(v.union(v.id('mediaAssets'), v.null()))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		// PRD 6.6.1/6.6.8: collectively owned — any ACTIVE project member may edit metadata, with
		// no special rights for the creator. `isProjectPermissionAllowed` also allows club-level
		// permission holders (e.g. a Guide with `project:update` who isn't a project member) by
		// design; `assertNotDoneMember` below is a no-op for those callers and only blocks an
		// existing Done membership.
		const canUpdate = await isProjectPermissionAllowed(
			ctx,
			args.projectId,
			identity.subject,
			'project:update'
		);
		if (!canUpdate) {
			throw new ConvexError('Permission denied');
		}
		// PRD 6.6.4: Done members cannot edit project metadata or change attribution.
		await assertNotDoneMember(ctx, args.projectId, identity.subject);

		const project = await ctx.db.get(args.projectId);
		if (!project) {
			throw new ConvexError('Project not found');
		}

		if (args.coverImageMediaAssetId) {
			await requireOwnedReadyProjectCover(ctx, identity.subject, args.coverImageMediaAssetId);
		}

		const actorProfile = await requireProfile(ctx, identity.subject);
		const actorName = memberDisplayName(actorProfile);

		// PRD 6.6.8: every metadata change writes an immutable change-log entry, with the prior
		// value included where cheap.
		if (args.name !== undefined && args.name !== project.name) {
			await insertProjectChangeLog(ctx, {
				projectId: args.projectId,
				actorProfileId: actorProfile._id,
				entryType: 'name_changed',
				text: `${actorName} changed the name from "${project.name}" to "${args.name}"`
			});
		}
		if (args.description !== undefined && args.description !== (project.description ?? '')) {
			await insertProjectChangeLog(ctx, {
				projectId: args.projectId,
				actorProfileId: actorProfile._id,
				entryType: 'description_changed',
				text: `${actorName} updated the description`
			});
		}
		if (args.dueDate !== undefined && args.dueDate !== project.dueDate) {
			const priorLabel = new Date(project.dueDate).toLocaleDateString();
			const nextLabel = new Date(args.dueDate).toLocaleDateString();
			await insertProjectChangeLog(ctx, {
				projectId: args.projectId,
				actorProfileId: actorProfile._id,
				entryType: 'deadline_changed',
				text: `${actorName} changed the deadline from ${priorLabel} to ${nextLabel}`
			});
		}
		if (args.visibility !== undefined && args.visibility !== project.visibility) {
			const visibilityLabel = (value: 'clubs' | 'global') =>
				value === 'global' ? 'Share Globally' : 'Club(s) only';
			await insertProjectChangeLog(ctx, {
				projectId: args.projectId,
				actorProfileId: actorProfile._id,
				entryType: 'visibility_changed',
				text: `${actorName} changed visibility from ${visibilityLabel(project.visibility)} to ${visibilityLabel(args.visibility)}`
			});
		}
		if (
			args.coverImageMediaAssetId !== undefined &&
			(args.coverImageMediaAssetId ?? undefined) !== project.coverImageMediaAssetId
		) {
			// PRD 6.6.3: log shows the new image, not the old one. Storing the assetId in the log
			// text is a cheap way to let the UI resolve/render it later without a new column.
			await insertProjectChangeLog(ctx, {
				projectId: args.projectId,
				actorProfileId: actorProfile._id,
				entryType: 'cover_changed',
				text: args.coverImageMediaAssetId
					? `${actorName} changed the cover image|${args.coverImageMediaAssetId}`
					: `${actorName} removed the cover image`
			});
		}

		await ctx.db.patch(args.projectId, {
			name: args.name ?? project.name,
			description: args.description ?? project.description,
			dueDate: args.dueDate ?? project.dueDate,
			visibility: args.visibility ?? project.visibility,
			coverImageMediaAssetId:
				args.coverImageMediaAssetId === undefined
					? project.coverImageMediaAssetId
					: (args.coverImageMediaAssetId ?? undefined),
			updatedAt: Date.now()
		});

		return await ctx.db.get(args.projectId);
	}
});

export const listMembers = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const canRead = await canViewProject(ctx, args.projectId, identity.subject);
		if (!canRead) {
			throw new ConvexError('Permission denied');
		}

		const memberships = await ctx.db
			.query('projectMembers')
			.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
			.collect();
		// PRD 6.6.4: left members disappear from the team list entirely.
		const currentMemberships = memberships.filter((membership) => !membership.leftAt);

		const result = [];
		for (const membership of currentMemberships) {
			const role = await ctx.db.get(membership.roleId);
			const profile = await getRelatedProfile(ctx, membership.profileId);
			if (!profile) continue;
			result.push({
				projectMemberId: membership._id,
				profileId: profile._id,
				firstName: membership.firstName ?? profile?.firstName ?? '',
				lastName: membership.lastName ?? profile?.lastName ?? null,
				username: membership.username ?? profile?.username ?? null,
				coverPhotoUrl: null,
				profileImageMediaAssetId: profile?.profileImageMediaAssetId ?? null,
				roleId: membership.roleId,
				roleName: role?.name ?? 'Contributor',
				doneDate: membership.doneDate ?? null,
				state: getProjectMemberState(membership)
			});
		}

		return result;
	}
});

export const getMemberProfileDeliveryAssets = query({
	args: {
		projectId: v.id('projects'),
		assetIds: v.array(v.id('mediaAssets'))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const canRead = await canViewProject(ctx, args.projectId, identity.subject);
		if (!canRead) {
			throw new ConvexError('Permission denied');
		}

		const requestedAssetIds = [...new Set(args.assetIds)];
		if (!requestedAssetIds.length) {
			return [];
		}

		const memberships = await ctx.db
			.query('projectMembers')
			.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
			.collect();
		const activeMemberships = memberships.filter((membership) => !membership.leftAt);
		const profiles = await Promise.all(
			activeMemberships.map((membership) => getRelatedProfile(ctx, membership.profileId))
		);

		const allowedAssetIds = new Set(
			profiles
				.map((profile) => profile?.profileImageMediaAssetId ?? null)
				.filter((assetId): assetId is Id<'mediaAssets'> => assetId !== null)
		);

		const deliveryAssets = await Promise.all(
			requestedAssetIds
				.filter((assetId) => allowedAssetIds.has(assetId))
				.map(async (assetId) => {
					const asset = await ctx.db.get(assetId);
					if (!asset || asset.status !== 'ready' || asset.mediaKind !== 'image') {
						return null;
					}

					return {
						assetId: asset._id,
						storageProvider: asset.storageProvider,
						deliveryBucket: asset.processedBucket ?? asset.sourceBucket ?? null,
						deliveryObjectKey: asset.processedObjectKey ?? asset.sourceObjectKey ?? null,
						mediaKind: asset.mediaKind ?? null,
						contentType: asset.contentType ?? null,
						durationSeconds: asset.durationSeconds ?? null
					};
				})
		);

		return deliveryAssets.filter(Boolean);
	}
});

/**
 * Signed-delivery lookup for one or more projects' cover images (PRD 6.6.3), following the same
 * shape as `getMemberProfileDeliveryAssets`/`updates.getProjectDeliveryAssets` so
 * `signed-media.ts` can wrap it with `signDeliveryAssets`. Each project is independently
 * visibility-checked so this can be called in bulk for a card grid.
 */
export const getCoverDeliveryAssets = query({
	args: {
		projectIds: v.array(v.id('projects'))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const uniqueProjectIds = [...new Set(args.projectIds)];

		const results = await Promise.all(
			uniqueProjectIds.map(async (projectId) => {
				const canRead = await canViewProject(ctx, projectId, identity.subject);
				if (!canRead) return null;

				const project = await ctx.db.get(projectId);
				if (!project?.coverImageMediaAssetId) return null;

				const asset = await ctx.db.get(project.coverImageMediaAssetId);
				if (!asset || asset.status !== 'ready' || asset.mediaKind !== 'image') return null;

				return {
					assetId: asset._id,
					storageProvider: asset.storageProvider,
					deliveryBucket: asset.processedBucket ?? asset.sourceBucket ?? null,
					deliveryObjectKey: asset.processedObjectKey ?? asset.sourceObjectKey ?? null,
					mediaKind: asset.mediaKind ?? null,
					contentType: asset.contentType ?? null,
					durationSeconds: asset.durationSeconds ?? null
				};
			})
		);

		return results.filter(
			(asset): asset is NonNullable<typeof asset> => asset !== null
		);
	}
});

export const addMember = mutation({
	args: {
		projectId: v.id('projects'),
		profileId: v.id('profiles'),
		roleId: v.id('projectRoles')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const canUpdate = await isProjectPermissionAllowed(
			ctx,
			args.projectId,
			identity.subject,
			'project:update'
		);
		if (!canUpdate) {
			throw new ConvexError('Permission denied');
		}

		const role = await ctx.db.get(args.roleId);
		if (!role) {
			throw new ConvexError('Role not found');
		}
		const profile = await ctx.db.get(args.profileId);
		if (!profile) {
			throw new ConvexError('Profile not found');
		}

		const existingMemberships = await ctx.db
			.query('projectMembers')
			.withIndex('by_project_and_profile', (q) =>
				q.eq('projectId', args.projectId).eq('profileId', args.profileId)
			)
			.collect();
		const activeMembership = existingMemberships.find((membership) => !membership.leftAt);
		const historicalMembership = existingMemberships.find((membership) => membership.leftAt);

		if (activeMembership) {
			throw new ConvexError('User is already a project member');
		}

		// Re-adding a previously-left member (CL-722 rejoin path): clear `leftAt`/`doneDate` on
		// the existing row rather than inserting a fresh one, so history (createdAt, past
		// change-log entries referencing this membership) is preserved.
		if (historicalMembership) {
			await ensureProjectRoom(ctx, args.projectId);
			await ctx.db.patch(historicalMembership._id, {
				profileId: args.profileId,
				leftAt: undefined,
				doneDate: undefined,
				roleId: role._id,
				firstName: profile.firstName,
				lastName: profile.lastName,
				username: profile.username,
				coverPhotoUrl: profile.coverPhotoUrl
			});
			await insertProjectChangeLog(ctx, {
				projectId: args.projectId,
				actorProfileId: profile._id,
				entryType: 'member_joined',
				text: `${memberDisplayName(profile)} joined the project`
			});
			return await ctx.db.get(historicalMembership._id);
		}

		await ensureProjectRoom(ctx, args.projectId);
		const memberId = await ctx.db.insert('projectMembers', {
			projectId: args.projectId,
			profileId: args.profileId,
			roleId: role._id,
			firstName: profile.firstName,
			lastName: profile.lastName,
			username: profile.username,
			coverPhotoUrl: profile.coverPhotoUrl,
			createdAt: Date.now()
		});
		await insertProjectChangeLog(ctx, {
			projectId: args.projectId,
			actorProfileId: profile._id,
			entryType: 'member_joined',
			text: `${memberDisplayName(profile)} joined the project`
		});

		return await ctx.db.get(memberId);
	}
});

/**
 * PRD 6.6.5: a member marks themselves permanently Done. This cannot be undone — there is no
 * "un-done" mutation by design (stays credited; chat stays open until every current member is
 * Done). If this was the last active member, the project becomes Archived via the shared
 * `isProjectArchived` helper; we also stamp `projects.archivedAt` here for cheap queries and
 * write a "Project archived" change-log entry.
 */
export const markSelfDone = mutation({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const membership = await requireOwnProjectMembership(ctx, args.projectId, identity.subject);
		if (membership.doneDate) {
			throw new ConvexError('You have already marked this project as done');
		}

		const now = Date.now();
		await ctx.db.patch(membership._id, { doneDate: now });
		await insertProjectChangeLog(ctx, {
			projectId: args.projectId,
			actorProfileId: membership.profileId,
			entryType: 'member_done',
			text: `${memberDisplayName(membership)} marked themselves as done`
		});

		const archived = await isProjectArchived(ctx, args.projectId);
		if (archived) {
			const project = await ctx.db.get(args.projectId);
			if (project && !project.archivedAt) {
				await ctx.db.patch(args.projectId, { archivedAt: now });
				await insertProjectChangeLog(ctx, {
					projectId: args.projectId,
					actorProfileId: null,
					entryType: 'project_archived',
					text: 'Project archived'
				});
			}
		}

		return { archived };
	}
});

/**
 * PRD 6.6.5: a member leaves the project. Left members are removed from the team list, lose
 * chat send access (already enforced in `chat.ts`), and lose credit. They can rejoin later via
 * invite (CL-722); `addMember` handles that by clearing `leftAt`/`doneDate` on this same row.
 */
export const leaveProject = mutation({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const membership = await requireOwnProjectMembership(ctx, args.projectId, identity.subject);

		await ctx.db.patch(membership._id, { leftAt: Date.now() });
		await insertProjectChangeLog(ctx, {
			projectId: args.projectId,
			actorProfileId: membership.profileId,
			entryType: 'member_left',
			text: `${memberDisplayName(membership)} left the project`
		});

		return { success: true };
	}
});

export const listChangeLog = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const canRead = await canViewProject(ctx, args.projectId, identity.subject);
		if (!canRead) {
			throw new ConvexError('Permission denied');
		}

		const entries = await ctx.db
			.query('projectChangeLogs')
			.withIndex('by_project_and_created', (q) => q.eq('projectId', args.projectId))
			.order('asc')
			.collect();

		return entries;
	}
});

export const canManageProject = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		return await isProjectPermissionAllowed(
			ctx,
			args.projectId,
			identity.subject,
			'project:update'
		);
	}
});

/**
 * PRD 5.11/6.6.6: this project's attributed clubs (distinct, derived from all members'
 * attribution rows), plus which of those the viewer personally attributed (so the UI can show
 * "you've linked this project to X" and offer per-club unlink), plus the viewer's own current
 * clubs not yet linked (so the UI can offer link controls without a second round trip). Returns
 * an empty/false shape for a non-member viewer rather than throwing, so the project detail view
 * can render read-only club chips for anyone who can already view the project.
 */
export const listAttributions = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const canRead = await canViewProject(ctx, args.projectId, identity.subject);
		if (!canRead) {
			throw new ConvexError('Permission denied');
		}

		const attributionRows = await ctx.db
			.query('projectAttributions')
			.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
			.collect();

		const clubIds = [...new Set(attributionRows.map((row) => row.clubId))];
		const clubs = await Promise.all(
			clubIds.map(async (clubId) => {
				const club = await ctx.db.get(clubId);
				return club ? { clubId, name: club.name } : null;
			})
		);
		const attributedClubs = clubs.filter(
			(club): club is NonNullable<typeof club> => club !== null
		);

		const profile = await requireProfile(ctx, identity.subject);
		const viewerLinkedClubIds = new Set(
			attributionRows
				.filter((row) => row.profileId === profile._id)
				.map((row) => row.clubId)
		);

		const viewerMembership = await requireOwnProjectMembership(ctx, args.projectId, identity.subject).catch(
			() => null
		);
		const viewerCanChangeAttribution = Boolean(
			viewerMembership && !viewerMembership.doneDate && !viewerMembership.leftAt
		);

		const viewerMemberships = await listMembershipsForProfile(ctx, profile);
		const viewerActiveClubMemberships = viewerMemberships.filter((membership) => !membership.leftAt);
		const viewerClubs = await Promise.all(
			viewerActiveClubMemberships.map(async (membership) => {
				const club = await ctx.db.get(membership.clubId);
				return club
					? {
							clubId: membership.clubId,
							name: club.name,
							linkedByViewer: viewerLinkedClubIds.has(membership.clubId)
						}
					: null;
			})
		);

		return {
			attributedClubs,
			viewerLinkedClubIds: [...viewerLinkedClubIds],
			viewerClubs: viewerClubs.filter((club): club is NonNullable<typeof club> => club !== null),
			viewerCanChangeAttribution
		};
	}
});

/**
 * PRD 6.6.6: self-service linking. While Active, a member can link the project to any club
 * they're currently a member of; a single member can link the same project to multiple clubs.
 * Rejects Done members and frozen (archived) projects outright — archival "freezes" all
 * attribution links (6.6.6's "Archiving: All attribution links frozen").
 */
export const linkClub = mutation({
	args: {
		projectId: v.id('projects'),
		clubId: v.id('clubs')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const membership = await requireOwnProjectMembership(ctx, args.projectId, identity.subject);
		if (membership.doneDate) {
			throw new ConvexError('Done members cannot change attribution');
		}

		const project = await ctx.db.get(args.projectId);
		if (!project) {
			throw new ConvexError('Project not found');
		}
		if (project.archivedAt) {
			throw new ConvexError('Archived projects cannot change attribution');
		}

		// Linking requires CURRENT membership in that club (6.6.6: "Cannot re-link a club you've
		// left").
		const clubMembership = await getMembershipByProfileId(ctx, args.clubId, membership.profileId);
		if (!clubMembership) {
			throw new ConvexError('You must be a current member of this club to link it');
		}

		const existing = await ctx.db
			.query('projectAttributions')
			.withIndex('by_project_and_profile_and_club', (q) =>
				q.eq('projectId', args.projectId).eq('profileId', membership.profileId).eq('clubId', args.clubId)
			)
			.unique();
		if (existing) {
			return { success: true };
		}

		const club = await ctx.db.get(args.clubId);
		const profile = await getRelatedProfile(ctx, membership.profileId);
		const now = Date.now();
		await ctx.db.insert('projectAttributions', {
			projectId: args.projectId,
			profileId: membership.profileId,
			clubId: args.clubId,
			createdAt: now
		});
		await insertProjectChangeLog(ctx, {
			projectId: args.projectId,
			actorProfileId: membership.profileId,
			entryType: 'club_linked',
			text: `${memberDisplayName(profile ?? membership)} linked this project to ${club?.name ?? 'a club'}`
		});

		return { success: true };
	}
});

/**
 * PRD 6.6.6: self-service unlinking. Only removes the caller's OWN attribution row(s) for that
 * club — "last person out" (project disappears from a club's tabs once its final attribution row
 * is removed) is a natural consequence of tab queries deriving from `projectAttributions`, not
 * special-cased here. Unlinking does not require current club membership (a member who has left
 * a club can still remove their own stale attribution to it), only active project membership.
 */
export const unlinkClub = mutation({
	args: {
		projectId: v.id('projects'),
		clubId: v.id('clubs')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const membership = await requireOwnProjectMembership(ctx, args.projectId, identity.subject);
		if (membership.doneDate) {
			throw new ConvexError('Done members cannot change attribution');
		}

		const project = await ctx.db.get(args.projectId);
		if (!project) {
			throw new ConvexError('Project not found');
		}
		if (project.archivedAt) {
			throw new ConvexError('Archived projects cannot change attribution');
		}

		const ownRows = await ctx.db
			.query('projectAttributions')
			.withIndex('by_project_and_profile_and_club', (q) =>
				q.eq('projectId', args.projectId).eq('profileId', membership.profileId).eq('clubId', args.clubId)
			)
			.collect();
		if (ownRows.length === 0) {
			return { success: true };
		}

		for (const row of ownRows) {
			await ctx.db.delete(row._id);
		}

		const club = await ctx.db.get(args.clubId);
		const profile = await getRelatedProfile(ctx, membership.profileId);
		await insertProjectChangeLog(ctx, {
			projectId: args.projectId,
			actorProfileId: membership.profileId,
			entryType: 'club_unlinked',
			text: `${memberDisplayName(profile ?? membership)} unlinked this project from ${club?.name ?? 'a club'}`
		});

		return { success: true };
	}
});
