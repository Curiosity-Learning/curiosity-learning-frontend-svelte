import { ConvexError, v } from 'convex/values';
import type { GenericCtx } from '@convex-dev/better-auth';
import type { GenericDataModel } from 'convex/server';
import { internalMutation, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { resolveMediaAssetFileUrl } from './mediaStorage';
import {
	hasPermission,
	getClubRoleByKey,
	getProfileByAuthUserId,
	getProfileAuthUserId,
	getRelatedProfile,
	getMembership,
	listMembershipsForProfile,
	requireIdentity,
	requirePermission,
	requireProfile,
	roleFromPermissions
} from './permissions';
import { authComponent } from './auth';
import { ensureClubRoom } from './chatModel';
import { isRateLimited, recordRateLimitAttempt } from './rateLimiting';
import { dayOfWeekValidator, isEndTimeAfterStartTime, isValidTimeString } from './scheduleModel';

// Authenticated users get a per-user window; unauthenticated code-preview lookups have no
// reliable client identity in a Convex function, so we apply a modest global-per-code
// window purely as brute-force damping. The global window only damps scanning of a single
// code; it does not protect against distributed guessing across many codes.
const CLUB_CODE_USER_RATE_LIMIT = { maxAttempts: 20, windowMs: 60_000 };
const CLUB_CODE_GLOBAL_RATE_LIMIT = { maxAttempts: 30, windowMs: 60_000 };

const clubCodeRateLimitScope = (normalizedCode: string, authUserId: string | null) =>
	authUserId
		? { key: `club-code:user:${authUserId}`, limit: CLUB_CODE_USER_RATE_LIMIT }
		: { key: `club-code:code:${normalizedCode}`, limit: CLUB_CODE_GLOBAL_RATE_LIMIT };

const INVITE_CODE_PATTERN = /^[A-Z0-9]{6}$/;
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
type Ctx = QueryCtx | MutationCtx;
type ActiveClubContext = {
	activeClubId: Id<'clubs'> | null;
	role: 'Guide' | 'Learner' | null;
	permissions: string[];
};

const normalizeInviteCode = (code: string) => code.trim().toUpperCase();
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const createInviteCodeCandidate = () => {
	let code = '';
	for (let index = 0; index < 6; index += 1) {
		code += INVITE_ALPHABET[Math.floor(Math.random() * INVITE_ALPHABET.length)];
	}
	return code;
};

const createInviteCode = async (ctx: Ctx) => {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const code = createInviteCodeCandidate();
		const existingLearnerCode = await ctx.db
			.query('clubs')
			.withIndex('by_club_code', (q) => q.eq('clubCode', code))
			.first();
		const existingGuideCode = await ctx.db
			.query('clubs')
			.withIndex('by_guide_invite_code', (q) => q.eq('guideInviteCode', code))
			.first();
		if (!existingLearnerCode && !existingGuideCode) {
			return code;
		}
	}
	throw new ConvexError('Failed to generate unique invite code');
};

const resolveClubByCode = async (ctx: Ctx, normalizedCode: string) => {
	const club = await ctx.db
		.query('clubs')
		.withIndex('by_club_code', (q) => q.eq('clubCode', normalizedCode))
		.first();
	if (!club || club.abandonedAt) {
		return null;
	}

	return {
		club,
		code: normalizedCode
	};
};

// Guide invite codes join with the Guide role (PRD 6.1.8). Kept as a separate index/field from
// `clubCode` so the existing learner join code and link are unaffected.
const resolveClubByGuideInviteCode = async (ctx: Ctx, normalizedCode: string) => {
	const club = await ctx.db
		.query('clubs')
		.withIndex('by_guide_invite_code', (q) => q.eq('guideInviteCode', normalizedCode))
		.first();
	if (!club || club.abandonedAt) {
		return null;
	}

	return {
		club,
		code: normalizedCode
	};
};

const getRoleByKey = async (ctx: Ctx, key: 'guide' | 'learner') => {
	const role = await getClubRoleByKey(ctx, key);
	if (!role) {
		throw new ConvexError(`Default role ${key} is not configured`);
	}
	return role;
};

const KICK_REASON_MAX_LENGTH = 500;

const listActiveMembers = async (ctx: Ctx, clubId: Id<'clubs'>) => {
	const members = await ctx.db
		.query('clubMembers')
		.withIndex('by_club', (q) => q.eq('clubId', clubId))
		.collect();
	return members.filter((member) => !member.leftAt);
};

const countActiveGuides = async (ctx: Ctx, clubId: Id<'clubs'>, guideRoleId: Id<'clubRoles'>) => {
	const activeMembers = await listActiveMembers(ctx, clubId);
	return activeMembers.filter((member) => member.roleId === guideRoleId).length;
};

const requireOwnedReadyClubVideo = async (
	ctx: MutationCtx,
	userId: string,
	assetId: Id<'mediaAssets'>
) => {
	const asset = await ctx.db.get(assetId);
	if (!asset || asset.ownerUserId !== userId) {
		throw new ConvexError('Club video not found');
	}
	if (asset.status !== 'ready') {
		throw new ConvexError('Club video is not ready');
	}
	if (asset.mediaKind !== 'video') {
		throw new ConvexError('Club video must be a video');
	}

	return asset;
};

const listScheduleSlotsForClub = async (ctx: Ctx, clubId: Id<'clubs'>) => {
	return await ctx.db
		.query('clubScheduleSlots')
		.withIndex('by_club', (q) => q.eq('clubId', clubId))
		.collect();
};

const resolveClubVideoUrl = async (ctx: Ctx, club: Doc<'clubs'>) => {
	if (!club.videoMediaAssetId) {
		return null;
	}

	const asset = await ctx.db.get(club.videoMediaAssetId);
	if (!asset || asset.status !== 'ready' || asset.mediaKind !== 'video') {
		return null;
	}

	return resolveMediaAssetFileUrl(asset);
};

const mapClubListItem = async (ctx: Ctx, club: Doc<'clubs'>, membership: Doc<'clubMembers'>) => {
	const role = await ctx.db.get(membership.roleId);
	const profile = await getRelatedProfile(ctx, membership.profileId);
	const clubVideoUrl = await resolveClubVideoUrl(ctx, club);
	const scheduleSlots = await listScheduleSlotsForClub(ctx, club._id);

	return {
		clubId: club._id,
		clubCreatedAt: club.createdAt,
		clubName: club.name,
		clubDescription: club.description ?? null,
		clubLocation: club.location ?? null,
		clubLocationLatitude: club.locationLatitude ?? null,
		clubLocationLongitude: club.locationLongitude ?? null,
		clubTime: club.time ?? null,
		clubVideoUrl,
		clubScheduleSlots: scheduleSlots,
		clubCode: club.clubCode ?? null,
		clubGuideInviteCode: club.guideInviteCode ?? null,
		clubDiscoverable: club.discoverable,
		memberId: membership._id,
		memberProfileId: profile?._id ?? null,
		memberUserId: profile ? getProfileAuthUserId(profile) : null,
		memberLeftAt: membership.leftAt ?? null,
		roleId: role?._id ?? null,
		roleKey: role?.key ?? null,
		roleName: role?.name ?? null,
		roleDescription: role?.description ?? null,
		roleColor: role?.color ?? null,
		rolePermissions: role?.permissions ?? []
	};
};

const splitNameParts = (name?: string | null) => {
	if (!name) {
		return { firstName: undefined, lastName: undefined };
	}
	const normalized = name.trim();
	if (!normalized) {
		return { firstName: undefined, lastName: undefined };
	}
	const [first, ...rest] = normalized.split(/\s+/);
	const last = rest.join(' ').trim();
	return {
		firstName: first || undefined,
		lastName: last || undefined
	};
};

const resolveUniqueUsername = async (
	ctx: MutationCtx,
	userId: string,
	email: string
): Promise<string | undefined> => {
	const preferred = email.split('@')[0]?.trim().toLowerCase() ?? '';
	if (!preferred) return undefined;

	const firstMatch = await ctx.db
		.query('profiles')
		.withIndex('by_username', (q) => q.eq('username', preferred))
		.first();
	if (!firstMatch || firstMatch.authUserId === userId) {
		return preferred;
	}

	for (let suffix = 2; suffix <= 99; suffix += 1) {
		const candidate = `${preferred}${suffix}`;
		const match = await ctx.db
			.query('profiles')
			.withIndex('by_username', (q) => q.eq('username', candidate))
			.first();
		if (!match || match.authUserId === userId) {
			return candidate;
		}
	}

	return undefined;
};

const getOrCreateProfile = async (ctx: MutationCtx, userId: string) => {
	const existing = await getProfileByAuthUserId(ctx, userId);
	if (existing) {
		return existing;
	}

	const authUser = await authComponent.getAuthUser(ctx as unknown as GenericCtx<GenericDataModel>);
	const now = Date.now();
	const username = await resolveUniqueUsername(ctx, authUser._id, authUser.email);
	const { firstName, lastName } = splitNameParts(authUser.name);

	const profileId = await ctx.db.insert('profiles', {
		authUserId: authUser._id,
		firstName,
		lastName,
		username,
		coverPhotoUrl: authUser.image ?? undefined,
		isVerified: authUser.emailVerified,
		firstLoginCompleted: false,
		updatedAt: now
	});

	const created = await ctx.db.get(profileId);
	if (!created) {
		throw new ConvexError('Profile not found');
	}
	return created;
};

export const getMyClubs = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const memberships = await listMembershipsForProfile(ctx, profile);

		const activeMemberships = memberships.filter((membership) => !membership.leftAt);
		const clubs = await Promise.all(
			activeMemberships.map((membership) => ctx.db.get(membership.clubId))
		);

		const items = [] as Awaited<ReturnType<typeof mapClubListItem>>[];
		for (let index = 0; index < activeMemberships.length; index += 1) {
			const club = clubs[index];
			if (!club) {
				continue;
			}
			items.push(await mapClubListItem(ctx, club, activeMemberships[index]));
		}

		return items;
	}
});

export const getClubPreviewByCode = query({
	args: {
		code: v.string()
	},
	handler: async (ctx, args) => {
		const normalizedCode = normalizeInviteCode(args.code);
		if (!INVITE_CODE_PATTERN.test(normalizedCode)) {
			return null;
		}

		// Learner codes are checked first; a guide invite code only ever matches when it isn't
		// also a (distinct, randomly-generated) learner code for a different club.
		const resolvedLearner = await resolveClubByCode(ctx, normalizedCode);
		const resolved = resolvedLearner ?? (await resolveClubByGuideInviteCode(ctx, normalizedCode));
		if (!resolved) {
			return null;
		}
		const { club, code } = resolved;
		const joinRole: 'guide' | 'learner' = resolvedLearner ? 'learner' : 'guide';

		const members = await ctx.db
			.query('clubMembers')
			.withIndex('by_club', (q) => q.eq('clubId', club._id))
			.collect();

		return {
			success: true,
			id: club._id,
			name: club.name,
			description: club.description ?? null,
			videoMediaAssetId: club.videoMediaAssetId ?? null,
			videoUrl: await resolveClubVideoUrl(ctx, club),
			location: club.location ?? null,
			locationLatitude: club.locationLatitude ?? null,
			locationLongitude: club.locationLongitude ?? null,
			scheduleSlots: await listScheduleSlotsForClub(ctx, club._id),
			memberCount: members.filter((member) => !member.leftAt).length,
			createdAt: club.createdAt,
			code,
			joinRole
		};
	}
});

// Public preview by stable club id (CL-711): only ever resolves discoverable, non-abandoned
// clubs so it can be linked to permanently (map pins, public club pages) without leaking
// private clubs. Unlike getClubPreviewByCode, this never returns a join code — instant join
// stays code-only; this preview only supports the "Request to join" entry point.
export const getClubPreviewById = query({
	args: {
		clubId: v.id('clubs')
	},
	handler: async (ctx, args) => {
		const club = await ctx.db.get(args.clubId);
		if (!club || !club.discoverable || club.abandonedAt) {
			return null;
		}

		const members = await ctx.db
			.query('clubMembers')
			.withIndex('by_club', (q) => q.eq('clubId', club._id))
			.collect();

		const identity = await ctx.auth.getUserIdentity();
		let viewerIsMember = false;
		let viewerPendingJoinRequestId: Id<'joinRequests'> | null = null;
		if (identity) {
			const profile = await getProfileByAuthUserId(ctx, identity.subject);
			if (profile) {
				const membership = await getMembership(ctx, club._id, identity.subject);
				viewerIsMember = Boolean(membership);
				const requests = await ctx.db
					.query('joinRequests')
					.withIndex('by_club_and_requester', (q) =>
						q.eq('clubId', club._id).eq('requesterProfileId', profile._id)
					)
					.collect();
				const pending = requests.find((request) => request.status === 'pending');
				viewerPendingJoinRequestId = pending?._id ?? null;
			}
		}

		return {
			id: club._id,
			name: club.name,
			description: club.description ?? null,
			videoMediaAssetId: club.videoMediaAssetId ?? null,
			videoUrl: await resolveClubVideoUrl(ctx, club),
			location: club.location ?? null,
			locationLatitude: club.locationLatitude ?? null,
			locationLongitude: club.locationLongitude ?? null,
			scheduleSlots: await listScheduleSlotsForClub(ctx, club._id),
			memberCount: members.filter((member) => !member.leftAt).length,
			createdAt: club.createdAt,
			viewerIsMember,
			viewerPendingJoinRequestId
		};
	}
});

// Convex queries cannot write to the database, so rate-limit bookkeeping for the
// (read-only) `getClubPreviewByCode` query is tracked by this companion mutation.
// Callers must invoke this before running the preview query and stop if it reports
// `rate_limited`. Returns a structured result instead of throwing so the attempt
// counter write always commits (a throwing mutation rolls back all of its writes).
export const checkClubCodeLookupRateLimit = mutation({
	args: {
		code: v.string()
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		const normalizedCode = normalizeInviteCode(args.code);
		const { key, limit } = clubCodeRateLimitScope(normalizedCode, identity?.subject ?? null);

		if (await isRateLimited(ctx, key, limit)) {
			return { ok: false as const, error: 'rate_limited' as const };
		}

		await recordRateLimitAttempt(ctx, key, limit);
		return { ok: true as const };
	}
});

export const getClubPreviewDeliveryAssetByCode = query({
	args: {
		code: v.string()
	},
	handler: async (ctx, args) => {
		const normalizedCode = normalizeInviteCode(args.code);
		if (!INVITE_CODE_PATTERN.test(normalizedCode)) {
			return null;
		}

		const resolved = await resolveClubByCode(ctx, normalizedCode);
		if (!resolved?.club.videoMediaAssetId) {
			return null;
		}

		const asset = await ctx.db.get(resolved.club.videoMediaAssetId);
		if (!asset || asset.status !== 'ready' || asset.mediaKind !== 'video') {
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
});

export const listPublicClubs = query({
	args: {},
	handler: async (ctx) => {
		const clubs = await ctx.db.query('clubs').collect();
		// Belt and braces: abandonment already clears clubCode/discoverable, but exclude
		// abandoned clubs explicitly too (PRD 6.2.3 — no one can join an abandoned club).
		const publicClubs = clubs.filter(
			(club) => Boolean(club.clubCode) && club.discoverable && !club.abandonedAt
		);

		return await Promise.all(
			publicClubs.map(async (club) => {
				const members = await ctx.db
					.query('clubMembers')
					.withIndex('by_club', (q) => q.eq('clubId', club._id))
					.collect();

				return {
					id: club._id,
					code: club.clubCode ?? null,
					name: club.name,
					description: club.description ?? null,
					location: club.location ?? null,
					locationLatitude: club.locationLatitude ?? null,
					locationLongitude: club.locationLongitude ?? null,
					scheduleSlots: await listScheduleSlotsForClub(ctx, club._id),
					memberCount: members.filter((member) => !member.leftAt).length,
					videoUrl: await resolveClubVideoUrl(ctx, club),
					createdAt: club.createdAt
				};
			})
		);
	}
});

export const submitClubInterestSignup = mutation({
	args: {
		email: v.string(),
		location: v.string(),
		locationLatitude: v.optional(v.number()),
		locationLongitude: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const email = normalizeEmail(args.email);
		const location = args.location.trim();
		if (!EMAIL_PATTERN.test(email)) {
			throw new ConvexError('Enter a valid email address');
		}
		if (!location) {
			throw new ConvexError('Enter a location');
		}

		const now = Date.now();
		const existing = await ctx.db
			.query('clubInterestSignups')
			.withIndex('by_email', (q) => q.eq('email', email))
			.first();

		const patch = {
			location,
			locationLatitude: args.locationLatitude,
			locationLongitude: args.locationLongitude,
			updatedAt: now
		};

		if (existing) {
			await ctx.db.patch(existing._id, patch);
			return { success: true };
		}

		const signupId = await ctx.db.insert('clubInterestSignups', {
			email,
			...patch,
			createdAt: now
		});

		await ctx.scheduler.runAfter(0, internal.googleChat.notifyClubInterestSignupCreated, {
			signupId,
			email,
			location
		});

		return { success: true };
	}
});

export const createClub = mutation({
	args: {
		name: v.string(),
		description: v.optional(v.string()),
		location: v.optional(v.string()),
		locationLatitude: v.optional(v.number()),
		locationLongitude: v.optional(v.number()),
		videoMediaAssetId: v.optional(v.id('mediaAssets')),
		scheduleSlots: v.optional(
			v.array(
				v.object({
					dayOfWeek: dayOfWeekValidator,
					startTime: v.string(),
					endTime: v.string(),
					location: v.string()
				})
			)
		)
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const now = Date.now();

		const profile = await getOrCreateProfile(ctx, identity.subject);
		const inviteCode = await createInviteCode(ctx);

		if (args.videoMediaAssetId) {
			await requireOwnedReadyClubVideo(ctx, identity.subject, args.videoMediaAssetId);
		}

		for (const slot of args.scheduleSlots ?? []) {
			if (!isValidTimeString(slot.startTime) || !isValidTimeString(slot.endTime)) {
				throw new ConvexError('Times must be in HH:MM 24-hour format');
			}
			if (!isEndTimeAfterStartTime(slot.startTime, slot.endTime)) {
				throw new ConvexError('End time must be after start time');
			}
			if (!slot.location.trim()) {
				throw new ConvexError('Location is required');
			}
		}

		const clubId = await ctx.db.insert('clubs', {
			name: args.name,
			clubCode: inviteCode,
			description: args.description,
			location: args.location,
			locationLatitude: args.locationLatitude,
			locationLongitude: args.locationLongitude,
			videoMediaAssetId: args.videoMediaAssetId,
			// Private by default: newly created clubs must be explicitly opted in to discovery.
			discoverable: false,
			createdByProfileId: profile._id,
			createdAt: now,
			updatedAt: now
		});

		for (const slot of args.scheduleSlots ?? []) {
			await ctx.db.insert('clubScheduleSlots', {
				clubId,
				dayOfWeek: slot.dayOfWeek,
				startTime: slot.startTime,
				endTime: slot.endTime,
				location: slot.location.trim(),
				createdAt: now,
				updatedAt: now
			});
		}
		await ensureClubRoom(ctx, clubId);

		const guideRole = await getRoleByKey(ctx, 'guide');
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: profile._id,
			roleId: guideRole._id,
			firstName: profile.firstName,
			lastName: profile.lastName,
			username: profile.username,
			coverPhotoUrl: profile.coverPhotoUrl,
			createdAt: now
		});

		await ctx.db.patch(profile._id, {
			activeClubId: clubId,
			firstLoginCompleted: true,
			updatedAt: now
		});

		return { clubId, code: inviteCode };
	}
});

export const joinClubWithCode = mutation({
	args: {
		code: v.string()
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const normalizedCode = normalizeInviteCode(args.code);
		const { key, limit } = clubCodeRateLimitScope(normalizedCode, identity.subject);

		// Rate-limited paths return structured results instead of throwing: a throwing
		// mutation rolls back ALL of its writes (including scheduler calls), so recording
		// a failed attempt and then throwing would never persist the counter.
		if (await isRateLimited(ctx, key, limit)) {
			return { ok: false as const, error: 'rate_limited' as const };
		}

		const resolved = INVITE_CODE_PATTERN.test(normalizedCode)
			? await resolveClubByCode(ctx, normalizedCode)
			: null;
		if (!resolved) {
			// Count the failed attempt; the write commits because we return, not throw.
			// Deliberately generic: the caller cannot distinguish "malformed" from
			// "well-formed but nonexistent" codes.
			await recordRateLimitAttempt(ctx, key, limit);
			return { ok: false as const, error: 'invalid_code' as const };
		}
		const { club } = resolved;

		const existingMembership = await getMembership(ctx, club._id, identity.subject);
		if (existingMembership) {
			// Not counted as a failed code attempt: the code was valid.
			throw new ConvexError('You are already a member of this club');
		}

		const profile = await getOrCreateProfile(ctx, identity.subject);
		await ensureClubRoom(ctx, club._id);

		const learnerRole = await getRoleByKey(ctx, 'learner');
		await ctx.db.insert('clubMembers', {
			clubId: club._id,
			profileId: profile._id,
			roleId: learnerRole._id,
			firstName: profile.firstName,
			lastName: profile.lastName,
			username: profile.username,
			coverPhotoUrl: profile.coverPhotoUrl,
			createdAt: Date.now()
		});
		await ctx.db.patch(profile._id, {
			activeClubId: club._id,
			firstLoginCompleted: true,
			pendingClubCode: undefined,
			pendingRole: undefined,
			updatedAt: Date.now()
		});

		return {
			ok: true as const,
			clubId: club._id
		};
	}
});

// Distinct from `joinClubWithCode`: this code always grants the Guide role and has no rate
// limiting of its own beyond the shared per-user/global code-guessing damping, since guide
// invite codes are shared privately by existing Guides (PRD 6.1.8 — "no application process").
export const joinClubWithGuideInviteCode = mutation({
	args: {
		code: v.string()
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const normalizedCode = normalizeInviteCode(args.code);
		const { key, limit } = clubCodeRateLimitScope(normalizedCode, identity.subject);

		if (await isRateLimited(ctx, key, limit)) {
			return { ok: false as const, error: 'rate_limited' as const };
		}

		const resolved = INVITE_CODE_PATTERN.test(normalizedCode)
			? await resolveClubByGuideInviteCode(ctx, normalizedCode)
			: null;
		if (!resolved) {
			await recordRateLimitAttempt(ctx, key, limit);
			return { ok: false as const, error: 'invalid_code' as const };
		}
		const { club } = resolved;

		const existingMembership = await getMembership(ctx, club._id, identity.subject);
		if (existingMembership) {
			throw new ConvexError('You are already a member of this club');
		}

		const profile = await getOrCreateProfile(ctx, identity.subject);
		await ensureClubRoom(ctx, club._id);

		const guideRole = await getRoleByKey(ctx, 'guide');
		await ctx.db.insert('clubMembers', {
			clubId: club._id,
			profileId: profile._id,
			roleId: guideRole._id,
			firstName: profile.firstName,
			lastName: profile.lastName,
			username: profile.username,
			coverPhotoUrl: profile.coverPhotoUrl,
			createdAt: Date.now()
		});
		await ctx.db.patch(profile._id, {
			activeClubId: club._id,
			firstLoginCompleted: true,
			pendingClubCode: undefined,
			pendingRole: undefined,
			updatedAt: Date.now()
		});

		return {
			ok: true as const,
			clubId: club._id
		};
	}
});

export const switchActiveClub = mutation({
	args: {
		clubId: v.id('clubs')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const membership = await getMembership(ctx, args.clubId, identity.subject);
		if (!membership) {
			throw new ConvexError('You are not a member of this club');
		}

		const profile = await getOrCreateProfile(ctx, identity.subject);
		await ctx.db.patch(profile._id, {
			activeClubId: args.clubId,
			updatedAt: Date.now()
		});

		return { success: true };
	}
});

export const getActiveClubContext = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await getProfileByAuthUserId(ctx, identity.subject);
		if (!profile) {
			return {
				activeClubId: null,
				role: null,
				permissions: []
			} satisfies ActiveClubContext;
		}

		if (!profile.activeClubId) {
			return {
				activeClubId: null,
				role: null,
				permissions: []
			} satisfies ActiveClubContext;
		}

		const membership = await getMembership(ctx, profile.activeClubId, identity.subject);
		if (!membership) {
			return {
				activeClubId: profile.activeClubId,
				role: null,
				permissions: []
			} satisfies ActiveClubContext;
		}

		const role = await ctx.db.get(membership.roleId);
		return {
			activeClubId: profile.activeClubId,
			role: roleFromPermissions(role),
			permissions: role?.permissions ?? []
		} satisfies ActiveClubContext;
	}
});

export const getClubById = query({
	args: {
		clubId: v.id('clubs')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const canRead = await hasPermission(ctx, args.clubId, identity.subject, 'club:read');
		if (!canRead) {
			throw new ConvexError('Permission denied');
		}

		const club = await ctx.db.get(args.clubId);
		if (!club) {
			throw new ConvexError('Club not found');
		}

		return {
			...club,
			videoUrl: await resolveClubVideoUrl(ctx, club),
			clubCode: club.clubCode ?? null,
			guideInviteCode: club.guideInviteCode ?? null
		};
	}
});

export const updateClub = mutation({
	args: {
		clubId: v.id('clubs'),
		name: v.optional(v.string()),
		description: v.optional(v.union(v.string(), v.null())),
		location: v.optional(v.union(v.string(), v.null())),
		locationLatitude: v.optional(v.union(v.number(), v.null())),
		locationLongitude: v.optional(v.union(v.number(), v.null())),
		videoMediaAssetId: v.optional(v.id('mediaAssets')),
		discoverable: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requirePermission(ctx, args.clubId, identity.subject, 'club:edit');

		const club = await ctx.db.get(args.clubId);
		if (!club) {
			throw new ConvexError('Club not found');
		}

		if (args.videoMediaAssetId) {
			await requireOwnedReadyClubVideo(ctx, identity.subject, args.videoMediaAssetId);
		}

		const normalizeRequired = (value: string | undefined, fallback: string) => {
			if (value === undefined) return fallback;
			const normalized = value.trim();
			if (!normalized) {
				throw new ConvexError('Club name is required');
			}
			return normalized;
		};
		const normalizeOptional = (value: string | null | undefined, fallback?: string) => {
			if (value === undefined) return fallback;
			if (value === null) return undefined;
			return value.trim() || undefined;
		};
		const optionalNumber = (value: number | null | undefined, fallback?: number) => {
			if (value === undefined) return fallback;
			return value === null ? undefined : value;
		};

		await ctx.db.patch(args.clubId, {
			name: normalizeRequired(args.name, club.name),
			description: normalizeOptional(args.description, club.description),
			location: normalizeOptional(args.location, club.location),
			locationLatitude: optionalNumber(args.locationLatitude, club.locationLatitude),
			locationLongitude: optionalNumber(args.locationLongitude, club.locationLongitude),
			videoMediaAssetId: args.videoMediaAssetId ?? club.videoMediaAssetId,
			discoverable: args.discoverable ?? club.discoverable,
			updatedAt: Date.now()
		});

		return await ctx.db.get(args.clubId);
	}
});

export const resetClubCode = mutation({
	args: {
		clubId: v.id('clubs')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requirePermission(ctx, args.clubId, identity.subject, 'club:edit');

		const club = await ctx.db.get(args.clubId);
		if (!club) {
			throw new ConvexError('Club not found');
		}

		const newCode = await createInviteCode(ctx);
		await ctx.db.patch(args.clubId, {
			clubCode: newCode,
			updatedAt: Date.now()
		});

		return { code: newCode };
	}
});

// Guides use this to generate or rotate the separate Guide invite code (PRD 6.1.8). Gated by
// `club_member:invite_guide` rather than `club:edit` so it follows the same permission as the
// members-page invite action, not general club settings editing.
export const createOrRotateGuideInviteCode = mutation({
	args: {
		clubId: v.id('clubs')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requirePermission(ctx, args.clubId, identity.subject, 'club_member:invite_guide');

		const club = await ctx.db.get(args.clubId);
		if (!club) {
			throw new ConvexError('Club not found');
		}

		const newCode = await createInviteCode(ctx);
		await ctx.db.patch(args.clubId, {
			guideInviteCode: newCode,
			updatedAt: Date.now()
		});

		return { code: newCode };
	}
});

export const getMembers = query({
	args: {
		clubId: v.id('clubs'),
		roleKey: v.optional(v.union(v.literal('guide'), v.literal('learner')))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const canRead = await hasPermission(
			ctx,
			args.clubId,
			identity.subject,
			'club_member:read_active'
		);
		if (!canRead) {
			throw new ConvexError('Permission denied');
		}

		const members = await ctx.db
			.query('clubMembers')
			.withIndex('by_club', (q) => q.eq('clubId', args.clubId))
			.collect();

		const activeMembers = members.filter((member) => !member.leftAt);
		const output: Array<{
			clubMemberId: Id<'clubMembers'>;
			profileId: Id<'profiles'>;
			userId: string;
			roleId: Id<'clubRoles'>;
			roleKey: 'guide' | 'learner' | null;
			roleName: string | null;
			rolePermissions: string[];
			firstName: string | null;
			lastName: string | null;
			username: string | null;
			coverPhotoUrl: string | null;
			profileImageMediaAssetId: Id<'mediaAssets'> | null;
		}> = [];

		for (const member of activeMembers) {
			const role = await ctx.db.get(member.roleId);
			if (args.roleKey && role?.key !== args.roleKey) {
				continue;
			}

			const profile = await getRelatedProfile(ctx, member.profileId);
			if (!profile) continue;
			const authUserId = getProfileAuthUserId(profile);

			// Fall back to the profiles table when denormalized fields are missing
			let { firstName, lastName, username } = member;
			if (profile) {
				firstName = firstName ?? profile.firstName;
				lastName = lastName ?? profile.lastName;
				username = username ?? profile.username;
			}

			output.push({
				clubMemberId: member._id,
				profileId: profile._id,
				userId: authUserId,
				roleId: member.roleId,
				roleKey: role?.key ?? null,
				roleName: role?.name ?? null,
				rolePermissions: role?.permissions ?? [],
				firstName: firstName ?? null,
				lastName: lastName ?? null,
				username: username ?? null,
				coverPhotoUrl: null,
				profileImageMediaAssetId: profile?.profileImageMediaAssetId ?? null
			});
		}

		return output;
	}
});

export const getMemberProfileDeliveryAssets = query({
	args: {
		clubId: v.id('clubs'),
		assetIds: v.array(v.id('mediaAssets'))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const canRead = await hasPermission(
			ctx,
			args.clubId,
			identity.subject,
			'club_member:read_active'
		);
		if (!canRead) {
			throw new ConvexError('Permission denied');
		}

		const requestedAssetIds = [...new Set(args.assetIds)];
		if (!requestedAssetIds.length) {
			return [];
		}

		const members = await ctx.db
			.query('clubMembers')
			.withIndex('by_club', (q) => q.eq('clubId', args.clubId))
			.collect();
		const activeMembers = members.filter((member) => !member.leftAt);
		const profiles = await Promise.all(
			activeMembers.map((member) => getRelatedProfile(ctx, member.profileId))
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

export const getProfileDeliveryAssets = query({
	args: {
		clubId: v.id('clubs'),
		assetIds: v.array(v.id('mediaAssets'))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const canRead = await hasPermission(ctx, args.clubId, identity.subject, 'club:read');
		if (!canRead) {
			throw new ConvexError('Permission denied');
		}

		const requestedAssetIds = [...new Set(args.assetIds)];
		if (!requestedAssetIds.length) {
			return [];
		}

		const members = await ctx.db
			.query('clubMembers')
			.withIndex('by_club', (q) => q.eq('clubId', args.clubId))
			.collect();
		const activeMembers = members.filter((member) => !member.leftAt);
		const profiles = await Promise.all(
			activeMembers.map((member) => getRelatedProfile(ctx, member.profileId))
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

export const kickMember = mutation({
	args: {
		clubMemberId: v.id('clubMembers'),
		reason: v.string()
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const reason = args.reason.trim();
		if (!reason) {
			throw new ConvexError('A reason is required to remove a member');
		}
		if (reason.length > KICK_REASON_MAX_LENGTH) {
			throw new ConvexError(`Reason must be ${KICK_REASON_MAX_LENGTH} characters or fewer`);
		}

		const target = await ctx.db.get(args.clubMemberId);
		if (!target || target.leftAt) {
			throw new ConvexError('Member not found');
		}

		await requirePermission(ctx, target.clubId, identity.subject, 'club_member:kick');

		const kickerMembership = await getMembership(ctx, target.clubId, identity.subject);
		if (!kickerMembership) {
			throw new ConvexError('You are not an active member of this club');
		}

		const kickerRole = await ctx.db.get(kickerMembership.roleId);
		const targetRole = await ctx.db.get(target.roleId);
		if (!kickerRole || !targetRole || kickerRole.order >= targetRole.order) {
			throw new ConvexError('You cannot remove a member with equal or higher role');
		}

		await ctx.db.patch(args.clubMemberId, {
			leftAt: Date.now(),
			kickReason: reason,
			kickedByProfileId: kickerMembership.profileId
		});

		const club = await ctx.db.get(target.clubId);
		await ctx.runMutation(internal.notifications.createSystemNotification, {
			profileId: target.profileId,
			clubId: target.clubId,
			title: 'Removed from club',
			message: `You have been removed from ${club?.name ?? 'the club'}. Reason: ${reason}`
		});

		return { success: true };
	}
});

export const promoteMember = mutation({
	args: {
		clubMemberId: v.id('clubMembers')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const target = await ctx.db.get(args.clubMemberId);
		if (!target || target.leftAt) {
			throw new ConvexError('Member not found');
		}

		await requirePermission(ctx, target.clubId, identity.subject, 'club_member:promote');

		const targetRole = await ctx.db.get(target.roleId);
		if (targetRole?.key !== 'learner') {
			throw new ConvexError('Only Learners can be promoted to Guide');
		}

		const guideRole = await getRoleByKey(ctx, 'guide');
		await ctx.db.patch(args.clubMemberId, {
			roleId: guideRole._id
		});

		const club = await ctx.db.get(target.clubId);
		await ctx.runMutation(internal.notifications.createSystemNotification, {
			profileId: target.profileId,
			clubId: target.clubId,
			title: 'Promoted to Guide',
			message: `You have been promoted to Guide in ${club?.name ?? 'the club'}.`
		});

		return { success: true };
	}
});

export const demoteSelfToLearner = mutation({
	args: {
		clubId: v.id('clubs')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const membership = await getMembership(ctx, args.clubId, identity.subject);
		if (!membership) {
			throw new ConvexError('You are not an active member of this club');
		}

		const role = await ctx.db.get(membership.roleId);
		if (role?.key !== 'guide') {
			throw new ConvexError('Only Guides can demote themselves');
		}

		const guideRole = await getRoleByKey(ctx, 'guide');
		const guideCount = await countActiveGuides(ctx, args.clubId, guideRole._id);
		if (guideCount <= 1) {
			const activeMembers = await listActiveMembers(ctx, args.clubId);
			const hasLearners = activeMembers.some((member) => member.roleId !== guideRole._id);
			if (hasLearners) {
				throw new ConvexError('Promote a Learner to Guide first');
			}
			throw new ConvexError(
				'You are the last Guide with no other members. Use Leave club instead.'
			);
		}

		const learnerRole = await getRoleByKey(ctx, 'learner');
		await ctx.db.patch(membership._id, {
			roleId: learnerRole._id
		});

		return { success: true };
	}
});

const invalidateClubCodes = (ctx: MutationCtx, clubId: Id<'clubs'>) =>
	ctx.db.patch(clubId, {
		clubCode: undefined,
		guideInviteCode: undefined,
		discoverable: false,
		abandonedAt: Date.now(),
		updatedAt: Date.now()
	});

export const leaveClub = mutation({
	args: {
		clubId: v.id('clubs')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const membership = await getMembership(ctx, args.clubId, identity.subject);
		if (!membership) {
			throw new ConvexError('You are not an active member of this club');
		}

		const role = await ctx.db.get(membership.roleId);
		const guideRole = await getRoleByKey(ctx, 'guide');

		if (role?.key === 'guide') {
			const guideCount = await countActiveGuides(ctx, args.clubId, guideRole._id);
			if (guideCount <= 1) {
				const activeMembers = await listActiveMembers(ctx, args.clubId);
				const hasLearners = activeMembers.some((member) => member.roleId !== guideRole._id);
				if (hasLearners) {
					throw new ConvexError('Promote a Learner to Guide before leaving');
				}

				await ctx.db.patch(membership._id, { leftAt: Date.now() });
				await invalidateClubCodes(ctx, args.clubId);

				const profile = await ctx.db.get(membership.profileId);
				if (profile?.activeClubId === args.clubId) {
					await ctx.db.patch(profile._id, { activeClubId: undefined, updatedAt: Date.now() });
				}

				return { success: true, abandoned: true as const };
			}
		}

		await ctx.db.patch(membership._id, { leftAt: Date.now() });

		const profile = await ctx.db.get(membership.profileId);
		if (profile?.activeClubId === args.clubId) {
			await ctx.db.patch(profile._id, { activeClubId: undefined, updatedAt: Date.now() });
		}

		return { success: true, abandoned: false as const };
	}
});

// One-off backfill migration: pre-existing clubs predate the `discoverable` field.
// Run once via `npx convex run clubs:backfillDiscoverable` after deploying the schema change.
export const backfillDiscoverable = internalMutation({
	args: {},
	handler: async (ctx) => {
		const clubs = await ctx.db.query('clubs').collect();
		let updated = 0;
		for (const club of clubs) {
			if (club.discoverable !== undefined) continue;
			await ctx.db.patch(club._id, { discoverable: true });
			updated += 1;
		}
		return { updated, total: clubs.length };
	}
});

