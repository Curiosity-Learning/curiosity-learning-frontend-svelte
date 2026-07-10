import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { components } from './_generated/api';
import {
	internalMutation,
	mutation,
	query,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';
import { resolveMediaAssetFileUrl } from './mediaStorage';
import {
	getProfileByAuthUserId,
	listMembershipsForProfile,
	requireIdentity,
	requireProfile
} from './permissions';
import { canViewProject, listAttributedClubIds } from './projectsModel';
import { getUsernameValidationError } from './usernameValidator';

type Ctx = QueryCtx | MutationCtx;

const resolveProfileImageUrl = async (
	ctx: Ctx,
	profile: {
		profileImageMediaAssetId?: Id<'mediaAssets'>;
	}
) => {
	if (!profile.profileImageMediaAssetId) {
		return null;
	}

	const asset = await ctx.db.get(profile.profileImageMediaAssetId);
	if (!asset || asset.status !== 'ready' || asset.mediaKind === 'video') {
		return null;
	}

	return resolveMediaAssetFileUrl(asset) ?? null;
};

const requireOwnedReadyProfileImage = async (
	ctx: MutationCtx,
	userId: string,
	assetId: Id<'mediaAssets'>
) => {
	const asset = await ctx.db.get(assetId);
	if (!asset || asset.ownerUserId !== userId) {
		throw new ConvexError('Profile image not found');
	}
	if (asset.status !== 'ready') {
		throw new ConvexError('Profile image is not ready');
	}
	if (asset.mediaKind === 'video') {
		throw new ConvexError('Profile image must be an image');
	}

	return asset;
};

export const getMe = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		// PRD 6.14.7 (CL-730): deliberately does not go through `requireProfile`'s suspension gate
		// — the (app) layout needs to read `suspendedAt`/`suspendedReason` on a suspended user's
		// own profile to render the account-suspended blocking screen in the first place.
		const profile = await getProfileByAuthUserId(ctx, identity.subject);
		if (!profile) {
			throw new ConvexError('Profile not found');
		}
		return {
			...profile,
			coverPhotoUrl: await resolveProfileImageUrl(ctx, profile)
		};
	}
});

// PRD 5.10: lets the frontend gate the admin link on the profile page and the /admin route
// group without exposing anything else about global roles. Returns null for non-admins so the
// UI has no signal to distinguish "no role" from "not logged in".
export const getMyGlobalRole = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		return profile.globalRole ?? null;
	}
});

export const updateMe = mutation({
	args: {
		firstName: v.optional(v.string()),
		lastName: v.optional(v.string()),
		username: v.optional(v.string()),
		coverPhotoUrl: v.optional(v.string()),
		profileImageMediaAssetId: v.optional(v.id('mediaAssets')),
		dateOfBirth: v.optional(v.string()),
		about: v.optional(v.string()),
		howDidYouFindUs: v.optional(v.string()),
		identity: v.optional(v.string()),
		locationAddress: v.optional(v.string()),
		videoUrl: v.optional(v.string()),
		pendingClubCode: v.optional(v.string()),
		pendingRole: v.optional(v.union(v.literal('Learner'), v.literal('Guide'))),
		firstLoginCompleted: v.optional(v.boolean()),
		fcmToken: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		if (args.username && args.username !== profile.username) {
			const validationError = getUsernameValidationError(args.username);
			if (validationError) {
				throw new ConvexError(validationError);
			}
			const existing = await ctx.db
				.query('profiles')
				.withIndex('by_username', (q) => q.eq('username', args.username))
				.first();
			if (existing && existing._id !== profile._id) {
				throw new ConvexError('Username is already taken');
			}

			const authUserWithUsername = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
				model: 'user',
				where: [{ field: 'username', value: args.username }]
			})) as { _id: string } | null;
			if (authUserWithUsername && authUserWithUsername._id !== identity.subject) {
				throw new ConvexError('Username is already taken');
			}
		}

		let nextCoverPhotoUrl = args.coverPhotoUrl ?? profile.coverPhotoUrl;
		if (args.profileImageMediaAssetId) {
			const asset = await requireOwnedReadyProfileImage(
				ctx,
				identity.subject,
				args.profileImageMediaAssetId
			);
			nextCoverPhotoUrl = resolveMediaAssetFileUrl(asset) ?? undefined;
		}

		await ctx.db.patch(profile._id, {
			...args,
			coverPhotoUrl: nextCoverPhotoUrl,
			updatedAt: Date.now()
		});

		if (args.username && args.username !== profile.username) {
			await ctx.runMutation(components.betterAuth.adapter.updateOne, {
				input: {
					model: 'user',
					where: [{ field: '_id', value: identity.subject }],
					update: {
						username: args.username,
						displayUsername: args.username,
						updatedAt: Date.now()
					}
				}
			});
		}

		const updated = await ctx.db.get(profile._id);
		if (!updated) {
			throw new ConvexError('Profile not found');
		}

		const resolvedCoverPhotoUrl = await resolveProfileImageUrl(ctx, updated);
		const denormalizedCoverPhotoUrl = resolvedCoverPhotoUrl ?? undefined;

		// Keep denormalized club and project membership fields in sync for faster reads.
		const clubMemberships = await listMembershipsForProfile(ctx, updated);
		for (const membership of clubMemberships) {
			if (membership.leftAt) continue;
			await ctx.db.patch(membership._id, {
				profileId: updated._id,
				firstName: updated.firstName,
				lastName: updated.lastName,
				username: updated.username,
				coverPhotoUrl: denormalizedCoverPhotoUrl
			});
		}

		const projectMembershipsByProfile = await ctx.db
			.query('projectMembers')
			.withIndex('by_profile', (q) => q.eq('profileId', updated._id))
			.collect();
		for (const membership of projectMembershipsByProfile) {
			if (membership.leftAt) continue;
			await ctx.db.patch(membership._id, {
				profileId: updated._id,
				firstName: updated.firstName,
				lastName: updated.lastName,
				username: updated.username,
				coverPhotoUrl: denormalizedCoverPhotoUrl
			});
		}

		return {
			...updated,
			coverPhotoUrl: resolvedCoverPhotoUrl ?? undefined
		};
	}
});

/**
 * Minimal username-prefix search for platform-wide user pickers (CL-722's project invite
 * dialog). Prefix match only (no fuzzy/substring search) on `profiles.username`, case-sensitive
 * to match the `by_username` index's stored casing (usernames are already lowercased at
 * signup/update time — see `usernameValidator.ts`). Excludes the caller and any profileIds the
 * caller explicitly asks to exclude (e.g. current active project members). Capped at 10 results.
 */
export const searchByUsername = query({
	args: {
		usernamePrefix: v.string(),
		excludeProfileIds: v.optional(v.array(v.id('profiles')))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const prefix = args.usernamePrefix.trim().toLowerCase();
		if (!prefix) {
			return [];
		}

		const excluded = new Set([profile._id, ...(args.excludeProfileIds ?? [])]);

		const matches = await ctx.db
			.query('profiles')
			.withIndex('by_username', (q) => q.gte('username', prefix).lt('username', `${prefix}￿`))
			.take(20);

		return matches
			.filter((match) => !excluded.has(match._id))
			.slice(0, 10)
			.map((match) => ({
				profileId: match._id,
				firstName: match.firstName ?? null,
				lastName: match.lastName ?? null,
				username: match.username ?? null
			}));
	}
});

export const checkUsernameAvailability = query({
	args: {
		username: v.string()
	},
	handler: async (ctx, args) => {
		const normalized = args.username.trim().toLowerCase();
		const validationError = getUsernameValidationError(normalized);
		if (validationError) {
			return false;
		}
		const existing = await ctx.db
			.query('profiles')
			.withIndex('by_username', (q) => q.eq('username', normalized))
			.first();
		if (existing) {
			return false;
		}

		const authUserWithUsername = await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'username', value: normalized }]
		});
		return !authUserWithUsername;
	}
});

const UPDATES_PREVIEW_LIMIT = 30;

/**
 * PRD 6.12: another user's profile as seen by the authenticated viewer. All content beyond
 * name/username/avatar is visibility-gated for the VIEWER, not the profile owner — a project only
 * appears here if `canViewProject` says the viewer can see it, and updates are filtered to the
 * same set of viewable projects. `sharedClub` on each project/update flags the PRD 6.12.2 case
 * where the item is visible *because* the viewer and profile owner share a club (as opposed to
 * the project being globally visible, or the viewer being a member of the project itself) — the
 * UI uses this to render the "visible because you're in the same club" indicator.
 */
export const getById = query({
	args: {
		profileId: v.id('profiles')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const viewerProfile = await requireProfile(ctx, identity.subject);

		const profile = await ctx.db.get(args.profileId);
		if (!profile) {
			throw new ConvexError('Profile not found');
		}

		const isSelf = profile._id === viewerProfile._id;

		// PRD 6.12.1 "Clubs they're active in, with role per club": excludes left memberships
		// (PRD 6.12.2 only surfaces current standing) and CoC groups, which are internal peer-
		// support groups rather than clubs the wider platform should see someone "in" (mirrors the
		// decision documented for `clubs.getMyClubs`-adjacent surfaces).
		const memberships = (await listMembershipsForProfile(ctx, profile)).filter(
			(membership) => !membership.leftAt
		);
		const clubs: Array<{
			clubId: Id<'clubs'>;
			clubName: string;
			roleKey: 'guide' | 'learner' | null;
			roleName: string | null;
		}> = [];
		const viewerClubIdSet = new Set<Id<'clubs'>>();
		for (const membership of await listMembershipsForProfile(ctx, viewerProfile)) {
			if (!membership.leftAt) viewerClubIdSet.add(membership.clubId);
		}

		for (const membership of memberships) {
			const club = await ctx.db.get(membership.clubId);
			if (!club || club.kind === 'coc') continue;
			const role = await ctx.db.get(membership.roleId);
			clubs.push({
				clubId: club._id,
				clubName: club.name,
				roleKey: role?.key ?? null,
				roleName: role?.name ?? null
			});
		}

		// Gather this profile's project memberships (current PRD 6.6.4 lifecycle state per
		// membership), then resolve visibility + "current vs showcase" per project from the
		// VIEWER's perspective.
		const projectMemberships = await ctx.db
			.query('projectMembers')
			.withIndex('by_profile', (q) => q.eq('profileId', profile._id))
			.collect();

		type ProjectEntry = {
			projectId: Id<'projects'>;
			name: string;
			description: string | null;
			dueDate: number;
			archivedAt: number | null;
			coverImageMediaAssetId: Id<'mediaAssets'> | null;
			section: 'current' | 'showcase';
			sharedClub: boolean;
		};
		const projectEntries: ProjectEntry[] = [];
		const viewableProjectIds = new Map<Id<'projects'>, boolean>(); // projectId -> sharedClub flag
		const seenProjectIds = new Set<Id<'projects'>>();

		for (const membership of projectMemberships) {
			if (seenProjectIds.has(membership.projectId)) continue;
			seenProjectIds.add(membership.projectId);

			const project = await ctx.db.get(membership.projectId);
			if (!project) continue;

			const canView = isSelf || (await canViewProject(ctx, project._id, identity.subject));
			if (!canView) continue;

			// "Shared club" indicator (PRD 6.12.2): true only when the viewer can see the project
			// via clubs-visibility + a currently-shared club, as opposed to the project being
			// globally visible or the viewer already being a member of it themselves.
			let sharedClub = false;
			if (!isSelf && project.visibility === 'clubs') {
				const attributedClubIds = await listAttributedClubIds(ctx, project._id);
				sharedClub = attributedClubIds.some((clubId) => viewerClubIdSet.has(clubId));
			}
			viewableProjectIds.set(project._id, sharedClub);

			// PRD 6.6.4/6.6.7-style Current vs Showcase, applied per-member rather than per-club
			// (there's no single "club" lens on someone's own profile): Showcase = the project is
			// archived, or THIS member's own membership is Done/left; Current = everything else
			// (an active, non-done, non-left membership in a non-archived project).
			const memberIsDoneOrLeft = Boolean(membership.doneDate) || Boolean(membership.leftAt);
			const isShowcase = Boolean(project.archivedAt) || memberIsDoneOrLeft;

			projectEntries.push({
				projectId: project._id,
				name: project.name,
				description: project.description ?? null,
				dueDate: project.dueDate,
				archivedAt: project.archivedAt ?? null,
				coverImageMediaAssetId: project.coverImageMediaAssetId ?? null,
				section: isShowcase ? 'showcase' : 'current',
				sharedClub
			});
		}

		projectEntries.sort((a, b) => b.dueDate - a.dueDate);

		// PRD 6.12.1 "Project updates: chronological feed", filtered to the same visible-project
		// set gathered above (zero-attribution clubs-visibility projects are only viewable here if
		// the viewer is already one of its members, matching `canViewProject`).
		const authoredUpdates = await ctx.db
			.query('updates')
			.withIndex('by_created')
			.order('desc')
			.filter((q) => q.eq(q.field('createdByProfileId'), profile._id))
			.take(UPDATES_PREVIEW_LIMIT * 4);

		const updates: Array<{
			updateId: Id<'updates'>;
			projectId: Id<'projects'> | null;
			projectName: string | null;
			content: string;
			createdAt: number;
			mediaAssetIds: Id<'mediaAssets'>[];
			sharedClub: boolean;
		}> = [];

		for (const update of authoredUpdates) {
			if (updates.length >= UPDATES_PREVIEW_LIMIT) break;
			// PRD 6.14.4 (CL-730): taken-down updates disappear from another viewer's profile-page
			// listing of this profile's updates.
			if (update.takedown) continue;
			if (!update.projectId) continue;

			let sharedClub = viewableProjectIds.get(update.projectId);
			if (sharedClub === undefined) {
				const canView = isSelf || (await canViewProject(ctx, update.projectId, identity.subject));
				if (!canView) continue;
				sharedClub = false;
				if (!isSelf) {
					const project = await ctx.db.get(update.projectId);
					if (project?.visibility === 'clubs') {
						const attributedClubIds = await listAttributedClubIds(ctx, update.projectId);
						sharedClub = attributedClubIds.some((clubId) => viewerClubIdSet.has(clubId));
					}
				}
				viewableProjectIds.set(update.projectId, sharedClub);
			}

			const project: Doc<'projects'> | null = await ctx.db.get(update.projectId);
			const files = await ctx.db
				.query('updateFiles')
				.withIndex('by_update', (q) => q.eq('updateId', update._id))
				.collect();
			updates.push({
				updateId: update._id,
				projectId: update.projectId,
				projectName: project?.name ?? null,
				content: update.content,
				createdAt: update.createdAt,
				mediaAssetIds: files.map((file) => file.mediaAssetId),
				sharedClub
			});
		}

		return {
			profileId: profile._id,
			isSelf,
			firstName: profile.firstName ?? null,
			lastName: profile.lastName ?? null,
			username: profile.username ?? null,
			about: profile.about ?? null,
			profileImageMediaAssetId: profile.profileImageMediaAssetId ?? null,
			clubs,
			projects: {
				current: projectEntries.filter((entry) => entry.section === 'current'),
				showcase: projectEntries.filter((entry) => entry.section === 'showcase')
			},
			updates
		};
	}
});

// Scoped strictly to the target profile's own avatar asset (not an arbitrary-asset-id lookup):
// an authenticated viewer may resolve any other profile's avatar (profiles are visible platform-
// wide per PRD 6.12.2), but only that profile's `profileImageMediaAssetId`, not other assets.
export const getProfileDeliveryAssets = query({
	args: {
		profileId: v.id('profiles'),
		assetIds: v.array(v.id('mediaAssets'))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireProfile(ctx, identity.subject);
		const requestedAssetIds = [...new Set(args.assetIds)];
		if (!requestedAssetIds.length) {
			return [];
		}

		const targetProfile = await ctx.db.get(args.profileId);
		const allowedAssetId = targetProfile?.profileImageMediaAssetId ?? null;

		const deliveryAssets = await Promise.all(
			requestedAssetIds
				.filter((assetId) => assetId === allowedAssetId)
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

		return deliveryAssets.filter(
			(asset): asset is NonNullable<typeof asset> => asset !== null
		);
	}
});

// PRD 5.10: internal-only for v1 — global role assignment happens via CLI/ops
// (`npx convex run profiles:setGlobalRole '{"profileId": "...", "globalRole": "admin"}'`), not
// through any UI or public mutation. There is intentionally no public endpoint that can grant
// this role to avoid privilege escalation via the app itself.
export const setGlobalRole = internalMutation({
	args: {
		profileId: v.id('profiles'),
		globalRole: v.optional(v.literal('admin'))
	},
	handler: async (ctx, args) => {
		const profile = await ctx.db.get(args.profileId);
		if (!profile) {
			throw new ConvexError('Profile not found');
		}
		await ctx.db.patch(args.profileId, { globalRole: args.globalRole, updatedAt: Date.now() });
	}
});
