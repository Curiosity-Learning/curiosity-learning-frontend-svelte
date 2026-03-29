import { ConvexError, v } from 'convex/values';
import type { GenericCtx } from '@convex-dev/better-auth';
import type { GenericDataModel } from 'convex/server';
import { mutation, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import {
	hasPermission,
	getMembership,
	requireIdentity,
	requirePermission,
	roleFromPermissions
} from './permissions';
import { authComponent } from './auth';

const INVITE_CODE_PATTERN = /^[A-Z0-9]{6}$/;
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
type Ctx = QueryCtx | MutationCtx;
type ActiveClubContext = {
	activeClubId: Id<'clubs'> | null;
	role: 'Guide' | 'Learner' | null;
	permissions: string[];
};

const normalizeInviteCode = (code: string) => code.trim().toUpperCase();

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
		const existingInClubs = await ctx.db
			.query('clubs')
			.withIndex('by_club_code', (q) => q.eq('clubCode', code))
			.first();
		if (!existingInClubs) {
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
	if (!club) {
		return null;
	}

	return {
		club,
		code: normalizedCode
	};
};

const getRoleByName = async (ctx: Ctx, name: 'Guide' | 'Learner') => {
	const role = await ctx.db
		.query('clubRoles')
		.withIndex('by_name', (q) => q.eq('name', name))
		.first();
	if (!role) {
		throw new ConvexError(`Default role ${name} is not configured`);
	}
	return role;
};

const resolveClubVideoUrl = async (ctx: Ctx, club: Doc<'clubs'>) => {
	if (!club.videoStorageId) {
		return null;
	}

	try {
		return await ctx.storage.getUrl(club.videoStorageId);
	} catch {
		return null;
	}
};

const mapClubListItem = async (ctx: Ctx, club: Doc<'clubs'>, membership: Doc<'clubMembers'>) => {
	const role = await ctx.db.get(membership.roleId);
	const clubVideoUrl = await resolveClubVideoUrl(ctx, club);

	return {
		clubId: club._id,
		clubCreatedAt: club.createdAt,
		clubName: club.name,
		clubDescription: club.description ?? null,
		clubLocation: club.location ?? null,
		clubTime: club.time ?? null,
		clubVideoUrl,
		clubMeetingDay: club.meetingDay ?? null,
		clubMeetingTime: club.meetingTime ?? null,
		clubCode: club.clubCode ?? null,
		memberId: membership._id,
		memberProfileId: membership.userId,
		memberLeftAt: membership.leftAt ?? null,
		roleId: role?._id ?? null,
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
	if (!firstMatch || firstMatch.userId === userId) {
		return preferred;
	}

	for (let suffix = 2; suffix <= 99; suffix += 1) {
		const candidate = `${preferred}${suffix}`;
		const match = await ctx.db
			.query('profiles')
			.withIndex('by_username', (q) => q.eq('username', candidate))
			.first();
		if (!match || match.userId === userId) {
			return candidate;
		}
	}

	return undefined;
};

const getOrCreateProfile = async (ctx: MutationCtx, userId: string) => {
	const existing = await ctx.db
		.query('profiles')
		.withIndex('by_user_id', (q) => q.eq('userId', userId))
		.first();
	if (existing) {
		return existing;
	}

	const authUser = await authComponent.getAuthUser(
		ctx as unknown as GenericCtx<GenericDataModel>
	);
	const now = Date.now();
	const username = await resolveUniqueUsername(ctx, authUser._id, authUser.email);
	const { firstName, lastName } = splitNameParts(authUser.name);

	const profileId = await ctx.db.insert('profiles', {
		userId: authUser._id,
		email: authUser.email,
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
		const memberships = await ctx.db
			.query('clubMembers')
			.withIndex('by_user', (q) => q.eq('userId', identity.subject))
			.collect();

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

		const resolved = await resolveClubByCode(ctx, normalizedCode);
		if (!resolved) {
			return null;
		}
		const { club, code } = resolved;

		const members = await ctx.db
			.query('clubMembers')
			.withIndex('by_club', (q) => q.eq('clubId', club._id))
			.collect();

		return {
			success: true,
			id: club._id,
			name: club.name,
			description: club.description ?? null,
			videoUrl: await resolveClubVideoUrl(ctx, club),
			location: club.location ?? null,
			locationLatitude: club.locationLatitude ?? null,
			locationLongitude: club.locationLongitude ?? null,
			meetingDay: club.meetingDay ?? null,
			meetingTime: club.meetingTime ?? null,
			memberCount: members.filter((member) => !member.leftAt).length,
			createdAt: club.createdAt,
			code
		};
	}
});

export const listPublicClubs = query({
	args: {},
	handler: async (ctx) => {
		const clubs = await ctx.db.query('clubs').collect();
		const publicClubs = clubs.filter((club) => Boolean(club.clubCode));

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
					meetingDay: club.meetingDay ?? null,
					meetingTime: club.meetingTime ?? null,
					memberCount: members.filter((member) => !member.leftAt).length,
					videoUrl: await resolveClubVideoUrl(ctx, club),
					createdAt: club.createdAt
				};
			})
		);
	}
});

export const createClub = mutation({
	args: {
		name: v.string(),
		description: v.optional(v.string()),
		location: v.optional(v.string()),
		locationLatitude: v.optional(v.number()),
		locationLongitude: v.optional(v.number()),
		meetingDay: v.optional(v.string()),
		meetingTime: v.optional(v.string()),
		videoStorageId: v.optional(v.id('_storage'))
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const now = Date.now();

		const profile = await getOrCreateProfile(ctx, identity.subject);
		const inviteCode = await createInviteCode(ctx);

		const clubId = await ctx.db.insert('clubs', {
			name: args.name,
			clubCode: inviteCode,
			description: args.description,
			location: args.location,
			locationLatitude: args.locationLatitude,
			locationLongitude: args.locationLongitude,
			videoStorageId: args.videoStorageId,
			meetingDay: args.meetingDay,
			meetingTime: args.meetingTime,
			createdByUserId: identity.subject,
			createdAt: now,
			updatedAt: now
		});

		const guideRole = await getRoleByName(ctx, 'Guide');
		await ctx.db.insert('clubMembers', {
			clubId,
			userId: identity.subject,
			roleId: guideRole._id,
			firstName: profile.firstName,
			lastName: profile.lastName,
			username: profile.username,
			email: profile.email,
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
		if (!INVITE_CODE_PATTERN.test(normalizedCode)) {
			throw new ConvexError('Invalid invite code');
		}

		const resolved = await resolveClubByCode(ctx, normalizedCode);
		if (!resolved) {
			throw new ConvexError('Invalid invite code');
		}
		const { club } = resolved;

		const existingMembership = await getMembership(ctx, club._id, identity.subject);
		if (existingMembership) {
			throw new ConvexError('You are already a member of this club');
		}

		const profile = await getOrCreateProfile(ctx, identity.subject);

		const learnerRole = await getRoleByName(ctx, 'Learner');
		await ctx.db.insert('clubMembers', {
			clubId: club._id,
			userId: identity.subject,
			roleId: learnerRole._id,
			firstName: profile.firstName,
			lastName: profile.lastName,
			username: profile.username,
			email: profile.email,
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
			success: true,
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
		const profile = await ctx.db
			.query('profiles')
			.withIndex('by_user_id', (q) => q.eq('userId', identity.subject))
			.first();
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
			clubCode: club.clubCode ?? null
		};
	}
});

export const updateClub = mutation({
	args: {
		clubId: v.id('clubs'),
		name: v.optional(v.string()),
		description: v.optional(v.string()),
		location: v.optional(v.string()),
		locationLatitude: v.optional(v.number()),
		locationLongitude: v.optional(v.number()),
		videoStorageId: v.optional(v.id('_storage')),
		meetingDay: v.optional(v.string()),
		meetingTime: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requirePermission(ctx, args.clubId, identity.subject, 'club:edit');

		const club = await ctx.db.get(args.clubId);
		if (!club) {
			throw new ConvexError('Club not found');
		}

		await ctx.db.patch(args.clubId, {
			name: args.name ?? club.name,
			description: args.description ?? club.description,
			location: args.location ?? club.location,
			locationLatitude: args.locationLatitude ?? club.locationLatitude,
			locationLongitude: args.locationLongitude ?? club.locationLongitude,
			videoStorageId: args.videoStorageId ?? club.videoStorageId,
			meetingDay: args.meetingDay ?? club.meetingDay,
			meetingTime: args.meetingTime ?? club.meetingTime,
			updatedAt: Date.now()
		});

		return await ctx.db.get(args.clubId);
	}
});

export const getMembers = query({
	args: {
		clubId: v.id('clubs'),
		roleName: v.optional(v.union(v.literal('Guide'), v.literal('Learner')))
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
			userId: string;
			roleId: Id<'clubRoles'>;
			roleName: string | null;
			rolePermissions: string[];
			firstName: string | null;
			lastName: string | null;
			username: string | null;
			email: string | null;
			coverPhotoUrl: string | null;
		}> = [];

		for (const member of activeMembers) {
			const role = await ctx.db.get(member.roleId);
			if (args.roleName && role?.name !== args.roleName) {
				continue;
			}

			// Fall back to the profiles table when denormalized fields are missing
			let { firstName, lastName, username, email, coverPhotoUrl } = member;
			if (!firstName && !lastName && !email) {
				const profile = await ctx.db
					.query('profiles')
					.withIndex('by_user_id', (q) => q.eq('userId', member.userId))
					.first();
				if (profile) {
					firstName = firstName ?? profile.firstName;
					lastName = lastName ?? profile.lastName;
					username = username ?? profile.username;
					email = email ?? profile.email;
					coverPhotoUrl = coverPhotoUrl ?? profile.coverPhotoUrl;
				}
			}

			output.push({
				clubMemberId: member._id,
				userId: member.userId,
				roleId: member.roleId,
				roleName: role?.name ?? null,
				rolePermissions: role?.permissions ?? [],
				firstName: firstName ?? null,
				lastName: lastName ?? null,
				username: username ?? null,
				email: email ?? null,
				coverPhotoUrl: coverPhotoUrl ?? null
			});
		}

		return output;
	}
});

export const kickMember = mutation({
	args: {
		clubMemberId: v.id('clubMembers')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
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
			leftAt: Date.now()
		});

		return { success: true };
	}
});
