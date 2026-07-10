import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, mutation, query } from './_generated/server';
import {
	getClubRoleByKey,
	getMembershipByProfileId,
	getProfileByAuthUserId,
	listMembershipsForProfile,
	requireIdentity,
	requireProfile
} from './permissions';
import { ensureClubApplicationRoom, ensureClubRoom } from './chatModel';
import { dispatchNotification } from './notificationsModel';

type Ctx = QueryCtx | MutationCtx;

const applicationDraftValidator = v.object({
	description: v.optional(v.string()),
	location: v.optional(v.string()),
	locationLatitude: v.optional(v.number()),
	locationLongitude: v.optional(v.number()),
	applicantRole: v.optional(v.string()),
	referralSource: v.optional(v.string()),
	referralOther: v.optional(v.string())
});

type ApplicationDraft = {
	description?: string;
	location?: string;
	locationLatitude?: number;
	locationLongitude?: number;
	applicantRole?: string;
	referralSource?: string;
	referralOther?: string;
};

const getRoleByKey = async (ctx: Ctx, key: 'guide' | 'learner') => {
	const role = await getClubRoleByKey(ctx, key);
	if (!role) {
		throw new ConvexError(`Default role ${key} is not configured`);
	}
	return role;
};

const isGuideSomewhere = async (ctx: Ctx, userId: string) => {
	const profile = await requireProfile(ctx, userId);
	const memberships = await listMembershipsForProfile(ctx, profile);

	for (const membership of memberships) {
		if (membership.leftAt) continue;
		const role = await ctx.db.get(membership.roleId);
		if (role?.key === 'guide') {
			return true;
		}
	}

	return false;
};

const requireGuideSomewhere = async (ctx: Ctx, userId: string) => {
	if (!(await isGuideSomewhere(ctx, userId))) {
		throw new ConvexError('Only Guides can review applications');
	}
};

// A "deciding Guide" for an application is any Guide who has reviewed it (has an
// applicationReviews row). This mirrors the chat access rule in chat.ts's
// getClubApplicationAccess, so the same Guides who can read/send in the application chat are the
// ones who can move it to interview, accept/reject, confirm the onboarding call, or flag it for
// follow-up.
const getApplicationReview = async (
	ctx: Ctx,
	applicationId: Id<'clubApplications'>,
	reviewerProfileId: Id<'profiles'>
) => {
	return await ctx.db
		.query('applicationReviews')
		.withIndex('by_application_id_and_reviewer_profile_id', (q) =>
			q.eq('applicationId', applicationId).eq('reviewerProfileId', reviewerProfileId)
		)
		.first();
};

const requireDecidingReviewer = async (
	ctx: Ctx,
	applicationId: Id<'clubApplications'>,
	profileId: Id<'profiles'>
) => {
	const review = await getApplicationReview(ctx, applicationId, profileId);
	if (!review) {
		throw new ConvexError('Only a Guide who reviewed this application can do this');
	}
	return review;
};

const assertReadyClubVideo = async (
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
};

const createInviteCodeCandidate = () => {
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let code = '';
	for (let index = 0; index < 6; index += 1) {
		code += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return code;
};

const createInviteCode = async (ctx: Ctx) => {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const code = createInviteCodeCandidate();
		const existing = await ctx.db
			.query('clubs')
			.withIndex('by_club_code', (q) => q.eq('clubCode', code))
			.first();
		if (!existing) return code;
	}
	throw new ConvexError('Failed to generate unique invite code');
};

const trimOptional = (value?: string) => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
};

const nameFromDraft = (draft: ApplicationDraft) => {
	const location = trimOptional(draft.location);
	return location ? `${location} Curiosity Club`.slice(0, 100) : 'Curiosity Club';
};

const normalizeDraft = (draft: ApplicationDraft) => ({
	name: nameFromDraft(draft),
	description: trimOptional(draft.description),
	location: trimOptional(draft.location),
	locationLatitude: draft.locationLatitude,
	locationLongitude: draft.locationLongitude,
	applicantRole: trimOptional(draft.applicantRole),
	referralSource: trimOptional(draft.referralSource),
	referralOther: trimOptional(draft.referralOther)
});

const profileDisplayName = (profile: {
	firstName?: string;
	lastName?: string;
	username?: string;
}) => {
	const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
	return fullName || profile.username || undefined;
};

const getLatestIncompleteApplication = async (ctx: Ctx, profileId: Id<'profiles'>) => {
	const applications = await ctx.db
		.query('clubApplications')
		.withIndex('by_applicant_profile_id', (q) => q.eq('applicantProfileId', profileId))
		.order('desc')
		.collect();
	return applications.find((application) => application.status === 'incomplete') ?? null;
};

const upsertIncompleteApplication = async (
	ctx: MutationCtx,
	args: {
		profileId: Id<'profiles'>;
		draft: ApplicationDraft;
	}
) => {
	const now = Date.now();
	const normalized = normalizeDraft(args.draft);
	const existing = await getLatestIncompleteApplication(ctx, args.profileId);
	if (existing) {
		await ctx.db.patch(existing._id, {
			...normalized,
			applicantProfileId: args.profileId,
			updatedAt: now
		});
		return { applicationId: existing._id };
	}

	const applicationId = await ctx.db.insert('clubApplications', {
		applicantProfileId: args.profileId,
		status: 'incomplete',
		...normalized,
		createdAt: now,
		updatedAt: now
	});
	return { applicationId };
};

export const saveIncompleteApplicationForUser = internalMutation({
	args: {
		profileId: v.id('profiles'),
		draft: applicationDraftValidator
	},
	returns: v.object({
		applicationId: v.id('clubApplications')
	}),
	handler: async (ctx, args) => {
		return await upsertIncompleteApplication(ctx, args);
	}
});

export const saveIncompleteApplication = mutation({
	args: applicationDraftValidator,
	returns: v.object({
		applicationId: v.id('clubApplications')
	}),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		return await upsertIncompleteApplication(ctx, {
			profileId: profile._id,
			draft: args
		});
	}
});

export const submitApplication = mutation({
	args: {
		name: v.string(),
		description: v.optional(v.string()),
		location: v.optional(v.string()),
		locationLatitude: v.optional(v.number()),
		locationLongitude: v.optional(v.number()),
		videoMediaAssetId: v.optional(v.id('mediaAssets')),
		applicantRole: v.optional(v.string()),
		referralSource: v.optional(v.string()),
		referralOther: v.optional(v.string())
	},
	returns: v.object({
		applicationId: v.id('clubApplications')
	}),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		if (!args.videoMediaAssetId) {
			throw new ConvexError('Club video is required before submitting an application');
		}
		const pendingConsent = await ctx.db
			.query('parentChildConsents')
			.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', profile._id))
			.order('desc')
			.first();
		if (pendingConsent?.status === 'pending') {
			throw new ConvexError('Parent consent is required before submitting an application');
		}
		await assertReadyClubVideo(ctx, identity.subject, args.videoMediaAssetId);

		const now = Date.now();
		const existing = await getLatestIncompleteApplication(ctx, profile._id);
		const payload = {
			applicantProfileId: profile._id,
			status: 'pending',
			name: args.name.trim(),
			description: args.description,
			location: args.location,
			locationLatitude: args.locationLatitude,
			locationLongitude: args.locationLongitude,
			videoMediaAssetId: args.videoMediaAssetId,
			applicantRole: args.applicantRole,
			referralSource: args.referralSource,
			referralOther: args.referralOther,
			updatedAt: now
		} as const;

		if (existing) {
			await ctx.db.patch(existing._id, payload);
			await ensureClubApplicationRoom(ctx, existing._id);
			await ctx.scheduler.runAfter(0, internal.googleChat.notifyClubApplicationSubmitted, {
				applicationId: existing._id,
				name: payload.name,
				location: payload.location,
				applicantName: profileDisplayName(profile),
				applicantRole: payload.applicantRole,
				referralSource: payload.referralSource
			});
			return { applicationId: existing._id };
		}

		const applicationId = await ctx.db.insert('clubApplications', {
			...payload,
			createdAt: now
		});
		await ensureClubApplicationRoom(ctx, applicationId);

		await ctx.scheduler.runAfter(0, internal.googleChat.notifyClubApplicationSubmitted, {
			applicationId,
			name: payload.name,
			location: payload.location,
			applicantName: profileDisplayName(profile),
			applicantRole: payload.applicantRole,
			referralSource: payload.referralSource
		});

		return { applicationId };
	}
});

export const getMyIncompleteApplication = query({
	args: {},
	returns: v.any(),
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		return await getLatestIncompleteApplication(ctx, profile._id);
	}
});

export const listMyApplications = query({
	args: {},
	returns: v.any(),
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		return await ctx.db
			.query('clubApplications')
			.withIndex('by_applicant_profile_id', (q) => q.eq('applicantProfileId', profile._id))
			.order('desc')
			.collect();
	}
});

export const listReviewableApplications = query({
	args: {},
	returns: v.any(),
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		await requireGuideSomewhere(ctx, identity.subject);
		const profile = await requireProfile(ctx, identity.subject);
		const applications = await ctx.db
			.query('clubApplications')
			.withIndex('by_status_and_created_at', (q) => q.eq('status', 'pending'))
			.order('desc')
			.collect();

		const items = [];
		for (const application of applications) {
			if (application.applicantProfileId === profile._id) continue;
			const existingReview = await ctx.db
				.query('applicationReviews')
				.withIndex('by_application_id_and_reviewer_profile_id', (q) =>
					q.eq('applicationId', application._id).eq('reviewerProfileId', profile._id)
				)
				.unique();
			items.push({ ...application, myReview: existingReview ?? null });
		}
		return items;
	}
});

// Count of pending applications still awaiting the current Guide's review (no
// applicationReviews row from them yet). Powers the badge on the Application Reviews entry
// point (PRD 6.13: no per-review notifications, just a count badge). Returns null when the
// viewer is not a Guide anywhere (the entry point is hidden entirely for them).
export const countReviewableApplications = query({
	args: {},
	returns: v.union(v.number(), v.null()),
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const profile = await getProfileByAuthUserId(ctx, identity.subject);
		if (!profile) return null;
		if (!(await isGuideSomewhere(ctx, identity.subject))) return null;

		const applications = await ctx.db
			.query('clubApplications')
			.withIndex('by_status_and_created_at', (q) => q.eq('status', 'pending'))
			.collect();

		let count = 0;
		for (const application of applications) {
			if (application.applicantProfileId === profile._id) continue;
			const existingReview = await ctx.db
				.query('applicationReviews')
				.withIndex('by_application_id_and_reviewer_profile_id', (q) =>
					q.eq('applicationId', application._id).eq('reviewerProfileId', profile._id)
				)
				.unique();
			if (!existingReview) count += 1;
		}
		return count;
	}
});

export const upsertApplicationReview = mutation({
	args: {
		applicationId: v.id('clubApplications'),
		score: v.number(),
		note: v.string()
	},
	returns: v.object({
		reviewId: v.id('applicationReviews')
	}),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		await requireGuideSomewhere(ctx, identity.subject);
		const profile = await requireProfile(ctx, identity.subject);
		const application = await ctx.db.get(args.applicationId);
		if (!application) {
			throw new ConvexError('Application not found');
		}
		if (application.status !== 'pending') {
			throw new ConvexError('This application is no longer reviewable');
		}
		if (application.applicantProfileId === profile._id) {
			throw new ConvexError('You cannot review your own application');
		}
		if (!Number.isInteger(args.score) || args.score < 0 || args.score > 10) {
			throw new ConvexError('Score must be an integer from 0 to 10');
		}
		const note = args.note.trim();
		if (!note) {
			throw new ConvexError('Review note is required');
		}

		const now = Date.now();
		const existing = await ctx.db
			.query('applicationReviews')
			.withIndex('by_application_id_and_reviewer_profile_id', (q) =>
				q.eq('applicationId', args.applicationId).eq('reviewerProfileId', profile._id)
			)
			.unique();

		if (existing) {
			await ctx.db.patch(existing._id, {
				reviewerProfileId: profile._id,
				score: args.score,
				note,
				updatedAt: now
			});
			await ensureClubApplicationRoom(ctx, args.applicationId);
			return { reviewId: existing._id };
		}

		const reviewId = await ctx.db.insert('applicationReviews', {
			applicationId: args.applicationId,
			reviewerProfileId: profile._id,
			score: args.score,
			note,
			createdAt: now,
			updatedAt: now
		});
		await ensureClubApplicationRoom(ctx, args.applicationId);
		return { reviewId };
	}
});

// Creates the club and Guide membership for an accepted application, and marks it finalized.
// Extracted from the former `finalizeApplication` mutation so `confirmOnboardingCall` can run the
// exact same club-creation logic once the onboarding call is confirmed.
const createClubFromApplication = async (
	ctx: MutationCtx,
	application: Doc<'clubApplications'>,
	finalizerProfileId: Id<'profiles'>
) => {
	if (application.status === 'finalized') {
		if (!application.createdClubId) {
			throw new ConvexError('Application is finalized without a club');
		}
		return { clubId: application.createdClubId };
	}

	const applicantProfile = await ctx.db.get(application.applicantProfileId);
	if (!applicantProfile) {
		throw new ConvexError('Applicant profile not found');
	}
	const inviteCode = await createInviteCode(ctx);
	const now = Date.now();
	const clubId = await ctx.db.insert('clubs', {
		name: application.name,
		clubCode: inviteCode,
		description: application.description,
		location: application.location,
		locationLatitude: application.locationLatitude,
		locationLongitude: application.locationLongitude,
		videoMediaAssetId: application.videoMediaAssetId,
		// Private by default: newly created clubs must be explicitly opted in to discovery.
		discoverable: false,
		createdByProfileId: application.applicantProfileId,
		createdAt: now,
		updatedAt: now
	});
	await ensureClubRoom(ctx, clubId);

	const guideRole = await getRoleByKey(ctx, 'guide');
	const existingMembership = await getMembershipByProfileId(
		ctx,
		clubId,
		application.applicantProfileId
	);
	if (!existingMembership) {
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: application.applicantProfileId,
			roleId: guideRole._id,
			firstName: applicantProfile.firstName,
			lastName: applicantProfile.lastName,
			username: applicantProfile.username,
			coverPhotoUrl: applicantProfile.coverPhotoUrl,
			createdAt: now
		});
	}

	await ctx.db.patch(application._id, {
		status: 'finalized',
		createdClubId: clubId,
		finalizedByProfileId: finalizerProfileId,
		finalizedAt: now,
		updatedAt: now
	});
	await ctx.db.patch(application.applicantProfileId, {
		activeClubId: clubId,
		firstLoginCompleted: true,
		updatedAt: now
	});

	return { clubId };
};

export const moveToInterview = mutation({
	args: {
		applicationId: v.id('clubApplications')
	},
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const reviewerProfile = await requireProfile(ctx, identity.subject);
		const application = await ctx.db.get(args.applicationId);
		if (!application) {
			throw new ConvexError('Application not found');
		}
		if (application.status !== 'pending') {
			throw new ConvexError('Only applications in review can move to interview');
		}

		await requireDecidingReviewer(ctx, args.applicationId, reviewerProfile._id);

		const now = Date.now();
		await ctx.db.patch(application._id, {
			status: 'interview',
			movedToInterviewAt: now,
			movedToInterviewByProfileId: reviewerProfile._id,
			updatedAt: now
		});
		await ensureClubApplicationRoom(ctx, application._id);

		await dispatchNotification(ctx, {
			recipientProfileId: application.applicantProfileId,
			kind: 'application_status',
			title: 'Your application moved to interview',
			message: 'Your application moved to interview — expect a message to schedule a call.'
		});

		return { success: true };
	}
});

export const decideApplication = mutation({
	args: {
		applicationId: v.id('clubApplications'),
		decision: v.union(v.literal('accepted'), v.literal('rejected')),
		rejectionNote: v.optional(v.string())
	},
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const deciderProfile = await requireProfile(ctx, identity.subject);
		const application = await ctx.db.get(args.applicationId);
		if (!application) {
			throw new ConvexError('Application not found');
		}
		if (application.status !== 'interview') {
			throw new ConvexError('This application is not awaiting a decision');
		}

		await requireDecidingReviewer(ctx, args.applicationId, deciderProfile._id);

		const now = Date.now();
		const rejectionNote =
			args.decision === 'rejected' ? trimOptional(args.rejectionNote) : undefined;

		await ctx.db.patch(application._id, {
			status: args.decision,
			decidedAt: now,
			decidedByProfileId: deciderProfile._id,
			rejectionNote,
			updatedAt: now
		});

		const roomId = await ensureClubApplicationRoom(ctx, application._id);

		if (args.decision === 'rejected') {
			if (rejectionNote) {
				await ctx.db.insert('messages', {
					roomId,
					profileId: deciderProfile._id,
					content: rejectionNote
				});
			}
			await ctx.db.insert('messages', {
				roomId,
				content: 'This application was not accepted.'
			});
			await dispatchNotification(ctx, {
				recipientProfileId: application.applicantProfileId,
				kind: 'application_status',
				title: 'Application update',
				message: 'Your application was not accepted this time.'
			});
		} else {
			await dispatchNotification(ctx, {
				recipientProfileId: application.applicantProfileId,
				kind: 'application_status',
				title: 'Application accepted',
				message: 'Accepted! Schedule your onboarding call in this chat before your club activates.'
			});
		}

		return { success: true };
	}
});

export const setAdminFollowUpFlag = mutation({
	args: {
		applicationId: v.id('clubApplications'),
		reason: v.string()
	},
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const deciderProfile = await requireProfile(ctx, identity.subject);
		const application = await ctx.db.get(args.applicationId);
		if (!application) {
			throw new ConvexError('Application not found');
		}
		if (application.status !== 'accepted') {
			throw new ConvexError('Only accepted applications awaiting onboarding can be flagged');
		}

		await requireDecidingReviewer(ctx, args.applicationId, deciderProfile._id);

		const reason = args.reason.trim();
		if (!reason) {
			throw new ConvexError('A reason is required');
		}

		await ctx.db.patch(application._id, {
			adminFollowUpFlag: {
				reason,
				createdAt: Date.now(),
				createdByProfileId: deciderProfile._id
			},
			updatedAt: Date.now()
		});

		return { success: true };
	}
});

export const confirmOnboardingCall = mutation({
	args: {
		applicationId: v.id('clubApplications')
	},
	returns: v.object({
		clubId: v.id('clubs')
	}),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const finalizerProfile = await requireProfile(ctx, identity.subject);

		const application = await ctx.db.get(args.applicationId);
		if (!application) {
			throw new ConvexError('Application not found');
		}
		if (application.status === 'finalized') {
			if (!application.createdClubId) {
				throw new ConvexError('Application is finalized without a club');
			}
			return { clubId: application.createdClubId };
		}
		if (application.status !== 'accepted') {
			throw new ConvexError('The onboarding call can only be confirmed for accepted applications');
		}

		await requireDecidingReviewer(ctx, args.applicationId, finalizerProfile._id);

		const now = Date.now();
		await ctx.db.patch(application._id, {
			onboardingCallCompletedAt: now,
			updatedAt: now
		});
		const patchedApplication = await ctx.db.get(args.applicationId);
		if (!patchedApplication) {
			throw new ConvexError('Application not found');
		}

		return await createClubFromApplication(ctx, patchedApplication, finalizerProfile._id);
	}
});

export const getApplicationForRoom = query({
	args: {
		roomId: v.id('rooms')
	},
	returns: v.union(
		v.null(),
		v.object({
			applicationId: v.id('clubApplications'),
			name: v.string(),
			status: v.union(
				v.literal('incomplete'),
				v.literal('pending'),
				v.literal('interview'),
				v.literal('accepted'),
				v.literal('rejected'),
				v.literal('finalized')
			),
			isApplicant: v.boolean(),
			canDecide: v.boolean(),
			hasReviewed: v.boolean(),
			adminFollowUpFlag: v.optional(
				v.object({
					reason: v.string(),
					createdAt: v.number()
				})
			)
		})
	),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const room = await ctx.db.get(args.roomId);
		if (!room || room.contextType !== 'clubApplication') {
			return null;
		}
		const application = await ctx.db.get(room.clubApplicationId);
		if (!application) {
			return null;
		}
		const isApplicant = application.applicantProfileId === profile._id;
		const review = isApplicant
			? null
			: await getApplicationReview(ctx, application._id, profile._id);
		if (!isApplicant && !review) {
			throw new ConvexError('You cannot access this chat');
		}

		return {
			applicationId: application._id,
			name: application.name,
			status: application.status,
			isApplicant,
			canDecide: Boolean(review),
			hasReviewed: Boolean(review),
			adminFollowUpFlag: application.adminFollowUpFlag
				? {
						reason: application.adminFollowUpFlag.reason,
						createdAt: application.adminFollowUpFlag.createdAt
					}
				: undefined
		};
	}
});
