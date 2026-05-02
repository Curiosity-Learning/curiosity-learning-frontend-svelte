import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { hasPermission, isProjectPermissionAllowed, requireIdentity } from './permissions';

type Ctx = QueryCtx | MutationCtx;
type AuthorSummary = {
	name: string;
	imageUrl: string | null;
	imageAssetId: Id<'mediaAssets'> | null;
};

const listUpdateMediaAssetIds = async (ctx: Ctx, updateId: Id<'updates'>) => {
	const files = await ctx.db
		.query('updateFiles')
		.withIndex('by_update', (q) => q.eq('updateId', updateId))
		.collect();

	return files.map((file) => file.mediaAssetId);
};

const resolveAuthorSummary = async (
	ctx: QueryCtx,
	userId: string,
	cache: Map<string, AuthorSummary>
) => {
	if (!userId) {
		return {
			name: 'Unknown',
			imageUrl: null,
			imageAssetId: null
		};
	}

	const cached = cache.get(userId);
	if (cached) return cached;

	let profile = null;
	try {
		profile = await ctx.db
			.query('profiles')
			.withIndex('by_user_id', (q) => q.eq('userId', userId))
			.first();
	} catch {
		// Preserve feed rendering even if legacy profile data is malformed.
		profile = null;
	}
	const name =
		[profile?.firstName ?? '', profile?.lastName ?? ''].join(' ').trim() ||
		profile?.username ||
		userId;
	const summary = {
		name,
		imageUrl: null,
		imageAssetId: profile?.profileImageMediaAssetId ?? null
	};

	cache.set(userId, summary);
	return summary;
};

const canReadProject = (ctx: Ctx, projectId: Id<'projects'>, userId: string) =>
	isProjectPermissionAllowed(ctx, projectId, userId, 'project:read');

const canManageProject = (ctx: Ctx, projectId: Id<'projects'>, userId: string) =>
	isProjectPermissionAllowed(ctx, projectId, userId, 'project:update');

export const listByProject = query({
	args: {
		projectId: v.id('projects'),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const allowed = await canReadProject(ctx, args.projectId, identity.subject);
		if (!allowed) {
			throw new ConvexError('Permission denied');
		}

		const queryBuilder = ctx.db
			.query('updates')
			.withIndex('by_project_and_created', (q) => q.eq('projectId', args.projectId));

		if (args.limit) {
			// Keep chronological ordering (oldest -> newest) while limiting.
			const newestFirst = await queryBuilder.order('desc').take(args.limit);
			const chronological = newestFirst.reverse();
			return await Promise.all(
				chronological.map(async (update) => ({
					...update,
					mediaAssetIds: await listUpdateMediaAssetIds(ctx, update._id)
				}))
			);
		}

		const updates = await queryBuilder.collect();
		return await Promise.all(
			updates.map(async (update) => ({
				...update,
				mediaAssetIds: await listUpdateMediaAssetIds(ctx, update._id)
			}))
		);
	}
});

export const listByClub = query({
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

		const limit = args.limit ?? 50;

		// New path: read a single indexed stream of updates for the club.
		const updateClubRows = await ctx.db
			.query('updateClubs')
			.withIndex('by_club_and_created', (q) => q.eq('clubId', args.clubId))
			.order('desc')
			.take(limit);

		const seen = new Set<Id<'updates'>>();
		const items: Array<{
			updateId: Id<'updates'>;
			projectId: Id<'projects'> | null;
			projectName: string | null;
			content: string;
			createdAt: number;
			createdByUserId: string;
		}> = [];

		for (const row of updateClubRows) {
			if (seen.has(row.updateId)) continue;
			seen.add(row.updateId);

			const update = await ctx.db.get(row.updateId);
			if (!update) continue;
			const projectId = row.projectId ?? update.projectId ?? null;
			const project = projectId ? await ctx.db.get(projectId) : null;

			items.push({
				updateId: update._id,
				projectId,
				projectName: project?.name ?? null,
				content: update.content,
				createdAt: update.createdAt,
				createdByUserId: update.createdByUserId
			});
		}

		return items.slice(0, limit);
	}
});

export const listForViewer = query({
	args: {
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const limit = args.limit ?? 50;
		const authorCache = new Map<string, AuthorSummary>();

		const memberships = await ctx.db
			.query('clubMembers')
			.withIndex('by_user', (q) => q.eq('userId', identity.subject))
			.collect();
		const activeMemberships = memberships.filter((membership) => !membership.leftAt);
		if (!activeMemberships.length) {
			return [];
		}

		const readableClubIdSet = new Set<string>();
		for (const membership of activeMemberships) {
			const role = await ctx.db.get(membership.roleId);
			if (role?.permissions.includes('project:read')) {
				readableClubIdSet.add(membership.clubId);
			}
		}

		const readableClubIds = [...readableClubIdSet] as Array<Id<'clubs'>>;
		if (!readableClubIds.length) {
			return [];
		}

		// Since we can only query updateClubs by a single clubId at a time, take a handful per club,
		// then merge-sort and de-dupe on updateId.
		const takePerClub = Math.min(limit, Math.ceil((limit * 2) / readableClubIds.length));
		const rowsByClub = await Promise.all(
			readableClubIds.map((clubId) =>
				ctx.db
					.query('updateClubs')
					.withIndex('by_club_and_created', (q) => q.eq('clubId', clubId))
					.order('desc')
					.take(takePerClub)
			)
		);

		const rows = rowsByClub.flat().sort((a, b) => b.createdAt - a.createdAt);

		const seen = new Set<Id<'updates'>>();
		const items: Array<{
			updateId: Id<'updates'>;
			clubId: Id<'clubs'>;
			clubName: string | null;
			projectId: Id<'projects'> | null;
			projectName: string | null;
			questionId: Id<'questions'> | null;
			questionContent: string | null;
			authorName: string;
			authorImageUrl: string | null;
			authorImageMediaAssetId: Id<'mediaAssets'> | null;
			content: string;
			createdAt: number;
			createdByUserId: string;
		}> = [];

		for (const row of rows) {
			if (items.length >= limit) break;
			if (seen.has(row.updateId)) continue;
			seen.add(row.updateId);

			const update = await ctx.db.get(row.updateId);
			if (!update) continue;

			const club = await ctx.db.get(row.clubId);
			const projectId = row.projectId ?? update.projectId ?? null;
			let projectName: string | null = null;
			if (projectId) {
				try {
					const project = await ctx.db.get(projectId);
					projectName = project?.name ?? null;
				} catch {
					projectName = null;
				}
			}
			const questionId = update.questionId ?? null;
			let questionContent: string | null = null;
			if (questionId) {
				try {
					const question = await ctx.db.get(questionId);
					questionContent = question?.content ?? null;
				} catch {
					questionContent = null;
				}
			}
			const author = await resolveAuthorSummary(ctx, update.createdByUserId, authorCache);

			items.push({
				updateId: update._id,
				clubId: row.clubId,
				clubName: club?.name ?? null,
				projectId,
				projectName,
				questionId,
				questionContent,
				authorName: author.name,
				authorImageUrl: author.imageUrl,
				authorImageMediaAssetId: author.imageAssetId,
				content: update.content,
				createdAt: update.createdAt,
				createdByUserId: update.createdByUserId
			});
		}

		return items;
	}
});

export const listMine = query({
	args: {
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const limit = args.limit;
		const authorCache = new Map<string, AuthorSummary>();

		const memberships = await ctx.db
			.query('clubMembers')
			.withIndex('by_user', (q) => q.eq('userId', identity.subject))
			.collect();
		const activeMemberships = memberships.filter((membership) => !membership.leftAt);
		if (!activeMemberships.length) {
			return [];
		}

		const readableClubIds: Array<Id<'clubs'>> = [];
		for (const membership of activeMemberships) {
			const role = await ctx.db.get(membership.roleId);
			if (role?.permissions.includes('project:read')) {
				readableClubIds.push(membership.clubId);
			}
		}
		if (!readableClubIds.length) {
			return [];
		}

		const rowsByClub = await Promise.all(
			readableClubIds.map((clubId) =>
				ctx.db
					.query('updateClubs')
					.withIndex('by_club_and_created', (q) => q.eq('clubId', clubId))
					.order('desc')
					.collect()
			)
		);

		const rows = rowsByClub.flat().sort((a, b) => b.createdAt - a.createdAt);
		const seen = new Set<Id<'updates'>>();
		const items: Array<{
			updateId: Id<'updates'>;
			clubId: Id<'clubs'>;
			clubName: string | null;
			projectId: Id<'projects'> | null;
			projectName: string | null;
			questionId: Id<'questions'> | null;
			questionContent: string | null;
			authorName: string;
			authorImageUrl: string | null;
			authorImageMediaAssetId: Id<'mediaAssets'> | null;
			content: string;
			createdAt: number;
			createdByUserId: string;
		}> = [];

		for (const row of rows) {
			if (limit !== undefined && items.length >= limit) break;
			if (seen.has(row.updateId)) continue;
			seen.add(row.updateId);

			const update = await ctx.db.get(row.updateId);
			if (!update || update.createdByUserId !== identity.subject) continue;

			const club = await ctx.db.get(row.clubId);
			const projectId = row.projectId ?? update.projectId ?? null;
			const project = projectId ? await ctx.db.get(projectId) : null;
			const questionId = update.questionId ?? null;
			const question = questionId ? await ctx.db.get(questionId) : null;
			const author = await resolveAuthorSummary(ctx, update.createdByUserId, authorCache);

			items.push({
				updateId: update._id,
				clubId: row.clubId,
				clubName: club?.name ?? null,
				projectId,
				projectName: project?.name ?? null,
				questionId,
				questionContent: question?.content ?? null,
				authorName: author.name,
				authorImageUrl: author.imageUrl,
				authorImageMediaAssetId: author.imageAssetId,
				content: update.content,
				createdAt: update.createdAt,
				createdByUserId: update.createdByUserId
			});
		}

		return items;
	}
});

export const getViewerAuthorDeliveryAssets = query({
	args: {
		assetIds: v.array(v.id('mediaAssets')),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const requestedAssetIds = [...new Set(args.assetIds)];
		if (!requestedAssetIds.length) {
			return [];
		}
		const requestedAssetIdSet = new Set(requestedAssetIds);

		const limit = args.limit ?? 50;

		const memberships = await ctx.db
			.query('clubMembers')
			.withIndex('by_user', (q) => q.eq('userId', identity.subject))
			.collect();
		const activeMemberships = memberships.filter((membership) => !membership.leftAt);
		if (!activeMemberships.length) {
			return [];
		}

		const readableClubIdSet = new Set<Id<'clubs'>>();
		for (const membership of activeMemberships) {
			const role = await ctx.db.get(membership.roleId);
			if (role?.permissions.includes('project:read')) {
				readableClubIdSet.add(membership.clubId);
			}
		}

		const readableClubIds = [...readableClubIdSet];
		if (!readableClubIds.length) {
			return [];
		}

		const takePerClub = Math.min(limit, Math.ceil((limit * 2) / readableClubIds.length));
		const rowsByClub = await Promise.all(
			readableClubIds.map((clubId) =>
				ctx.db
					.query('updateClubs')
					.withIndex('by_club_and_created', (q) => q.eq('clubId', clubId))
					.order('desc')
					.take(takePerClub)
			)
		);

		const rows = rowsByClub.flat().sort((a, b) => b.createdAt - a.createdAt);
		const seen = new Set<Id<'updates'>>();
		const authorCache = new Map<string, AuthorSummary>();
		const deliveryAssets: Array<{
			assetId: Id<'mediaAssets'>;
			storageProvider: 's3';
			deliveryBucket: string | null;
			deliveryObjectKey: string | null;
			mediaKind: 'image' | 'video' | null;
			contentType: string | null;
			durationSeconds: number | null;
		}> = [];
		const delivered = new Set<Id<'mediaAssets'>>();

		for (const row of rows) {
			if (deliveryAssets.length >= requestedAssetIds.length || seen.size >= limit) break;
			if (seen.has(row.updateId)) continue;
			seen.add(row.updateId);

			const update = await ctx.db.get(row.updateId);
			if (!update) continue;

			const author = await resolveAuthorSummary(ctx, update.createdByUserId, authorCache);
			const assetId = author.imageAssetId;
			if (!assetId || !requestedAssetIdSet.has(assetId) || delivered.has(assetId)) {
				continue;
			}

			const asset = await ctx.db.get(assetId);
			if (!asset || asset.status !== 'ready' || asset.mediaKind !== 'image') {
				continue;
			}

			deliveryAssets.push({
				assetId: asset._id,
				storageProvider: asset.storageProvider,
				deliveryBucket: asset.processedBucket ?? asset.sourceBucket ?? null,
				deliveryObjectKey: asset.processedObjectKey ?? asset.sourceObjectKey ?? null,
				mediaKind: asset.mediaKind ?? null,
				contentType: asset.contentType ?? null,
				durationSeconds: asset.durationSeconds ?? null
			});
			delivered.add(assetId);
		}

		return deliveryAssets;
	}
});

export const create = mutation({
	args: {
		projectId: v.id('projects'),
		content: v.string(),
		questionId: v.optional(v.id('questions'))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const allowed = await canManageProject(ctx, args.projectId, identity.subject);
		if (!allowed) {
			throw new ConvexError('Permission denied');
		}

		const now = Date.now();
		const updateId = await ctx.db.insert('updates', {
			projectId: args.projectId,
			content: args.content,
			createdByUserId: identity.subject,
			questionId: args.questionId,
			createdAt: now,
			updatedAt: now
		});

		// Denormalize updates -> clubs for a fast club feed.
		const projectLinks = await ctx.db
			.query('projectClubs')
			.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
			.collect();
		for (const link of projectLinks) {
			await ctx.db.insert('updateClubs', {
				updateId,
				clubId: link.clubId,
				projectId: args.projectId,
				createdAt: now
			});
		}

		return await ctx.db.get(updateId);
	}
});

export const update = mutation({
	args: {
		updateId: v.id('updates'),
		content: v.string(),
		questionId: v.optional(v.id('questions'))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const existing = await ctx.db.get(args.updateId);
		if (!existing || !existing.projectId) {
			throw new ConvexError('Update not found');
		}

		const allowed = await canManageProject(ctx, existing.projectId, identity.subject);
		if (!allowed) {
			throw new ConvexError('Permission denied');
		}

		await ctx.db.patch(args.updateId, {
			content: args.content,
			questionId: args.questionId,
			updatedAt: Date.now()
		});

		return await ctx.db.get(args.updateId);
	}
});

export const attachFiles = mutation({
	args: {
		updateId: v.id('updates'),
		mediaAssetIds: v.array(v.id('mediaAssets'))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const existing = await ctx.db.get(args.updateId);
		if (!existing || !existing.projectId) {
			throw new ConvexError('Update not found');
		}

		const allowed = await canManageProject(ctx, existing.projectId, identity.subject);
		if (!allowed) {
			throw new ConvexError('Permission denied');
		}

		const inserted = [];
		for (const mediaAssetId of args.mediaAssetIds) {
			const asset = await ctx.db.get(mediaAssetId);
			if (!asset || asset.ownerUserId !== identity.subject) {
				throw new ConvexError('Media asset not found');
			}
			if (asset.status !== 'ready') {
				throw new ConvexError('Only ready media assets can be attached');
			}

			const id = await ctx.db.insert('updateFiles', {
				updateId: args.updateId,
				mediaAssetId,
				createdAt: Date.now()
			});
			inserted.push(id);
		}

		return inserted;
	}
});

export const listFiles = query({
	args: {
		updateId: v.id('updates')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const update = await ctx.db.get(args.updateId);
		if (!update || !update.projectId) {
			throw new ConvexError('Update not found');
		}

		const allowed = await canReadProject(ctx, update.projectId, identity.subject);
		if (!allowed) {
			throw new ConvexError('Permission denied');
		}

		return await ctx.db
			.query('updateFiles')
			.withIndex('by_update', (q) => q.eq('updateId', args.updateId))
			.collect();
	}
});

export const getProjectDeliveryAssets = query({
	args: {
		projectId: v.id('projects'),
		assetIds: v.array(v.id('mediaAssets'))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const allowed = await canReadProject(ctx, args.projectId, identity.subject);
		if (!allowed) {
			throw new ConvexError('Permission denied');
		}

		const uniqueAssetIds = [...new Set(args.assetIds)];
		const assets = await Promise.all(
			uniqueAssetIds.map(async (assetId) => {
				const fileLinks = await ctx.db
					.query('updateFiles')
					.withIndex('by_media_asset', (q) => q.eq('mediaAssetId', assetId))
					.collect();
				if (!fileLinks.length) {
					return null;
				}

				for (const link of fileLinks) {
					const update = await ctx.db.get(link.updateId);
					if (!update || update.projectId !== args.projectId) {
						continue;
					}

					const asset = await ctx.db.get(assetId);
					if (!asset || asset.status !== 'ready') {
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
				}

				return null;
			})
		);

		return assets.filter(Boolean);
	}
});
