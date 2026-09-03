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

type CreateJoinRequestResult =
	| { ok: true; joinRequestId: Id<'joinRequests'>; roomId: Id<'rooms'> }
	| { ok: false; reason: 'club_unavailable' | 'already_member' | 'already_pending' };

// Core "create a join request" logic, shared by the interactive `requestToJoin` mutation below
// and `autoCreateJoinRequestFromNextPath` (CL-711 CEO feedback item 6): a logged-out visitor who
// taps "Request to Join" is redirected to sign-up before any request can be created; once their
// account exists, the request they intended to send should be created automatically instead of
// requiring a second tap. Both call sites need identical eligibility checks, so this is factored
// out rather than duplicated.
const createJoinRequestForProfile = async (
	ctx: MutationCtx,
	clubId: Id<'clubs'>,
	profileId: Id<'profiles'>
): Promise<CreateJoinRequestResult> => {
	const club = await ctx.db.get(clubId);
	if (!club || !club.discoverable || club.abandonedAt) {
		return { ok: false, reason: 'club_unavailable' };
	}

	const existingMembership = await getMembershipByProfileId(ctx, clubId, profileId);
	if (existingMembership) {
		return { ok: false, reason: 'already_member' };
	}

	const existingRequests = await ctx.db
		.query('joinRequests')
		.withIndex('by_club_and_requester', (q) =>
			q.eq('clubId', clubId).eq('requesterProfileId', profileId)
		)
		.collect();
	if (existingRequests.some((request) => request.status === 'pending')) {
		return { ok: false, reason: 'already_pending' };
	}

	const now = Date.now();
	const joinRequestId = await ctx.db.insert('joinRequests', {
		clubId,
		requesterProfileId: profileId,
		status: 'pending',
		createdAt: now
	});
	const roomId = await ensureJoinRequestRoom(ctx, joinRequestId);

	const profile = await ctx.db.get(profileId);
	if (profile) {
		const requesterName = profileDisplayName(profile);
		const guideMemberships = await listActiveGuideMemberships(ctx, clubId);
		for (const guideMembership of guideMemberships) {
			await dispatchNotification(ctx, {
				recipientProfileId: guideMembership.profileId,
				kind: 'join_request_received',
				clubId,
				title: 'New join request',
				message: `New join request from ${requesterName}`
			});
		}
	}

	return { ok: true, joinRequestId, roomId };
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

		const result = await createJoinRequestForProfile(ctx, args.clubId, profile._id);
		if (!result.ok) {
			if (result.reason === 'already_member') {
				throw new ConvexError('You are already a member of this club');
			}
			if (result.reason === 'already_pending') {
				throw new ConvexError('You already have a pending request to join this club');
			}
			throw new ConvexError('This club is not open for join requests');
		}

		return { joinRequestId: result.joinRequestId, roomId: result.roomId };
	}
});

// Parses a `/clubs/{clubId}` next-path (the public club preview / request-to-join surface) into
// the raw clubId segment, or undefined if the path doesn't match. Mirrors auth.ts's
// extractPendingJoinCode / childSignup.ts's getPendingJoinCode for the code-join flow, but for the
// discoverable-club "Request to Join" flow.
export const extractPendingRequestJoinClubId = (nextPath?: string | null): string | undefined => {
	if (!nextPath) {
		return undefined;
	}

	const prefix = '/clubs/';
	if (!nextPath.startsWith(prefix)) {
		return undefined;
	}

	const rawClubId = nextPath.slice(prefix.length).split(/[/?#]/)[0] ?? '';
	return rawClubId.length > 0 ? rawClubId : undefined;
};

// Best-effort, non-throwing counterpart to `requestToJoin` for automatic completion once an
// account exists post-signup (CL-711 CEO feedback item 6). Called from auth.ts's
// completeSignupProfile (adults — profile exists as soon as signup completes) and
// childSignup.ts's approveConsent (minors — only once parental consent clears, per PRD 6.1.4).
// Silently no-ops for any condition that would make `requestToJoin` throw (invalid/
// non-discoverable/abandoned club, already a member, already has a pending request): this runs
// unattended, so there's nowhere to surface an error, and the club preview page's own
// viewerIsMember/viewerPendingJoinRequestId already reflect the true state either way.
export const autoCreateJoinRequestFromNextPath = async (
	ctx: MutationCtx,
	nextPath: string | null | undefined,
	profileId: Id<'profiles'>
): Promise<void> => {
	const rawClubId = extractPendingRequestJoinClubId(nextPath);
	if (!rawClubId) {
		return;
	}

	const clubId = ctx.db.normalizeId('clubs', rawClubId);
	if (!clubId) {
		return;
	}

	await createJoinRequestForProfile(ctx, clubId, profileId);
};

export const getJoinRequestForRoom = query({
	args: {
		roomId: v.id('rooms')
	},
	returns: v.union(
		v.null(),
		v.object({
			// CEO review (CL-695 round 3, item 2): echoed back so the client can detect stale
			// keepPreviousData results left over from a just-abandoned room (see the flicker fix in
			// chat/+page.svelte, and the matching comment on chat.listMessages).
			roomId: v.id('rooms'),
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
			canDecide: v.boolean(),
			// Chat context banner: whether the club's public preview page (/clubs/{id}) resolves —
			// clubs.getClubPreviewById only serves discoverable, non-abandoned clubs, so a pending
			// requester of a code-only club gets no link rather than a "not found".
			clubDiscoverable: v.boolean()
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
		const club = await ctx.db.get(joinRequest.clubId);

		return {
			roomId: args.roomId,
			joinRequestId: joinRequest._id,
			clubId: joinRequest.clubId,
			status: joinRequest.status,
			requesterProfileId: joinRequest.requesterProfileId,
			requesterName: requesterProfile ? profileDisplayName(requesterProfile) : 'Someone',
			isRequester,
			canDecide,
			clubDiscoverable: Boolean(club && club.discoverable && !club.abandonedAt)
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

// CL-690 CEO review item F: the no-club "Applications" area must list requests to JOIN a club
// alongside applications to START one, each linking to its chat room. Mirrors
// clubApplications.listMyApplications's shape (roomId alongside the record) so the frontend can
// combine both lists into one view.
export const listMyJoinRequests = query({
	args: {},
	returns: v.array(
		v.object({
			joinRequestId: v.id('joinRequests'),
			roomId: v.union(v.id('rooms'), v.null()),
			clubId: v.id('clubs'),
			clubName: v.string(),
			status: v.union(
				v.literal('pending'),
				v.literal('accepted'),
				v.literal('declined'),
				v.literal('cancelled')
			),
			createdAt: v.number()
		})
	),
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const requests = await ctx.db
			.query('joinRequests')
			.withIndex('by_requester_profile_id', (q) => q.eq('requesterProfileId', profile._id))
			.order('desc')
			.collect();

		const result = [];
		for (const request of requests) {
			const club = await ctx.db.get(request.clubId);
			const room = await ctx.db
				.query('rooms')
				.withIndex('by_join_request_id', (q) => q.eq('joinRequestId', request._id))
				.first();
			result.push({
				joinRequestId: request._id,
				roomId: room?._id ?? null,
				clubId: request.clubId,
				clubName: club?.name ?? 'Club',
				status: request.status,
				createdAt: request.createdAt
			});
		}
		return result;
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
