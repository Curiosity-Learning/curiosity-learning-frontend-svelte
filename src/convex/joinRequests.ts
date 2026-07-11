import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { ensureJoinRequestRoom } from './chatModel';
import { dispatchNotification, notifyGuidesOfNewMember } from './notificationsModel';
import {
	getClubRoleByKey,
	getMembershipByProfileId,
	hasPermissionForProfile,
	requireIdentity,
	requireProfile
} from './permissions';
import { setPendingClubJoin } from './pendingClubJoinsModel';

type Ctx = QueryCtx | MutationCtx;

const profileDisplayName = (profile: {
	firstName?: string;
	lastName?: string;
	username?: string;
}) => {
	const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
	return fullName || profile.username || 'Someone';
};

// A profile has completed onboarding gates when:
// - it is a child account (has a parentChildConsents row) and that consent is approved, or
// - it is an adult account (no consent row) and it has completed the pledge/profile flow
//   (firstLoginCompleted). See src/convex/childSignup.ts (approveConsent) and
//   src/routes/onboarding/post-signup/+page.svelte (completeOnboarding) for where each gate
//   is actually satisfied.
const isProfileGateComplete = async (ctx: Ctx, profile: Doc<'profiles'>) => {
	const consent = await ctx.db
		.query('parentChildConsents')
		.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', profile._id))
		.order('desc')
		.first();
	if (consent) {
		return consent.status === 'approved';
	}
	return profile.firstLoginCompleted;
};

const listActiveGuideMemberships = async (ctx: Ctx, clubId: Id<'clubs'>) => {
	const guideRole = await getClubRoleByKey(ctx, 'guide');
	if (!guideRole) return [];
	const members = await ctx.db
		.query('clubMembers')
		.withIndex('by_club', (q) => q.eq('clubId', clubId))
		.collect();
	return members.filter((member) => !member.leftAt && member.roleId === guideRole._id);
};

export const requestToJoin = mutation({
	args: {
		clubId: v.id('clubs')
	},
	returns: v.object({
		joinRequestId: v.id('joinRequests'),
		roomId: v.id('rooms')
	}),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const club = await ctx.db.get(args.clubId);
		if (!club || !club.discoverable || club.abandonedAt) {
			throw new ConvexError('This club is not open for join requests');
		}

		const existingMembership = await getMembershipByProfileId(ctx, args.clubId, profile._id);
		if (existingMembership) {
			throw new ConvexError('You are already a member of this club');
		}

		const existingRequests = await ctx.db
			.query('joinRequests')
			.withIndex('by_club_and_requester', (q) =>
				q.eq('clubId', args.clubId).eq('requesterProfileId', profile._id)
			)
			.collect();
		if (existingRequests.some((request) => request.status === 'pending')) {
			throw new ConvexError('You already have a pending request to join this club');
		}

		const now = Date.now();
		const joinRequestId = await ctx.db.insert('joinRequests', {
			clubId: args.clubId,
			requesterProfileId: profile._id,
			status: 'pending',
			createdAt: now
		});
		const roomId = await ensureJoinRequestRoom(ctx, joinRequestId);

		const requesterName = profileDisplayName(profile);
		const guideMemberships = await listActiveGuideMemberships(ctx, args.clubId);
		for (const guideMembership of guideMemberships) {
			await dispatchNotification(ctx, {
				recipientProfileId: guideMembership.profileId,
				kind: 'join_request_received',
				clubId: args.clubId,
				title: 'New join request',
				message: `New join request from ${requesterName}`
			});
		}

		return { joinRequestId, roomId };
	}
});

export const getJoinRequestForRoom = query({
	args: {
		roomId: v.id('rooms')
	},
	returns: v.union(
		v.null(),
		v.object({
			joinRequestId: v.id('joinRequests'),
			clubId: v.id('clubs'),
			status: v.union(
				v.literal('pending'),
				v.literal('accepted'),
				v.literal('declined'),
				v.literal('cancelled')
			),
			requesterProfileId: v.id('profiles'),
			requesterName: v.string(),
			isRequester: v.boolean(),
			canDecide: v.boolean()
		})
	),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const room = await ctx.db.get(args.roomId);
		if (!room || room.contextType !== 'joinRequest') {
			return null;
		}
		const joinRequest = await ctx.db.get(room.joinRequestId);
		if (!joinRequest) {
			return null;
		}
		const isRequester = joinRequest.requesterProfileId === profile._id;
		const canDecide = await hasPermissionForProfile(
			ctx,
			joinRequest.clubId,
			profile._id,
			'club_join_request:decide'
		);
		if (!isRequester && !canDecide) {
			throw new ConvexError('You cannot access this chat');
		}

		const requesterProfile = await ctx.db.get(joinRequest.requesterProfileId);

		return {
			joinRequestId: joinRequest._id,
			clubId: joinRequest.clubId,
			status: joinRequest.status,
			requesterProfileId: joinRequest.requesterProfileId,
			requesterName: requesterProfile ? profileDisplayName(requesterProfile) : 'Someone',
			isRequester,
			canDecide
		};
	}
});

export const getMyJoinRequestForClub = query({
	args: {
		clubId: v.id('clubs')
	},
	returns: v.union(v.null(), v.any()),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const requests = await ctx.db
			.query('joinRequests')
			.withIndex('by_club_and_requester', (q) =>
				q.eq('clubId', args.clubId).eq('requesterProfileId', profile._id)
			)
			.order('desc')
			.collect();
		return requests[0] ?? null;
	}
});

export const cancelJoinRequest = mutation({
	args: {
		joinRequestId: v.id('joinRequests')
	},
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const joinRequest = await ctx.db.get(args.joinRequestId);
		if (!joinRequest) {
			throw new ConvexError('Join request not found');
		}
		if (joinRequest.requesterProfileId !== profile._id) {
			throw new ConvexError('You can only cancel your own join request');
		}
		if (joinRequest.status !== 'pending') {
			throw new ConvexError('This join request is no longer pending');
		}

		await ctx.db.patch(args.joinRequestId, {
			status: 'cancelled',
			cancelledAt: Date.now()
		});

		return { success: true };
	}
});

export const acceptJoinRequest = mutation({
	args: {
		joinRequestId: v.id('joinRequests')
	},
	returns: v.object({ success: v.boolean(), membershipCreated: v.boolean() }),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const deciderProfile = await requireProfile(ctx, identity.subject);
		const joinRequest = await ctx.db.get(args.joinRequestId);
		if (!joinRequest) {
			throw new ConvexError('Join request not found');
		}
		if (joinRequest.status !== 'pending') {
			throw new ConvexError('This join request has already been decided');
		}

		const allowed = await hasPermissionForProfile(
			ctx,
			joinRequest.clubId,
			deciderProfile._id,
			'club_join_request:decide'
		);
		if (!allowed) {
			throw new ConvexError('Permission denied');
		}

		const requesterProfile = await ctx.db.get(joinRequest.requesterProfileId);
		if (!requesterProfile) {
			throw new ConvexError('Requester profile not found');
		}

		const club = await ctx.db.get(joinRequest.clubId);
		if (!club) {
			throw new ConvexError('Club not found');
		}

		const now = Date.now();
		let membershipCreated = false;

		const existingMembership = await getMembershipByProfileId(
			ctx,
			joinRequest.clubId,
			requesterProfile._id
		);
		const gatesComplete = await isProfileGateComplete(ctx, requesterProfile);

		if (!existingMembership && gatesComplete) {
			const learnerRole = await getClubRoleByKey(ctx, 'learner');
			if (!learnerRole) {
				throw new ConvexError('Default role Learner is not configured');
			}
			await ctx.db.insert('clubMembers', {
				clubId: joinRequest.clubId,
				profileId: requesterProfile._id,
				roleId: learnerRole._id,
				firstName: requesterProfile.firstName,
				lastName: requesterProfile.lastName,
				username: requesterProfile.username,
				coverPhotoUrl: requesterProfile.coverPhotoUrl,
				createdAt: now
			});
			await ctx.db.patch(requesterProfile._id, {
				activeClubId: joinRequest.clubId,
				updatedAt: now
			});
			membershipCreated = true;
			await notifyGuidesOfNewMember(ctx, joinRequest.clubId, requesterProfile);
		} else if (!existingMembership && !gatesComplete) {
			// Gates aren't complete yet (pledge not agreed, or under-16 consent still pending).
			// Records a deferred join intent (PRD 5.6, pendingClubJoins table) with source
			// 'map_request': it's consumed at the two points where gates actually clear (adult:
			// pendingClubJoins.consumeMine via completeOnboarding in post-signup/+page.svelte;
			// child: childSignup.approveConsent reads the same table directly), so the requester
			// lands in the club automatically once they finish onboarding.
			await setPendingClubJoin(ctx, requesterProfile._id, joinRequest.clubId, 'map_request');
		}

		await ctx.db.patch(args.joinRequestId, {
			status: 'accepted',
			decidedAt: now,
			decidedByProfileId: deciderProfile._id
		});

		await dispatchNotification(ctx, {
			recipientProfileId: requesterProfile._id,
			kind: 'join_request_decision',
			clubId: joinRequest.clubId,
			title: 'Join request accepted',
			message: membershipCreated
				? `Your request to join ${club.name} was accepted. Welcome!`
				: `Your request to join ${club.name} was accepted. Finish setting up your account to join.`
		});

		return { success: true, membershipCreated };
	}
});

export const declineJoinRequest = mutation({
	args: {
		joinRequestId: v.id('joinRequests')
	},
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const deciderProfile = await requireProfile(ctx, identity.subject);
		const joinRequest = await ctx.db.get(args.joinRequestId);
		if (!joinRequest) {
			throw new ConvexError('Join request not found');
		}
		if (joinRequest.status !== 'pending') {
			throw new ConvexError('This join request has already been decided');
		}

		const allowed = await hasPermissionForProfile(
			ctx,
			joinRequest.clubId,
			deciderProfile._id,
			'club_join_request:decide'
		);
		if (!allowed) {
			throw new ConvexError('Permission denied');
		}

		const club = await ctx.db.get(joinRequest.clubId);
		const now = Date.now();
		await ctx.db.patch(args.joinRequestId, {
			status: 'declined',
			decidedAt: now,
			decidedByProfileId: deciderProfile._id
		});

		await dispatchNotification(ctx, {
			recipientProfileId: joinRequest.requesterProfileId,
			kind: 'join_request_decision',
			clubId: joinRequest.clubId,
			title: 'Join request declined',
			message: `Your request to join ${club?.name ?? 'the club'} was declined.`
		});

		return { success: true };
	}
});
