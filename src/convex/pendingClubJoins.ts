import { ConvexError } from 'convex/values';
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

		const existingMembership = await getMembershipByProfileId(ctx, club._id, profile._id);
		if (existingMembership) {
			await clearPendingClubJoinsForProfile(ctx, profile._id);
			return { ok: true as const, clubId: club._id };
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

		return { ok: true as const, clubId: club._id };
	}
});
