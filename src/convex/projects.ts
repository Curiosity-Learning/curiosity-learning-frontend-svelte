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

		projects.sort((a, b) => (a.dueDate ?? 0) - (b.dueDate ?? 0));
		const limit = args.limit ?? projects.length;
		const limited = projects.slice(0, Math.max(0, limit));

		const result: Array<{
			project: (typeof limited)[number];
			members: Array<{
				name: string;
				imageUrl: string | null;
				profileImageMediaAssetId: Id<'mediaAssets'> | null;
			}>;
		}> = [];

		for (const project of limited) {
			const memberships = await ctx.db
				.query('projectMembers')
				.withIndex('by_project', (q) => q.eq('projectId', project._id))
				.collect();
			const activeMemberships = memberships.filter((membership) => !membership.leftAt).slice(0, 3);

			const members = await Promise.all(
				activeMemberships.map(async (membership) => {
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

			result.push({ project, members });
		}

		return result;
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
		doneDate: v.optional(v.number())
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

		const project = await ctx.db.get(args.projectId);
		if (!project) {
			throw new ConvexError('Project not found');
		}

		await ctx.db.patch(args.projectId, {
			name: args.name ?? project.name,
			description: args.description ?? project.description,
			dueDate: args.dueDate ?? project.dueDate,
			doneDate: args.doneDate ?? project.doneDate,
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
		const activeMemberships = memberships.filter((membership) => !membership.leftAt);

		const result = [];
		for (const membership of activeMemberships) {
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
				leftAt: membership.leftAt ?? null
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

		if (historicalMembership) {
			await ctx.db.patch(historicalMembership._id, {
				profileId: args.profileId,
				leftAt: undefined,
				roleId: role._id,
				firstName: profile.firstName,
				lastName: profile.lastName,
				username: profile.username,
				coverPhotoUrl: profile.coverPhotoUrl
			});
			return await ctx.db.get(historicalMembership._id);
		}

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

		return await ctx.db.get(memberId);
	}
});

export const removeMember = mutation({
	args: {
		projectMemberId: v.id('projectMembers')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const member = await ctx.db.get(args.projectMemberId);
		if (!member) {
			throw new ConvexError('Project member not found');
		}

		const canUpdate = await isProjectPermissionAllowed(
			ctx,
			member.projectId,
			identity.subject,
			'project:update'
		);
		if (!canUpdate) {
			throw new ConvexError('Permission denied');
		}

		await ctx.db.patch(args.projectMemberId, { leftAt: Date.now() });
		return { success: true };
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
