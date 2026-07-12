import { ConvexError } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { ensureClubRoom } from './chatModel';
import { notifyGuidesOfNewMember } from './notificationsModel';
import {
	getClubRoleByKey,
	getMembershipByProfileId,
	getProfileByAuthUserId,
	requireIdentity,
	requireProfile
} from './permissions';
import { clearPendingClubJoinsForProfile, getLatestPendingClubJoin } from './pendingClubJoinsModel';

// CL-711 CEO review round 3: when the deferred join came from an accepted map join-request
// (source 'map_request' — see acceptJoinRequest), the requester already has a chat thread with the
// Guide from before they signed up. Once consumeMine finishes the join, the client should land
// them directly back in that thread instead of the generic club overview — so look up its room
// here rather than making the client re-derive it.
const findJoinRequestRoomId = async (
	ctx: MutationCtx,
	clubId: Id<'clubs'>,
	requesterProfileId: Id<'profiles'>
): Promise<Id<'rooms'> | null> => {
	const requests = await ctx.db
		.query('joinRequests')
		.withIndex('by_club_and_requester', (q) =>
			q.eq('clubId', clubId).eq('requesterProfileId', requesterProfileId)
		)
		.collect();
	const accepted = requests
		.filter((request) => request.status === 'accepted')
		.sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt))[0];
	if (!accepted) {
		return null;
	}

	const room = await ctx.db
		.query('rooms')
		.withIndex('by_join_request_id', (q) => q.eq('joinRequestId', accepted._id))
		.first();
	return room?._id ?? null;
};

// Surfaces the current profile's deferred club-join intent (PRD 5.6), if any, so onboarding-
// completion flows (post-signup) know whether to auto-join a club once gates clear. Returns null
// if there is no pending intent, or if the target club has since become unavailable (abandoned) —
// callers should treat that the same as "no pending intent".
export const getMine = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await getProfileByAuthUserId(ctx, identity.subject);
		if (!profile) {
			return null;
		}

		const pending = await getLatestPendingClubJoin(ctx, profile._id);
		if (!pending) {
			return null;
		}

		const club = await ctx.db.get(pending.clubId);
		if (!club || club.abandonedAt) {
			return null;
		}

		return { clubId: pending.clubId, source: pending.source };
	}
});

// Consumes the current profile's pending club-join intent: joins them into the target club as a
// Learner (if not already a member) and clears every pending row for the profile regardless of
// outcome. Used once an onboarding gate clears for an adult account (post-signup
// completeOnboarding). The child-account equivalent (childSignup.approveConsent) calls the model
// helpers in pendingClubJoinsModel.ts directly instead, since it already runs inside its own
// mutation and joins a different profile (the child's, not the caller's).
export const consumeMine = mutation({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const pending = await getLatestPendingClubJoin(ctx, profile._id);
		if (!pending) {
			return { ok: false as const, error: 'no_pending' as const };
		}

		const club = await ctx.db.get(pending.clubId);
		if (!club || club.abandonedAt) {
			await clearPendingClubJoinsForProfile(ctx, profile._id);
			return { ok: false as const, error: 'club_unavailable' as const };
		}

		// CL-711 CEO review round 3: only a 'map_request' deferral has a join-request chat to return
		// to — a 'code' deferral (join-club/[code] link) never went through a join request.
		const roomId =
			pending.source === 'map_request'
				? await findJoinRequestRoomId(ctx, club._id, profile._id)
				: null;

		const existingMembership = await getMembershipByProfileId(ctx, club._id, profile._id);
		if (existingMembership) {
			await clearPendingClubJoinsForProfile(ctx, profile._id);
			return { ok: true as const, clubId: club._id, roomId };
		}

		const learnerRole = await getClubRoleByKey(ctx, 'learner');
		if (!learnerRole) {
			throw new ConvexError('Default role Learner is not configured');
		}

		await ensureClubRoom(ctx, club._id);
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
			updatedAt: Date.now()
		});
		await notifyGuidesOfNewMember(ctx, club._id, profile);
		await clearPendingClubJoinsForProfile(ctx, profile._id);

		return { ok: true as const, clubId: club._id, roomId };
	}
});
