import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import {
	hasPermission,
	getMembership,
	requireIdentity,
	requirePermission,
	requireProfile,
	roleFromPermissions
} from './permissions';

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
		const existing = await ctx.db
			.query('clubCodes')
			.withIndex('by_code', (q) => q.eq('code', code))
			.first();
		if (!existing) {
			return code;
		}
	}
	throw new ConvexError('Failed to generate unique invite code');
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

const mapClubListItem = async (ctx: Ctx, club: Doc<'clubs'>, membership: Doc<'clubMembers'>) => {
	const role = await ctx.db.get(membership.roleId);
	const code = await ctx.db
		.query('clubCodes')
		.withIndex('by_club', (q) => q.eq('clubId', club._id))
		.first();

	return {
		clubId: club._id,
		clubCreatedAt: club.createdAt,
		clubName: club.name,
		clubDescription: club.description ?? null,
		clubLocation: club.location ?? null,
		clubTime: club.time ?? null,
		clubVideoUrl: club.videoUrl ?? null,
		clubMeetingDay: club.meetingDay ?? null,
		clubMeetingTime: club.meetingTime ?? null,
		clubCode: code?.code ?? null,
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

		const clubCode = await ctx.db
			.query('clubCodes')
			.withIndex('by_code', (q) => q.eq('code', normalizedCode))
			.first();
		if (!clubCode) {
			return null;
		}

		const club = await ctx.db.get(clubCode.clubId);
		if (!club) {
			return null;
		}

		const members = await ctx.db
			.query('clubMembers')
			.withIndex('by_club', (q) => q.eq('clubId', club._id))
			.collect();

		return {
			success: true,
			id: club._id,
			name: club.name,
			description: club.description ?? null,
			location: club.location ?? null,
			meetingDay: club.meetingDay ?? null,
			meetingTime: club.meetingTime ?? null,
			memberCount: members.filter((member) => !member.leftAt).length,
			createdAt: club.createdAt,
			code: clubCode.code
		};
	}
});

export const createClub = mutation({
	args: {
		name: v.string(),
		description: v.optional(v.string()),
		location: v.optional(v.string()),
		meetingDay: v.optional(v.string()),
		meetingTime: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const now = Date.now();

		const profile = await requireProfile(ctx, identity.subject);

		const clubId = await ctx.db.insert('clubs', {
			name: args.name,
			description: args.description,
			location: args.location,
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

		const inviteCode = await createInviteCode(ctx);
		await ctx.db.insert('clubCodes', {
			clubId,
			code: inviteCode,
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

		const clubCode = await ctx.db
			.query('clubCodes')
			.withIndex('by_code', (q) => q.eq('code', normalizedCode))
			.first();
		if (!clubCode) {
			throw new ConvexError('Invalid invite code');
		}

		const existingMembership = await getMembership(ctx, clubCode.clubId, identity.subject);
		if (existingMembership) {
			throw new ConvexError('You are already a member of this club');
		}

		const profile = await requireProfile(ctx, identity.subject);

		const learnerRole = await getRoleByName(ctx, 'Learner');
		await ctx.db.insert('clubMembers', {
			clubId: clubCode.clubId,
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
			activeClubId: clubCode.clubId,
			firstLoginCompleted: true,
			pendingClubCode: undefined,
			pendingRole: undefined,
			updatedAt: Date.now()
		});

		return {
			success: true,
			clubId: clubCode.clubId
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

		const profile = await requireProfile(ctx, identity.subject);
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
		const profile = await requireProfile(ctx, identity.subject);

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

		const code = await ctx.db
			.query('clubCodes')
			.withIndex('by_club', (q) => q.eq('clubId', args.clubId))
			.first();

		return {
			...club,
			clubCode: code?.code ?? null
		};
	}
});

export const updateClub = mutation({
	args: {
		clubId: v.id('clubs'),
		name: v.optional(v.string()),
		description: v.optional(v.string()),
		location: v.optional(v.string()),
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
