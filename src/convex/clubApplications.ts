import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { components, internal } from './_generated/api';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, mutation, query } from './_generated/server';
import {
	getClubRoleByKey,
	getMembershipByProfileId,
	listMembershipsForProfile,
	requireIdentity,
	requireProfile
} from './permissions';
import { ensureClubApplicationRoom, ensureClubRoom } from './chatModel';

type Ctx = QueryCtx | MutationCtx;

const APPLICATION_ADMIN_EMAILS_ENV = 'APPLICATION_REVIEW_ADMIN_EMAILS';

const normalizeEmail = (value: string) => value.trim().toLowerCase();
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

const requireGuideSomewhere = async (ctx: Ctx, userId: string) => {
	const profile = await requireProfile(ctx, userId);
	const memberships = await listMembershipsForProfile(ctx, profile);

	for (const membership of memberships) {
		if (membership.leftAt) continue;
		const role = await ctx.db.get(membership.roleId);
		if (role?.key === 'guide') {
			return;
		}
	}

	throw new ConvexError('Only Guides can review applications');
};

const requireApplicationFinalizer = async (ctx: Ctx, userId: string) => {
	const allowedEmails = (process.env[APPLICATION_ADMIN_EMAILS_ENV] ?? '')
		.split(',')
		.map((email) => normalizeEmail(email))
		.filter(Boolean);
	const authUser = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: '_id', value: userId }]
	})) as { email?: string } | null;
	if (!authUser?.email || !allowedEmails.includes(normalizeEmail(authUser.email))) {
		throw new ConvexError('Permission denied');
	}
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

export const finalizeApplication = mutation({
	args: {
		applicationId: v.id('clubApplications')
	},
	returns: v.object({
		clubId: v.id('clubs')
	}),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const finalizerProfile = await requireProfile(ctx, identity.subject);
		await requireApplicationFinalizer(ctx, identity.subject);

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
		if (application.status !== 'pending') {
			throw new ConvexError('Application is not ready to finalize');
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
			finalizedByProfileId: finalizerProfile._id,
			finalizedAt: now,
			updatedAt: now
		});
		await ctx.db.patch(application.applicantProfileId, {
			activeClubId: clubId,
			firstLoginCompleted: true,
			updatedAt: now
		});

		return { clubId };
	}
});
