import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { internalMutation } from './_generated/server';
import { getProfileAuthUserId, getRelatedProfile } from './permissions';

export const backfillProfileRelationships = internalMutation({
	args: {
		paginationOpts: paginationOptsValidator
	},
	returns: v.object({
		continueCursor: v.string(),
		isDone: v.boolean(),
		profilesMigrated: v.number()
	}),
	handler: async (ctx, args) => {
		const page = await ctx.db.query('profiles').paginate(args.paginationOpts);
		let profilesMigrated = 0;

		for (const profile of page.page) {
			const authUserId = getProfileAuthUserId(profile);
			if (!authUserId) continue;

			const [
				clubMemberships,
				projectMemberships,
				attendances,
				createdAttendances,
				participants,
				messages,
				notifications,
				preferences,
				applications,
				finalizedApplications,
				reviews,
				childConsents,
				parentConsents,
				clubs,
				sessions,
				bookletActivities,
				sessionActivities,
				projects,
				updates
			] = await Promise.all([
				ctx.db
					.query('clubMembers')
					.withIndex('by_user', (q) => q.eq('userId', authUserId))
					.collect(),
				ctx.db
					.query('projectMembers')
					.withIndex('by_user', (q) => q.eq('userId', authUserId))
					.collect(),
				ctx.db
					.query('attendances')
					.withIndex('by_user', (q) => q.eq('userId', authUserId))
					.collect(),
				ctx.db
					.query('attendances')
					.withIndex('by_created_by', (q) => q.eq('createdByUserId', authUserId))
					.collect(),
				ctx.db
					.query('participants')
					.withIndex('by_user', (q) => q.eq('userId', authUserId))
					.collect(),
				ctx.db
					.query('messages')
					.withIndex('by_user', (q) => q.eq('userId', authUserId))
					.collect(),
				ctx.db
					.query('notifications')
					.withIndex('by_user', (q) => q.eq('userId', authUserId))
					.collect(),
				ctx.db
					.query('userPreferences')
					.withIndex('by_user', (q) => q.eq('userId', authUserId))
					.collect(),
				ctx.db
					.query('clubApplications')
					.withIndex('by_applicant_user_id', (q) => q.eq('applicantUserId', authUserId))
					.collect(),
				ctx.db
					.query('clubApplications')
					.withIndex('by_finalized_by_user_id', (q) => q.eq('finalizedByUserId', authUserId))
					.collect(),
				ctx.db
					.query('applicationReviews')
					.withIndex('by_reviewer_user_id', (q) => q.eq('reviewerUserId', authUserId))
					.collect(),
				ctx.db
					.query('parentChildConsents')
					.withIndex('by_child_user_id', (q) => q.eq('childUserId', authUserId))
					.collect(),
				ctx.db
					.query('parentChildConsents')
					.withIndex('by_parent_user_id', (q) => q.eq('parentUserId', authUserId))
					.collect(),
				ctx.db
					.query('clubs')
					.withIndex('by_created_by', (q) => q.eq('createdByUserId', authUserId))
					.collect(),
				ctx.db
					.query('sessions')
					.withIndex('by_created_by', (q) => q.eq('createdByUserId', authUserId))
					.collect(),
				ctx.db
					.query('bookletActivities')
					.withIndex('by_created_by', (q) => q.eq('createdByUserId', authUserId))
					.collect(),
				ctx.db
					.query('sessionActivities')
					.withIndex('by_created_by', (q) => q.eq('createdByUserId', authUserId))
					.collect(),
				ctx.db
					.query('projects')
					.withIndex('by_created_by', (q) => q.eq('createdByUserId', authUserId))
					.collect(),
				ctx.db
					.query('updates')
					.withIndex('by_created_by', (q) => q.eq('createdByUserId', authUserId))
					.collect()
			]);

			for (const row of clubMemberships) {
				await ctx.db.patch(row._id, { profileId: profile._id, userId: undefined });
			}
			for (const row of projectMemberships) {
				await ctx.db.patch(row._id, { profileId: profile._id, userId: undefined });
			}
			for (const row of attendances) {
				await ctx.db.patch(row._id, { profileId: profile._id, userId: undefined });
			}
			for (const row of createdAttendances) {
				await ctx.db.patch(row._id, {
					createdByProfileId: profile._id,
					createdByUserId: undefined
				});
			}
			for (const row of participants) {
				await ctx.db.patch(row._id, { profileId: profile._id, userId: undefined });
			}
			for (const row of messages) {
				await ctx.db.patch(row._id, { profileId: profile._id, userId: undefined });
			}
			for (const row of notifications) {
				await ctx.db.patch(row._id, { profileId: profile._id, userId: undefined });
			}
			for (const row of preferences) {
				await ctx.db.patch(row._id, { profileId: profile._id, userId: undefined });
			}
			for (const row of applications) {
				await ctx.db.patch(row._id, {
					applicantProfileId: profile._id,
					applicantUserId: undefined
				});
			}
			for (const row of finalizedApplications) {
				await ctx.db.patch(row._id, {
					finalizedByProfileId: profile._id,
					finalizedByUserId: undefined
				});
			}
			for (const row of reviews) {
				await ctx.db.patch(row._id, {
					reviewerProfileId: profile._id,
					reviewerUserId: undefined
				});
			}
			for (const row of childConsents) {
				await ctx.db.patch(row._id, { childProfileId: profile._id, childUserId: undefined });
			}
			for (const row of parentConsents) {
				await ctx.db.patch(row._id, { parentProfileId: profile._id, parentUserId: undefined });
			}
			for (const row of clubs) {
				await ctx.db.patch(row._id, {
					createdByProfileId: profile._id,
					createdByUserId: undefined
				});
			}
			for (const row of sessions) {
				await ctx.db.patch(row._id, {
					createdByProfileId: profile._id,
					createdByUserId: undefined
				});
			}
			for (const row of bookletActivities) {
				await ctx.db.patch(row._id, {
					createdByProfileId: profile._id,
					createdByUserId: undefined
				});
			}
			for (const row of sessionActivities) {
				await ctx.db.patch(row._id, {
					createdByProfileId: profile._id,
					createdByUserId: undefined
				});
			}
			for (const row of projects) {
				await ctx.db.patch(row._id, {
					createdByProfileId: profile._id,
					createdByUserId: undefined
				});
			}
			for (const row of updates) {
				await ctx.db.patch(row._id, {
					createdByProfileId: profile._id,
					createdByUserId: undefined
				});
			}

			const roomIds = new Set<Id<'rooms'>>(participants.map((participant) => participant.roomId));
			for (const roomId of roomIds) {
				const room = await ctx.db.get(roomId);
				if (!room || room.isGroupChat || (room.directProfileAId && room.directProfileBId)) continue;
				const roomParticipants = await ctx.db
					.query('participants')
					.withIndex('by_room', (q) => q.eq('roomId', roomId))
					.collect();
				const roomProfiles = (
					await Promise.all(
						roomParticipants.map((participant) =>
							getRelatedProfile(ctx, participant.profileId, participant.userId)
						)
					)
				).filter((roomProfile): roomProfile is NonNullable<typeof roomProfile> =>
					Boolean(roomProfile)
				);
				if (roomProfiles.length !== 2) continue;
				const [directProfileAId, directProfileBId] = roomProfiles
					.map((roomProfile) => roomProfile._id)
					.sort();
				await ctx.db.patch(roomId, {
					directProfileAId,
					directProfileBId,
					directKey: undefined
				});
			}

			if (!profile.authUserId || profile.userId) {
				await ctx.db.patch(profile._id, { authUserId, userId: undefined });
			}
			profilesMigrated += 1;
		}

		return {
			continueCursor: page.continueCursor,
			isDone: page.isDone,
			profilesMigrated
		};
	}
});
