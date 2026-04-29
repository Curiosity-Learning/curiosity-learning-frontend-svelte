import { ConvexError, v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { components } from './_generated/api';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { getMembership, requireIdentity, requireProfile } from './permissions';

type Ctx = QueryCtx | MutationCtx;

const APPLICATION_ADMIN_EMAILS_ENV = 'APPLICATION_REVIEW_ADMIN_EMAILS';

const normalizeEmail = (value: string) => value.trim().toLowerCase();

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

const requireGuideSomewhere = async (ctx: Ctx, userId: string) => {
	const memberships = await ctx.db
		.query('clubMembers')
		.withIndex('by_user', (q) => q.eq('userId', userId))
		.collect();

	for (const membership of memberships) {
		if (membership.leftAt) continue;
		const role = await ctx.db.get(membership.roleId);
		if (role?.name === 'Guide') {
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
		const pendingConsent = await ctx.db
			.query('parentChildConsents')
			.withIndex('by_child_user_id', (q) => q.eq('childUserId', identity.subject))
			.order('desc')
			.first();
		if (pendingConsent?.status === 'pending') {
			throw new ConvexError('Parent consent is required before submitting an application');
		}
		if (args.videoMediaAssetId) {
			await assertReadyClubVideo(ctx, identity.subject, args.videoMediaAssetId);
		}

		const now = Date.now();
		const applicationId = await ctx.db.insert('clubApplications', {
			applicantUserId: identity.subject,
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
			createdAt: now,
			updatedAt: now
		});

		return { applicationId };
	}
});

export const listMyApplications = query({
	args: {},
	returns: v.any(),
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		return await ctx.db
			.query('clubApplications')
			.withIndex('by_applicant_user_id', (q) => q.eq('applicantUserId', identity.subject))
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
				.withIndex('by_application_id_and_reviewer_user_id', (q) =>
					q.eq('applicationId', application._id).eq('reviewerUserId', identity.subject)
				)
				.first();
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
		if (application.applicantUserId === identity.subject) {
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
			.withIndex('by_application_id_and_reviewer_user_id', (q) =>
				q.eq('applicationId', args.applicationId).eq('reviewerUserId', identity.subject)
			)
			.first();

		if (existing) {
			await ctx.db.patch(existing._id, { score: args.score, note, updatedAt: now });
			return { reviewId: existing._id };
		}

		const reviewId = await ctx.db.insert('applicationReviews', {
			applicationId: args.applicationId,
			reviewerUserId: identity.subject,
			reviewerProfileId: profile._id,
			score: args.score,
			note,
			createdAt: now,
			updatedAt: now
		});
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
		await requireProfile(ctx, identity.subject);
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
			createdByUserId: application.applicantUserId,
			createdAt: now,
			updatedAt: now
		});

		const guideRole = await getRoleByName(ctx, 'Guide');
		const existingMembership = await getMembership(ctx, clubId, application.applicantUserId);
		if (!existingMembership) {
			await ctx.db.insert('clubMembers', {
				clubId,
				userId: application.applicantUserId,
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
			finalizedByUserId: identity.subject,
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
