import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import {
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

		const links = await ctx.db
			.query('projectClubs')
			.withIndex('by_club', (q) => q.eq('clubId', args.clubId))
			.collect();

		const projects = await Promise.all(links.map((link) => ctx.db.get(link.projectId)));
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

			const links = await ctx.db
				.query('projectClubs')
				.withIndex('by_club', (q) => q.eq('clubId', membership.clubId))
				.collect();
			for (const link of links) {
				seen.add(link.projectId);
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

		const links = await ctx.db
			.query('projectClubs')
			.withIndex('by_club', (q) => q.eq('clubId', args.clubId))
			.collect();

		const projects = (await Promise.all(links.map((link) => ctx.db.get(link.projectId)))).filter(
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
			const isShowcase = archived || activeMemberships.length === 0;

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
		const canRead = await isProjectPermissionAllowed(
			ctx,
			args.projectId,
			identity.subject,
			'project:read'
		);
		if (!canRead) {
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
		clubId: v.id('clubs'),
		name: v.string(),
		description: v.optional(v.string()),
		dueDate: v.number()
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const canCreate = await hasPermission(ctx, args.clubId, identity.subject, 'project:create');
		if (!canCreate) {
			throw new ConvexError('Permission denied');
		}

		const profile = await requireProfile(ctx, identity.subject);

		const now = Date.now();
		const projectId = await ctx.db.insert('projects', {
			name: args.name,
			description: args.description,
			dueDate: args.dueDate,
			createdByProfileId: profile._id,
			createdAt: now,
			updatedAt: now
		});
		await ensureProjectRoom(ctx, projectId);

		await ctx.db.insert('projectClubs', {
			projectId,
			clubId: args.clubId,
			createdAt: now
		});

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
		dueDate: v.optional(v.number())
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
		// PRD 6.6.4: Done members cannot edit project metadata or change attribution.
		await assertNotDoneMember(ctx, args.projectId, identity.subject);

		const project = await ctx.db.get(args.projectId);
		if (!project) {
			throw new ConvexError('Project not found');
		}

		await ctx.db.patch(args.projectId, {
			name: args.name ?? project.name,
			description: args.description ?? project.description,
			dueDate: args.dueDate ?? project.dueDate,
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
		const canRead = await isProjectPermissionAllowed(
			ctx,
			args.projectId,
			identity.subject,
			'project:read'
		);
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
		const canRead = await isProjectPermissionAllowed(
			ctx,
			args.projectId,
			identity.subject,
			'project:read'
		);
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
		const canRead = await isProjectPermissionAllowed(
			ctx,
			args.projectId,
			identity.subject,
			'project:read'
		);
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
