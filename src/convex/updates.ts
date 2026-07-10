import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import {
	getProfileAuthUserId,
	getRelatedProfile,
	hasPermission,
	isProjectPermissionAllowed,
	listMembershipsForProfile,
	requireIdentity,
	requireProfile
} from './permissions';
import {
	assertNotDoneMember,
	assertNotLeftMember,
	canViewProject,
	listAttributedClubIds
} from './projectsModel';

type Ctx = QueryCtx | MutationCtx;
type AuthorSummary = {
	name: string;
	imageUrl: string | null;
	imageAssetId: Id<'mediaAssets'> | null;
	authUserId: string | null;
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
	profileId: Id<'profiles'> | undefined,
	cache: Map<string, AuthorSummary>
) => {
	const cacheKey = profileId;
	if (!cacheKey) {
		return {
			name: 'Unknown',
			imageUrl: null,
			imageAssetId: null,
			authUserId: null
		};
	}

	const cached = cache.get(cacheKey);
	if (cached) return cached;

	const profile = await getRelatedProfile(ctx, profileId);
	const authUserId = profile ? getProfileAuthUserId(profile) : null;
	const name =
		[profile?.firstName ?? '', profile?.lastName ?? ''].join(' ').trim() ||
		profile?.username ||
		authUserId ||
		'Unknown';
	const summary = {
		name,
		imageUrl: null,
		imageAssetId: profile?.profileImageMediaAssetId ?? null,
		authUserId
	};

	cache.set(cacheKey, summary);
	return summary;
};

// PRD 6.6.2/6.6.11: project updates are project-detail content, so reads are visibility-gated
// the same way as `projects.getById` (see `projectsModel.canViewProject`), not just role-scoped.
const canReadProject = (ctx: Ctx, projectId: Id<'projects'>, userId: string) =>
	canViewProject(ctx, projectId, userId);

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

		const authorCache = new Map<string, AuthorSummary>();
		const withAuthor = async (update: Doc<'updates'>) => {
			const author = await resolveAuthorSummary(ctx, update.createdByProfileId, authorCache);
			return {
				...update,
				mediaAssetIds: await listUpdateMediaAssetIds(ctx, update._id),
				authorName: author.name,
				authorImageAssetId: author.imageAssetId
			};
		};

		const queryBuilder = ctx.db
			.query('updates')
			.withIndex('by_project_and_created', (q) => q.eq('projectId', args.projectId));

		if (args.limit) {
			// Keep chronological ordering (oldest -> newest) while limiting.
			const newestFirst = await queryBuilder.order('desc').take(args.limit);
			const chronological = newestFirst.reverse();
			return await Promise.all(chronological.map(withAuthor));
		}

		const updates = await queryBuilder.collect();
		return await Promise.all(updates.map(withAuthor));
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
		const authorCache = new Map<string, AuthorSummary>();
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
			const author = await resolveAuthorSummary(ctx, update.createdByProfileId, authorCache);

			items.push({
				updateId: update._id,
				projectId,
				projectName: project?.name ?? null,
				content: update.content,
				createdAt: update.createdAt,
				createdByUserId: author.authUserId ?? 'unknown'
			});
		}

		return items.slice(0, limit);
	}
});

type FeedItem = {
	updateId: Id<'updates'>;
	clubId: Id<'clubs'> | null;
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
	mediaAssetIds: Id<'mediaAssets'>[];
};

const FEED_DEFAULT_LIMIT = 20;
const FEED_MAX_LIMIT = 50;

// PRD 6.7.2/6.7.3: both feed tabs grow unboundedly, so reads are paginated via a simple
// `before` (exclusive createdAt) cursor rather than returning everything. `nextCursor` is the
// createdAt of the oldest item in the page, or null once there's nothing older to load.
type FeedPage = {
	items: FeedItem[];
	nextCursor: number | null;
};

/**
 * PRD 5.11/6.6.6/6.7.2: "My Clubs" = updates from projects with >=1 `projectAttributions` row
 * pointing at ANY club the viewer currently belongs to (the per-member attribution model from
 * CL-721), not the active club-switcher selection. `updateClubs` is the denormalized
 * updates -> attributed-clubs index populated at `updates.create` time directly from
 * `listAttributedClubIds`, so filtering by "clubs the viewer has `project:read` in" here already
 * matches the current attribution model - this was verified against `projectsModel.ts` and
 * needed no correctness fix, only pagination (previously unbounded).
 */
export const listForViewer = query({
	args: {
		limit: v.optional(v.number()),
		cursor: v.optional(v.number())
	},
	handler: async (ctx, args): Promise<FeedPage> => {
		const identity = await requireIdentity(ctx);
		const limit = Math.min(args.limit ?? FEED_DEFAULT_LIMIT, FEED_MAX_LIMIT);
		const authorCache = new Map<string, AuthorSummary>();

		const viewerProfile = await requireProfile(ctx, identity.subject);
		const memberships = await listMembershipsForProfile(ctx, viewerProfile);
		const activeMemberships = memberships.filter((membership) => !membership.leftAt);
		if (!activeMemberships.length) {
			return { items: [], nextCursor: null };
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
			return { items: [], nextCursor: null };
		}

		// Since we can only query updateClubs by a single clubId at a time, take a handful per club,
		// then merge-sort and de-dupe on updateId. We over-fetch by one extra item to know whether
		// there's a next page.
		const takePerClub = Math.min(
			limit + 1,
			Math.ceil(((limit + 1) * 2) / readableClubIds.length)
		);
		const cursor = args.cursor;
		const rowsByClub = await Promise.all(
			readableClubIds.map((clubId) =>
				ctx.db
					.query('updateClubs')
					.withIndex('by_club_and_created', (q) =>
						cursor !== undefined ? q.eq('clubId', clubId).lt('createdAt', cursor) : q.eq('clubId', clubId)
					)
					.order('desc')
					.take(takePerClub)
			)
		);

		const rows = rowsByClub.flat().sort((a, b) => b.createdAt - a.createdAt);

		const seen = new Set<Id<'updates'>>();
		const items: FeedItem[] = [];
		// Cursor is the createdAt of the LAST item actually returned (not the cutoff item) — the
		// next page re-queries with `.lt('createdAt', cursor)`, which must still include anything
		// exactly at the cutoff item's createdAt. Using the cutoff item's own createdAt here would
		// off-by-one exclude it from every subsequent page.
		let nextCursor: number | null = null;
		let hasMore = false;

		for (const row of rows) {
			if (items.length >= limit) {
				hasMore = true;
				break;
			}
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
			const author = await resolveAuthorSummary(ctx, update.createdByProfileId, authorCache);

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
				createdByUserId: author.authUserId ?? 'unknown',
				mediaAssetIds: await listUpdateMediaAssetIds(ctx, update._id)
			});
		}

		if (hasMore) {
			nextCursor = items[items.length - 1]?.createdAt ?? null;
		}

		return { items, nextCursor };
	}
});

/**
 * PRD 6.7.2-6.7.4 "All" tab: updates from projects with `visibility: 'global'`, reverse
 * chronological, paginated the same way as `listForViewer`. Unlike the club feed there's no
 * denormalized index to walk (global-ness is a project-level flag, not a per-update
 * attribution), so this walks `updates` newest-first directly and filters by the author's
 * project's visibility, which is efficient because `updates` is already indexed and the filter
 * is a single `.get` per project (cached per page).
 */
export const listGlobal = query({
	args: {
		limit: v.optional(v.number()),
		cursor: v.optional(v.number())
	},
	handler: async (ctx, args): Promise<FeedPage> => {
		await requireIdentity(ctx);
		const limit = Math.min(args.limit ?? FEED_DEFAULT_LIMIT, FEED_MAX_LIMIT);
		const authorCache = new Map<string, AuthorSummary>();
		const projectCache = new Map<Id<'projects'>, Doc<'projects'> | null>();

		const getProjectCached = async (projectId: Id<'projects'>) => {
			if (projectCache.has(projectId)) return projectCache.get(projectId) ?? null;
			const project = await ctx.db.get(projectId);
			projectCache.set(projectId, project);
			return project;
		};

		const items: FeedItem[] = [];
		// Cursor is the createdAt of the LAST item actually returned, not the cutoff item — see
		// the identical note in `listForViewer` for why using the cutoff item's own createdAt
		// would off-by-one exclude it from every subsequent page.
		let nextCursor: number | null = null;
		let hasMore = false;
		// Batch-scan updates newest-first, filtering to global-visibility projects as we go.
		// Over-fetch a bounded batch at a time rather than the whole table.
		const BATCH_SIZE = Math.max(limit * 4, 40);
		let scanCursor = args.cursor;
		let exhausted = false;

		while (items.length < limit && !exhausted && !hasMore) {
			const batch: Doc<'updates'>[] = await ctx.db
				.query('updates')
				.withIndex('by_created', (q) =>
					scanCursor !== undefined ? q.lt('createdAt', scanCursor) : q
				)
				.order('desc')
				.take(BATCH_SIZE);

			if (batch.length < BATCH_SIZE) {
				exhausted = true;
			}
			if (batch.length === 0) break;

			for (const update of batch) {
				if (items.length >= limit) {
					hasMore = true;
					break;
				}
				if (!update.projectId) continue;
				const project = await getProjectCached(update.projectId);
				if (!project || project.visibility !== 'global') continue;

				const author = await resolveAuthorSummary(ctx, update.createdByProfileId, authorCache);
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

				// Surface club context only where the project is attributed to a club the viewer
				// can see it "in" for card display purposes; global updates may have zero
				// attribution (a global project need not be attributed to any club at all).
				const attributedClubIds = await listAttributedClubIds(ctx, update.projectId);
				const firstClubId = attributedClubIds[0] ?? null;
				const club = firstClubId ? await ctx.db.get(firstClubId) : null;

				items.push({
					updateId: update._id,
					clubId: firstClubId,
					clubName: club?.name ?? null,
					projectId: update.projectId,
					projectName: project.name,
					questionId,
					questionContent,
					authorName: author.name,
					authorImageUrl: author.imageUrl,
					authorImageMediaAssetId: author.imageAssetId,
					content: update.content,
					createdAt: update.createdAt,
					createdByUserId: author.authUserId ?? 'unknown',
					mediaAssetIds: await listUpdateMediaAssetIds(ctx, update._id)
				});
			}

			scanCursor = batch[batch.length - 1]?.createdAt;
		}

		if (hasMore) {
			nextCursor = items[items.length - 1]?.createdAt ?? null;
		}

		return { items, nextCursor };
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

		const viewerProfile = await requireProfile(ctx, identity.subject);
		const memberships = await listMembershipsForProfile(ctx, viewerProfile);
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
			mediaAssetIds: Id<'mediaAssets'>[];
		}> = [];

		for (const row of rows) {
			if (limit !== undefined && items.length >= limit) break;
			if (seen.has(row.updateId)) continue;
			seen.add(row.updateId);

			const update = await ctx.db.get(row.updateId);
			if (!update || update.createdByProfileId !== viewerProfile._id) continue;

			const club = await ctx.db.get(row.clubId);
			const projectId = row.projectId ?? update.projectId ?? null;
			const project = projectId ? await ctx.db.get(projectId) : null;
			const questionId = update.questionId ?? null;
			const question = questionId ? await ctx.db.get(questionId) : null;
			const author = await resolveAuthorSummary(ctx, update.createdByProfileId, authorCache);

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
				createdByUserId: author.authUserId ?? 'unknown',
				mediaAssetIds: await listUpdateMediaAssetIds(ctx, update._id)
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

		const viewerProfile = await requireProfile(ctx, identity.subject);
		const memberships = await listMembershipsForProfile(ctx, viewerProfile);
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

			const author = await resolveAuthorSummary(ctx, update.createdByProfileId, authorCache);
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

export const getViewerUpdateMediaDeliveryAssets = query({
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

		const limit = args.limit ?? 50;

		const viewerProfile = await requireProfile(ctx, identity.subject);
		const memberships = await listMembershipsForProfile(ctx, viewerProfile);
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
		const deliveryAssets: Array<{
			assetId: Id<'mediaAssets'>;
			storageProvider: 's3';
			deliveryBucket: string | null;
			deliveryObjectKey: string | null;
			mediaKind: 'image' | 'video' | null;
			contentType: string | null;
			durationSeconds: number | null;
		}> = [];

		for (const row of rows) {
			if (seen.size >= limit) break;
			if (seen.has(row.updateId)) continue;
			seen.add(row.updateId);

			const mediaAssetIds = await listUpdateMediaAssetIds(ctx, row.updateId);
			for (const assetId of mediaAssetIds) {
				if (!requestedAssetIds.includes(assetId)) continue;

				const asset = await ctx.db.get(assetId);
				if (!asset || asset.status !== 'ready') continue;

				deliveryAssets.push({
					assetId: asset._id,
					storageProvider: asset.storageProvider,
					deliveryBucket: asset.processedBucket ?? asset.sourceBucket ?? null,
					deliveryObjectKey: asset.processedObjectKey ?? asset.sourceObjectKey ?? null,
					mediaKind: asset.mediaKind ?? null,
					contentType: asset.contentType ?? null,
					durationSeconds: asset.durationSeconds ?? null
				});
			}
		}

		return deliveryAssets;
	}
});

type DeliveryAssetRow = {
	assetId: Id<'mediaAssets'>;
	storageProvider: 's3';
	deliveryBucket: string | null;
	deliveryObjectKey: string | null;
	mediaKind: 'image' | 'video' | null;
	contentType: string | null;
	durationSeconds: number | null;
};

const toDeliveryAssetRow = (asset: Doc<'mediaAssets'>): DeliveryAssetRow => ({
	assetId: asset._id,
	storageProvider: asset.storageProvider,
	deliveryBucket: asset.processedBucket ?? asset.sourceBucket ?? null,
	deliveryObjectKey: asset.processedObjectKey ?? asset.sourceObjectKey ?? null,
	mediaKind: asset.mediaKind ?? null,
	contentType: asset.contentType ?? null,
	durationSeconds: asset.durationSeconds ?? null
});

// PRD 6.7.2-6.7.3: the "All" tab surfaces updates the viewer may not belong to any club for
// (that's the point of a global feed), so the club-attribution walk that
// `getViewerAuthorDeliveryAssets`/`getViewerUpdateMediaDeliveryAssets` use to scope requests
// doesn't apply. Instead these two take the caller-supplied `updateId`s directly (the server
// loader already fetched them from `listGlobal`) and re-verify each update's project is
// currently viewable (`canViewProject`, which is exactly the visibility gate `listGlobal` used)
// before returning its assets — this prevents an authenticated caller from probing arbitrary
// asset ids for updates they can't see.
export const getGlobalAuthorDeliveryAssets = query({
	args: {
		updateIds: v.array(v.id('updates')),
		assetIds: v.array(v.id('mediaAssets'))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const requestedAssetIdSet = new Set(args.assetIds);
		if (!requestedAssetIdSet.size) {
			return [];
		}

		const authorCache = new Map<string, AuthorSummary>();
		const deliveryAssets: DeliveryAssetRow[] = [];
		const delivered = new Set<Id<'mediaAssets'>>();

		for (const updateId of new Set(args.updateIds)) {
			const update = await ctx.db.get(updateId);
			if (!update || !update.projectId) continue;
			const allowed = await canViewProject(ctx, update.projectId, identity.subject);
			if (!allowed) continue;

			const author = await resolveAuthorSummary(ctx, update.createdByProfileId, authorCache);
			const assetId = author.imageAssetId;
			if (!assetId || !requestedAssetIdSet.has(assetId) || delivered.has(assetId)) continue;

			const asset = await ctx.db.get(assetId);
			if (!asset || asset.status !== 'ready' || asset.mediaKind !== 'image') continue;

			deliveryAssets.push(toDeliveryAssetRow(asset));
			delivered.add(assetId);
		}

		return deliveryAssets;
	}
});

export const getGlobalUpdateMediaDeliveryAssets = query({
	args: {
		updateIds: v.array(v.id('updates')),
		assetIds: v.array(v.id('mediaAssets'))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const requestedAssetIds = new Set(args.assetIds);
		if (!requestedAssetIds.size) {
			return [];
		}

		const deliveryAssets: DeliveryAssetRow[] = [];

		for (const updateId of new Set(args.updateIds)) {
			const update = await ctx.db.get(updateId);
			if (!update || !update.projectId) continue;
			const allowed = await canViewProject(ctx, update.projectId, identity.subject);
			if (!allowed) continue;

			const mediaAssetIds = await listUpdateMediaAssetIds(ctx, updateId);
			for (const assetId of mediaAssetIds) {
				if (!requestedAssetIds.has(assetId)) continue;
				const asset = await ctx.db.get(assetId);
				if (!asset || asset.status !== 'ready') continue;
				deliveryAssets.push(toDeliveryAssetRow(asset));
			}
		}

		return deliveryAssets;
	}
});

const UPDATE_CONTENT_MAX_LENGTH = 1000;
const UPDATE_MAX_MEDIA_ASSETS = 4;

export const create = mutation({
	args: {
		projectId: v.id('projects'),
		content: v.string(),
		questionId: v.optional(v.id('questions')),
		// PRD 6.7.1: up to 4 images/videos attached atomically with the update. Assets must
		// already be uploaded (via the media pipeline) and owned by the poster.
		mediaAssetIds: v.optional(v.array(v.id('mediaAssets')))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const allowed = await canManageProject(ctx, args.projectId, identity.subject);
		if (!allowed) {
			throw new ConvexError('Permission denied');
		}
		// PRD 6.7.1/6.6.4: neither a Done nor a Left member may post project updates.
		// `canManageProject` alone isn't sufficient: it grants access from an attributed club
		// role regardless of the caller's own project-membership state, so a member who has
		// left the project but still holds e.g. a Guide role in an attributed club would
		// otherwise pass. `assertNotLeftMember` closes that gap explicitly.
		await assertNotDoneMember(ctx, args.projectId, identity.subject);
		await assertNotLeftMember(ctx, args.projectId, identity.subject);

		const trimmedContent = args.content.trim();
		if (!trimmedContent) {
			throw new ConvexError('Update text is required.');
		}
		if (trimmedContent.length > UPDATE_CONTENT_MAX_LENGTH) {
			throw new ConvexError(`Updates must be ${UPDATE_CONTENT_MAX_LENGTH} characters or fewer.`);
		}

		const mediaAssetIds = args.mediaAssetIds ?? [];
		if (mediaAssetIds.length > UPDATE_MAX_MEDIA_ASSETS) {
			throw new ConvexError(`Updates can have at most ${UPDATE_MAX_MEDIA_ASSETS} attachments.`);
		}

		const assets = await Promise.all(
			mediaAssetIds.map(async (mediaAssetId) => {
				const asset = await ctx.db.get(mediaAssetId);
				if (!asset || asset.ownerUserId !== identity.subject) {
					throw new ConvexError('Media asset not found');
				}
				if (asset.status !== 'ready') {
					throw new ConvexError('Only ready media assets can be attached');
				}
				if (asset.mediaKind !== 'image' && asset.mediaKind !== 'video') {
					throw new ConvexError('Only image or video attachments are supported');
				}
				return asset;
			})
		);

		const now = Date.now();
		const updateId = await ctx.db.insert('updates', {
			projectId: args.projectId,
			content: trimmedContent,
			createdByProfileId: profile._id,
			questionId: args.questionId,
			createdAt: now,
			updatedAt: now
		});

		for (const asset of assets) {
			await ctx.db.insert('updateFiles', {
				updateId,
				mediaAssetId: asset._id,
				createdAt: now
			});
		}

		// Denormalize updates -> clubs for a fast club feed.
		const attributedClubIds = await listAttributedClubIds(ctx, args.projectId);
		for (const clubId of attributedClubIds) {
			await ctx.db.insert('updateClubs', {
				updateId,
				clubId,
				projectId: args.projectId,
				createdAt: now
			});
		}

		return await ctx.db.get(updateId);
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
