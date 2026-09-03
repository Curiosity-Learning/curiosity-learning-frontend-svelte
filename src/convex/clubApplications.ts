import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, mutation, query } from './_generated/server';
import {
	getProfileByAuthUserId,
	listMembershipsForProfile,
	requireIdentity,
	requireProfile
} from './permissions';
import { ensureClubApplicationRoom, profileDisplayName } from './chatModel';
import { dispatchNotification } from './notificationsModel';
import { createClubForFounder } from './clubCreationModel';
import { resolveMediaAssetFileUrl } from './mediaStorage';
import {
	assignReviewsForApplicationIfWindowOpen,
	maybeNotifyScoreDiscrepancy
} from './reviewAssignmentModel';

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
// ones who can move it to interview, accept/reject (which creates the club immediately — CL-710),
// or flag it for follow-up.
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

// CL-710 CEO review item 2: reviewers/interviewers need to actually watch the application video —
// mirrors clubs.ts's resolveClubVideoUrl for the same asset-readiness checks.
//
// CL-710 CEO review round 3 (Braga bug): this only ever produces a *direct* storage URL
// (mediaStorage.ts's resolveMediaAssetFileUrl). That's fine in local dev, where the bucket is
// public, but in any environment with secure media delivery configured (MEDIA_CDN_BASE_URL +
// CloudFront signing keys — see mediaStorage config) the underlying bucket is private and this
// URL 403s, so the <video> tag silently fails to load. It was never the asset's readiness or
// moderation status (moderation.status: 'skipped-video' for videos is expected — safety
// screening is intentionally out of scope for video in v1 — and is NOT checked here or in
// clubs.ts's mirror). Kept as a same-environment (no-CDN-configured) fallback; the real fix is
// getApplicationVideoDeliveryAsset below, which the client signs through
// /api/media/refresh the same way club/session/project media already does.
export const resolveApplicationVideoUrl = async (
	ctx: Ctx,
	application: Doc<'clubApplications'>
): Promise<string | null> => {
	if (!application.videoMediaAssetId) {
		return null;
	}
	const asset = await ctx.db.get(application.videoMediaAssetId);
	if (!asset || asset.status !== 'ready' || asset.mediaKind !== 'video') {
		return null;
	}
	return resolveMediaAssetFileUrl(asset);
};

// Whether the application has a ready, playable video — the readiness half of
// resolveApplicationVideoUrl without committing to a delivery URL. Used by admin.ts's
// adminGetApplication so the admin portal knows to fetch the signed URL
// (clubApplicationsNode.getApplicationVideoSignedUrl).
export const applicationHasReadyVideo = async (ctx: Ctx, application: Doc<'clubApplications'>) => {
	if (!application.videoMediaAssetId) {
		return false;
	}
	const asset = await ctx.db.get(application.videoMediaAssetId);
	return Boolean(asset && asset.status === 'ready' && asset.mediaKind === 'video');
};

// Who is looking at an application, and therefore what they may see of it. The audience is the
// same one chatModel.getClubApplicationAccess admits to the application chat: the applicant
// themselves, a global admin (staff decide applications from the admin portal), any Guide who has
// reviewed it, and any Guide merely ASSIGNED to review it (covers the review page and the chat
// before scores are submitted — and the hand-assigned reviewers of a season where no guides
// existed when applications came in). Returns null for everyone else. Used by the video delivery
// gate, the chat page's getApplicationForRoom, and the application detail page's getApplication.
export type ApplicationViewer =
	| { role: 'applicant'; hasReviewed: false; isAssigned: false }
	| { role: 'admin'; hasReviewed: false; isAssigned: false }
	| { role: 'reviewer'; hasReviewed: boolean; isAssigned: boolean };

export const resolveApplicationViewer = async (
	ctx: Ctx,
	application: Doc<'clubApplications'>,
	profile: Doc<'profiles'>
): Promise<ApplicationViewer | null> => {
	if (application.applicantProfileId === profile._id) {
		return { role: 'applicant', hasReviewed: false, isAssigned: false };
	}
	if (profile.globalRole === 'admin') {
		return { role: 'admin', hasReviewed: false, isAssigned: false };
	}
	const review = await getApplicationReview(ctx, application._id, profile._id);
	const assignment = await getAssignment(ctx, application._id, profile._id);
	if (!review && !assignment) {
		return null;
	}
	return { role: 'reviewer', hasReviewed: Boolean(review), isAssigned: Boolean(assignment) };
};

const canAccessApplicationVideo = async (
	ctx: Ctx,
	application: Doc<'clubApplications'>,
	profile: Doc<'profiles'>
) => Boolean(await resolveApplicationViewer(ctx, application, profile));

// Reviews and reviewer assignments of an application, with reviewer names — the reviewer/admin
// half of both admin.adminGetApplication and getApplication below. Never hand this to the
// applicant: it carries scores, notes, and who reviewed.
export const buildApplicationReviewSummary = async (
	ctx: Ctx,
	applicationId: Id<'clubApplications'>
) => {
	const reviewRows = await ctx.db
		.query('applicationReviews')
		.withIndex('by_application_id', (q) => q.eq('applicationId', applicationId))
		.collect();
	const reviews = await Promise.all(
		reviewRows.map(async (review) => {
			const reviewerProfile = await ctx.db.get(review.reviewerProfileId);
			return {
				reviewId: review._id,
				reviewerName: reviewerProfile ? profileDisplayName(reviewerProfile) : 'Unknown reviewer',
				principlesScore: review.principlesScore ?? null,
				safetyScore: review.safetyScore ?? null,
				score: review.score,
				note: review.note,
				createdAt: review.createdAt
			};
		})
	);

	// Assigned reviewers/interviewers (PRD 6.11: they are the application chat's guide-side
	// participants). hasReviewed distinguishes "assigned, scores pending" from "reviewed".
	const assignmentRows = await ctx.db
		.query('applicationReviewAssignments')
		.withIndex('by_application_id', (q) => q.eq('applicationId', applicationId))
		.collect();
	const assignedReviewers = await Promise.all(
		assignmentRows.map(async (assignment) => {
			const reviewerProfile = await ctx.db.get(assignment.reviewerProfileId);
			return {
				profileId: assignment.reviewerProfileId,
				name: reviewerProfile ? profileDisplayName(reviewerProfile) : 'Unknown user',
				username: reviewerProfile?.username ?? null,
				assignedAt: assignment.assignedAt,
				hasReviewed: reviewRows.some(
					(review) => review.reviewerProfileId === assignment.reviewerProfileId
				)
			};
		})
	);

	return { reviews, assignedReviewers };
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

// Google Chat submission ping: omit the "Applicant:" line entirely when the profile has no name
// yet (chatModel.profileDisplayName would say "Someone").
const applicantNameForNotification = (profile: Doc<'profiles'>) => {
	const name = profileDisplayName(profile);
	return name === 'Someone' ? undefined : name;
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
				applicantName: applicantNameForNotification(profile),
				applicantRole: payload.applicantRole,
				referralSource: payload.referralSource
			});
			// PRD 6.9.2 point 3: if a review window is currently open, assign this application
			// right away instead of waiting for the next daily cron pass.
			await assignReviewsForApplicationIfWindowOpen(ctx, existing._id);
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
			applicantName: applicantNameForNotification(profile),
			applicantRole: payload.applicantRole,
			referralSource: payload.referralSource
		});

		// PRD 6.9.2 point 3: rolling mid-window assignment for new submissions too.
		await assignReviewsForApplicationIfWindowOpen(ctx, applicationId);

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

// Applicant-initiated support channel for an in-progress (incomplete) application: historically
// the chat room only came into existence at submission (submitApplication above), which left
// applicants stuck mid-wizard — e.g. on a failing video upload — with no way to reach staff.
// Idempotent via ensureClubApplicationRoom; the room carries over to submission unchanged (same
// application row, same room), and access/chat-list/rendering already handle incomplete
// applications (getClubApplicationAccess and chat.listRoomSummaries never check status).
// Staff-initiated counterpart: admin.ts's adminEnsureApplicationRoom.
export const ensureMyApplicationRoom = mutation({
	args: {},
	returns: v.object({ roomId: v.id('rooms') }),
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const application = await getLatestIncompleteApplication(ctx, profile._id);
		if (!application) {
			throw new ConvexError('No application in progress');
		}
		const roomId = await ensureClubApplicationRoom(ctx, application._id);
		return { roomId };
	}
});

// CL-690 CEO review item F: enriched with the application's chat roomId (null until submission
// creates one — see ensureClubApplicationRoom in submitApplication) so the no-club page can link
// straight to the chat instead of just the generic chat list.
export const listMyApplications = query({
	args: {},
	returns: v.any(),
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const applications = await ctx.db
			.query('clubApplications')
			.withIndex('by_applicant_profile_id', (q) => q.eq('applicantProfileId', profile._id))
			.order('desc')
			.collect();

		const result = [];
		for (const application of applications) {
			const room = await ctx.db
				.query('rooms')
				.withIndex('by_club_application_id', (q) => q.eq('clubApplicationId', application._id))
				.first();
			result.push({ ...application, roomId: room?._id ?? null });
		}
		return result;
	}
});

// Assignment rows for a given reviewer, keyed by applicationId, for quick lookup.
const getAssignment = async (
	ctx: Ctx,
	applicationId: Id<'clubApplications'>,
	reviewerProfileId: Id<'profiles'>
) => {
	return await ctx.db
		.query('applicationReviewAssignments')
		.withIndex('by_application_id_and_reviewer_profile_id', (q) =>
			q.eq('applicationId', applicationId).eq('reviewerProfileId', reviewerProfileId)
		)
		.unique();
};

// CL-709: assignment-based. Only applications ASSIGNED to the current Guide (still pending, not
// yet reviewed by them) show up — this replaces the old self-select "every pending application"
// list.
export const listReviewableApplications = query({
	args: {},
	returns: v.any(),
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		await requireGuideSomewhere(ctx, identity.subject);
		const profile = await requireProfile(ctx, identity.subject);

		const assignments = await ctx.db
			.query('applicationReviewAssignments')
			.withIndex('by_reviewer_profile_id', (q) => q.eq('reviewerProfileId', profile._id))
			.collect();

		const items = [];
		for (const assignment of assignments) {
			const application = await ctx.db.get(assignment.applicationId);
			if (!application || application.status !== 'pending') continue;
			const existingReview = await getApplicationReview(ctx, application._id, profile._id);
			if (existingReview) continue;
			items.push({
				...application,
				myReview: null,
				// CL-710 CEO review item 2: the video is one of the most important parts of the
				// application — surface it directly on the review card.
				videoUrl: await resolveApplicationVideoUrl(ctx, application)
			});
		}
		items.sort((a, b) => b.createdAt - a.createdAt);
		return items;
	}
});

// Count of assigned-but-unreviewed applications for the current Guide. Powers the badge on the
// Application Reviews entry point (PRD 6.13: no per-review notifications, just a count badge).
// Returns null when the viewer is not a Guide anywhere (the entry point is hidden for them).
export const countReviewableApplications = query({
	args: {},
	returns: v.union(v.number(), v.null()),
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const profile = await getProfileByAuthUserId(ctx, identity.subject);
		if (!profile) return null;
		if (!(await isGuideSomewhere(ctx, identity.subject))) return null;

		const assignments = await ctx.db
			.query('applicationReviewAssignments')
			.withIndex('by_reviewer_profile_id', (q) => q.eq('reviewerProfileId', profile._id))
			.collect();

		let count = 0;
		for (const assignment of assignments) {
			const application = await ctx.db.get(assignment.applicationId);
			if (!application || application.status !== 'pending') continue;
			const existingReview = await getApplicationReview(ctx, application._id, profile._id);
			if (!existingReview) count += 1;
		}
		return count;
	}
});

const clampScore = (value: number, label: string) => {
	if (!Number.isInteger(value) || value < 0 || value > 10) {
		throw new ConvexError(`${label} must be an integer from 0 to 10`);
	}
	return value;
};

export const upsertApplicationReview = mutation({
	args: {
		applicationId: v.id('clubApplications'),
		principlesScore: v.number(),
		safetyScore: v.number(),
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
		const principlesScore = clampScore(args.principlesScore, 'Guiding Principles score');
		const safetyScore = clampScore(args.safetyScore, 'Safety score');
		const note = args.note.trim();
		if (!note) {
			throw new ConvexError('Review note is required');
		}

		const existing = await getApplicationReview(ctx, args.applicationId, profile._id);
		// CL-709: reviewing requires an assignment — unless a review row already exists (ops/admin
		// escape hatch: a Guide who reviewed before assignment existed, e.g. via direct data access,
		// can still edit their own review; this also keeps CL-710's decision flow, which is gated
		// on "has an applicationReviews row" rather than on assignment, working unchanged).
		if (!existing) {
			const assignment = await getAssignment(ctx, args.applicationId, profile._id);
			if (!assignment) {
				throw new ConvexError('This application is not assigned to you');
			}
		}

		const score = Math.round(((principlesScore + safetyScore) / 2) * 10) / 10;
		const now = Date.now();

		if (existing) {
			await ctx.db.patch(existing._id, {
				reviewerProfileId: profile._id,
				principlesScore,
				safetyScore,
				score,
				note,
				updatedAt: now
			});
			await ensureClubApplicationRoom(ctx, args.applicationId);
			await maybeNotifyScoreDiscrepancy(ctx, args.applicationId);
			return { reviewId: existing._id };
		}

		const reviewId = await ctx.db.insert('applicationReviews', {
			applicationId: args.applicationId,
			reviewerProfileId: profile._id,
			principlesScore,
			safetyScore,
			score,
			note,
			createdAt: now,
			updatedAt: now
		});
		await ensureClubApplicationRoom(ctx, args.applicationId);
		await maybeNotifyScoreDiscrepancy(ctx, args.applicationId);
		return { reviewId };
	}
});

// Creates the club and Guide membership for an accepted application. CL-710 CEO review item 3:
// the interview IS the onboarding call, so this now runs inline from decideApplication's accept
// branch — there is no separate confirm-onboarding-call step. Guarded by `createdClubId` so a
// retried/duplicate call is a no-op rather than creating a second club. Exported for admin.ts's
// adminDecideApplication (staff decisions from the admin portal share the accept side effects).
export const createClubFromApplication = async (
	ctx: MutationCtx,
	application: Doc<'clubApplications'>
) => {
	if (application.createdClubId) {
		return { clubId: application.createdClubId };
	}

	// Shared with clubLeaderInvites.claimMyLeaderInvite (clubCreationModel.ts): club row + code,
	// club room, Guide membership, profile activation, CoC assignment.
	const { clubId } = await createClubForFounder(ctx, {
		founderProfileId: application.applicantProfileId,
		name: application.name,
		description: application.description,
		location: application.location,
		locationLatitude: application.locationLatitude,
		locationLongitude: application.locationLongitude,
		videoMediaAssetId: application.videoMediaAssetId
	});

	await ctx.db.patch(application._id, {
		createdClubId: clubId,
		updatedAt: Date.now()
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

// CL-710 CEO review item 3: the interview itself IS the onboarding call. Accepting an application
// creates the club immediately — there is no more separate "confirm onboarding call" step.
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
			const patchedApplication = await ctx.db.get(application._id);
			if (!patchedApplication) {
				throw new ConvexError('Application not found');
			}
			await createClubFromApplication(ctx, patchedApplication);

			await ctx.db.insert('messages', {
				roomId,
				content: 'This application was accepted — the club is live!'
			});
			await dispatchNotification(ctx, {
				recipientProfileId: application.applicantProfileId,
				kind: 'application_status',
				title: 'Application accepted',
				message: 'Congratulations! Your application was accepted and your club is now live.'
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
			throw new ConvexError('Only accepted applications can be flagged for follow-up');
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

export const getApplicationForRoom = query({
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
			applicationId: v.id('clubApplications'),
			name: v.string(),
			status: v.union(
				v.literal('incomplete'),
				v.literal('pending'),
				v.literal('interview'),
				v.literal('accepted'),
				v.literal('rejected')
			),
			isApplicant: v.boolean(),
			canDecide: v.boolean(),
			hasReviewed: v.boolean(),
			// CL-710 CEO review item 2: the applicant's video, surfaced for both the applicant (to
			// double-check what they submitted) and reviewers/interviewers deciding on it.
			videoUrl: v.union(v.string(), v.null()),
			// CL-710 CEO review round 3: lets the client request a signed delivery URL via
			// getApplicationVideoDeliveryAsset/api/media/refresh when secure media delivery is
			// configured, instead of relying solely on the (possibly 403ing) direct videoUrl above.
			videoMediaAssetId: v.optional(v.id('mediaAssets')),
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
		// Same audience as the room itself (chatModel.getClubApplicationAccess): applicant, admin,
		// reviewer, or assigned-but-not-yet-reviewed Guide. Previously only applicant/reviewer, so
		// assigned Guides and staff got a silent error and saw neither the video nor the status
		// banner in the chat they could otherwise read.
		const viewer = await resolveApplicationViewer(ctx, application, profile);
		if (!viewer) {
			throw new ConvexError('You cannot access this chat');
		}
		const isApplicant = viewer.role === 'applicant';
		// Deciding (move to interview / accept / reject / flag) still requires a review row.
		const canDecide = viewer.role === 'reviewer' && viewer.hasReviewed;

		return {
			roomId: args.roomId,
			applicationId: application._id,
			name: application.name,
			status: application.status,
			isApplicant,
			canDecide,
			hasReviewed: canDecide,
			videoUrl: await resolveApplicationVideoUrl(ctx, application),
			videoMediaAssetId: application.videoMediaAssetId,
			adminFollowUpFlag: application.adminFollowUpFlag
				? {
						reason: application.adminFollowUpFlag.reason,
						createdAt: application.adminFollowUpFlag.createdAt
					}
				: undefined
		};
	}
});

const applicationStatusValidator = v.union(
	v.literal('incomplete'),
	v.literal('pending'),
	v.literal('interview'),
	v.literal('accepted'),
	v.literal('rejected')
);

const applicationReviewSummaryValidator = v.object({
	decidedByName: v.union(v.string(), v.null()),
	adminFollowUpFlag: v.union(
		v.null(),
		v.object({
			reason: v.string(),
			createdAt: v.number()
		})
	),
	reviews: v.array(
		v.object({
			reviewId: v.id('applicationReviews'),
			reviewerName: v.string(),
			principlesScore: v.union(v.number(), v.null()),
			safetyScore: v.union(v.number(), v.null()),
			score: v.number(),
			note: v.string(),
			createdAt: v.number()
		})
	),
	assignedReviewers: v.array(
		v.object({
			profileId: v.id('profiles'),
			name: v.string(),
			username: v.union(v.string(), v.null()),
			assignedAt: v.number(),
			hasReviewed: v.boolean()
		})
	)
});

// Application detail page (/applications/review/{id}) — the member-app counterpart of
// admin.adminGetApplication. Same audience as the application chat (resolveApplicationViewer);
// the applicant gets their own details and video but `review` is null for them: no scores, notes,
// reviewer names, or who decided. Reviewers (assigned or reviewed) and admins get everything, plus
// `myReview` so an assigned Guide can revisit/edit their own scores.
export const getApplication = query({
	args: {
		applicationId: v.id('clubApplications')
	},
	returns: v.union(
		v.null(),
		v.object({
			applicationId: v.id('clubApplications'),
			status: applicationStatusValidator,
			name: v.string(),
			description: v.union(v.string(), v.null()),
			location: v.union(v.string(), v.null()),
			applicantRole: v.union(v.string(), v.null()),
			referralSource: v.union(v.string(), v.null()),
			referralOther: v.union(v.string(), v.null()),
			createdAt: v.number(),
			decidedAt: v.union(v.number(), v.null()),
			// Already posted into the application chat on rejection, so applicant-visible.
			rejectionNote: v.union(v.string(), v.null()),
			createdClubId: v.union(v.id('clubs'), v.null()),
			clubName: v.union(v.string(), v.null()),
			roomId: v.union(v.id('rooms'), v.null()),
			applicant: v.object({
				profileId: v.id('profiles'),
				name: v.string(),
				username: v.union(v.string(), v.null())
			}),
			// Direct storage URL fallback (local dev); the client prefers a signed delivery URL via
			// getApplicationVideoDeliveryAsset / api/media/refresh (see getApplicationForRoom).
			videoUrl: v.union(v.string(), v.null()),
			videoMediaAssetId: v.optional(v.id('mediaAssets')),
			viewer: v.object({
				role: v.union(v.literal('applicant'), v.literal('reviewer'), v.literal('admin')),
				hasReviewed: v.boolean(),
				isAssigned: v.boolean()
			}),
			myReview: v.union(
				v.null(),
				v.object({
					principlesScore: v.union(v.number(), v.null()),
					safetyScore: v.union(v.number(), v.null()),
					note: v.string()
				})
			),
			review: v.union(v.null(), applicationReviewSummaryValidator)
		})
	),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const application = await ctx.db.get(args.applicationId);
		if (!application) {
			return null;
		}
		const viewer = await resolveApplicationViewer(ctx, application, profile);
		if (!viewer) {
			throw new ConvexError('You cannot access this application');
		}

		const applicantProfile = await ctx.db.get(application.applicantProfileId);
		const room = await ctx.db
			.query('rooms')
			.withIndex('by_club_application_id', (q) => q.eq('clubApplicationId', application._id))
			.first();
		const createdClub = application.createdClubId
			? await ctx.db.get(application.createdClubId)
			: null;

		let review: (typeof applicationReviewSummaryValidator)['type'] | null = null;
		if (viewer.role !== 'applicant') {
			const decidedByProfile = application.decidedByProfileId
				? await ctx.db.get(application.decidedByProfileId)
				: null;
			review = {
				...(await buildApplicationReviewSummary(ctx, application._id)),
				decidedByName: decidedByProfile ? profileDisplayName(decidedByProfile) : null,
				adminFollowUpFlag: application.adminFollowUpFlag
					? {
							reason: application.adminFollowUpFlag.reason,
							createdAt: application.adminFollowUpFlag.createdAt
						}
					: null
			};
		}
		const ownReview =
			viewer.role === 'reviewer' && viewer.hasReviewed
				? await getApplicationReview(ctx, application._id, profile._id)
				: null;

		return {
			applicationId: application._id,
			status: application.status,
			name: application.name,
			description: application.description ?? null,
			location: application.location ?? null,
			applicantRole: application.applicantRole ?? null,
			referralSource: application.referralSource ?? null,
			referralOther: application.referralOther ?? null,
			createdAt: application.createdAt,
			decidedAt: application.decidedAt ?? null,
			rejectionNote: application.rejectionNote ?? null,
			createdClubId: application.createdClubId ?? null,
			clubName: createdClub?.name ?? null,
			roomId: room?._id ?? null,
			applicant: {
				profileId: application.applicantProfileId,
				name: applicantProfile ? profileDisplayName(applicantProfile) : 'Applicant',
				username: applicantProfile?.username ?? null
			},
			videoUrl: await resolveApplicationVideoUrl(ctx, application),
			videoMediaAssetId: application.videoMediaAssetId,
			viewer: {
				role: viewer.role,
				hasReviewed: viewer.hasReviewed,
				isAssigned: viewer.isAssigned
			},
			myReview: ownReview
				? {
						principlesScore: ownReview.principlesScore ?? null,
						safetyScore: ownReview.safetyScore ?? null,
						note: ownReview.note
					}
				: null,
			review
		};
	}
});

// CL-710 CEO review round 3 (Braga bug fix): signed-delivery counterpart to the direct `videoUrl`
// above. Mirrors clubs.ts/updates.ts's `get*DeliveryAssets` queries (used via
// src/lib/server/signed-media.ts + /api/media/refresh) so the application video can be served
// through CloudFront-signed URLs in any environment where the storage bucket is private, instead
// of only ever working when the bucket happens to allow direct/unauthenticated reads.
export const getApplicationVideoDeliveryAsset = query({
	args: {
		applicationId: v.id('clubApplications')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const application = await ctx.db.get(args.applicationId);
		if (!application || !application.videoMediaAssetId) {
			return null;
		}
		if (!(await canAccessApplicationVideo(ctx, application, profile))) {
			throw new ConvexError('Permission denied');
		}

		const asset = await ctx.db.get(application.videoMediaAssetId);
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
