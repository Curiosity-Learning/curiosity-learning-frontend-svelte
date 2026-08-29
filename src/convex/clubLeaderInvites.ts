import { ConvexError, v } from 'convex/values';
import { internalAction, internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { getProfileByAuthUserId, requireGlobalAdmin, requireIdentity } from './permissions';
import { getAuthUserEmailInfo } from './authEmail';
import { createClubForFounder } from './clubCreationModel';
import { ensureClubApplicationRoom } from './chatModel';
import { sendEmail } from './email/resend';
import { clubLeaderInviteEmail } from './email/templates';

// ---------------------------------------------------------------------------
// Club leader invites: staff onboard someone who already runs a club in the real world.
//
// The admin fills in the club's details up front (stored as draft fields on the invite row) and
// the invitee skips the application pipeline entirely. Claim works exactly like
// adminInvites.claimAdminInvite: the invitee signs in on the member app with a *verified* Better
// Auth account whose email matches, and claimMyLeaderInvite — which takes no arguments and only
// ever acts on the caller — founds the club via the same shared path an accepted application
// uses (clubCreationModel.createClubForFounder), so club code, chat room, Guide membership,
// profile activation, and CoC assignment all behave identically.
//
// This is a deliberate, admin-only exception to the CL-714 governance rule ("no guide club code;
// join as Learner, promote to Guide"): that rule bans shareable codes granting Guide on existing
// clubs, while this is a single-use, email-addressed grant creating a brand-new club whose
// founder is necessarily its Guide — the same outcome as an accepted application.
//
//   - Every management endpoint (create/revoke/list) requires a global admin.
//   - Invites expire (single-use); rows are kept forever as an audit trail.
//   - The invite email is a minimal doorway (CEO principle: everything happens in the app).
// ---------------------------------------------------------------------------

// 30 days, not adminInvites' 7: leader invites usually follow a real-world conversation and the
// invitee may take a while to sign up; an expired invite just means the admin re-issues it.
export const LEADER_INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const LEADER_INVITE_TTL_DAYS = 30;

const normalizeEmail = (email: string) => email.trim().toLowerCase();

// Light-touch shape check only — the invite is harmless if the address is undeliverable, and
// Better Auth is the authority on the address at claim time.
const isPlausibleEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const inviteStatus = (invite: Doc<'clubLeaderInvites'>, now: number) => {
	if (invite.acceptedAt) return 'accepted' as const;
	if (invite.revokedAt) return 'revoked' as const;
	if (invite.expiresAt <= now) return 'expired' as const;
	return 'pending' as const;
};

const getPendingInviteByEmail = async (ctx: QueryCtx | MutationCtx, email: string) => {
	const invites = await ctx.db
		.query('clubLeaderInvites')
		.withIndex('by_email', (q) => q.eq('email', email))
		.collect();
	const now = Date.now();
	return invites.find((invite) => inviteStatus(invite, now) === 'pending') ?? null;
};

const displayName = (profile: Doc<'profiles'> | null) => {
	if (!profile) return null;
	const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
	return name || profile.username || null;
};

const trimOptional = (value?: string) => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
};

// ---------------------------------------------------------------------------
// Admin-facing management endpoints (admin portal).
// ---------------------------------------------------------------------------

export const listLeaderInvites = query({
	args: {},
	handler: async (ctx) => {
		await requireGlobalAdmin(ctx);
		const invites = await ctx.db.query('clubLeaderInvites').order('desc').collect();
		const now = Date.now();
		return await Promise.all(
			invites.map(async (invite) => ({
				inviteId: invite._id,
				email: invite.email,
				status: inviteStatus(invite, now),
				clubName: invite.clubName,
				clubLocation: invite.clubLocation ?? null,
				createdAt: invite.createdAt,
				expiresAt: invite.expiresAt,
				acceptedAt: invite.acceptedAt ?? null,
				createdClubId: invite.createdClubId ?? null,
				invitedBy: displayName(await ctx.db.get(invite.invitedByProfileId))
			}))
		);
	}
});

export const createLeaderInvite = mutation({
	args: {
		email: v.string(),
		clubName: v.string(),
		clubDescription: v.optional(v.string()),
		clubLocation: v.optional(v.string()),
		clubLocationLatitude: v.optional(v.number()),
		clubLocationLongitude: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const identity = await requireGlobalAdmin(ctx);
		const callerProfile = await getProfileByAuthUserId(ctx, identity.subject);
		if (!callerProfile) {
			throw new ConvexError('Profile not found');
		}

		const email = normalizeEmail(args.email);
		if (!isPlausibleEmail(email)) {
			throw new ConvexError('That does not look like a valid email address');
		}
		const clubName = args.clubName.trim();
		if (!clubName) {
			throw new ConvexError('Club name is required');
		}
		if (await getPendingInviteByEmail(ctx, email)) {
			throw new ConvexError('There is already a pending leader invite for that email');
		}

		const now = Date.now();
		const inviteId = await ctx.db.insert('clubLeaderInvites', {
			email,
			invitedByProfileId: callerProfile._id,
			clubName,
			clubDescription: trimOptional(args.clubDescription),
			clubLocation: trimOptional(args.clubLocation),
			clubLocationLatitude: args.clubLocationLatitude,
			clubLocationLongitude: args.clubLocationLongitude,
			createdAt: now,
			expiresAt: now + LEADER_INVITE_TTL_MS
		});

		await ctx.scheduler.runAfter(0, internal.clubLeaderInvites.sendLeaderInviteEmail, {
			email,
			clubName,
			inviterName: displayName(callerProfile) ?? undefined
		});

		return { inviteId };
	}
});

export const revokeLeaderInvite = mutation({
	args: { inviteId: v.id('clubLeaderInvites') },
	handler: async (ctx, args) => {
		const identity = await requireGlobalAdmin(ctx);
		const callerProfile = await getProfileByAuthUserId(ctx, identity.subject);
		if (!callerProfile) {
			throw new ConvexError('Profile not found');
		}
		const invite = await ctx.db.get(args.inviteId);
		if (!invite) {
			throw new ConvexError('Invite not found');
		}
		if (inviteStatus(invite, Date.now()) !== 'pending') {
			throw new ConvexError('Only pending invites can be revoked');
		}
		await ctx.db.patch(invite._id, {
			revokedAt: Date.now(),
			revokedByProfileId: callerProfile._id
		});
		return null;
	}
});

// ---------------------------------------------------------------------------
// Claim path (member app, called for signed-in club-less users by the (app) layout gate).
// ---------------------------------------------------------------------------

export const claimMyLeaderInvite = mutation({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);

		const emailInfo = await getAuthUserEmailInfo(ctx, identity.subject);
		// requireEmailVerification blocks unverified email/password sign-ins and Google emails
		// arrive verified, so this is belt-and-braces — but founding a club as Guide is exactly
		// where belt-and-braces belongs.
		if (!emailInfo?.emailVerified) {
			return { status: 'no_invite' as const };
		}

		const invite = await getPendingInviteByEmail(ctx, normalizeEmail(emailInfo.email));
		if (!invite) {
			return { status: 'no_invite' as const };
		}

		// Member-app users always run ensureProfile/completeSignupProfile before reaching the
		// (app) layout, so a missing profile means something is off — bail rather than founding a
		// club for a half-created account (the invite stays pending for the next attempt).
		const profile = await getProfileByAuthUserId(ctx, identity.subject);
		if (!profile) {
			return { status: 'no_invite' as const };
		}
		if (profile.suspendedAt) {
			return { status: 'no_invite' as const };
		}

		const { clubId } = await createClubForFounder(ctx, {
			founderProfileId: profile._id,
			name: invite.clubName,
			description: invite.clubDescription,
			location: invite.clubLocation,
			locationLatitude: invite.clubLocationLatitude,
			locationLongitude: invite.clubLocationLongitude
		});

		await ctx.db.patch(invite._id, {
			acceptedAt: Date.now(),
			acceptedByProfileId: profile._id,
			createdClubId: clubId
		});

		// Invited leaders also get the standard application-support chat: a real accepted
		// clubApplications row (their application WAS accepted — by staff, up front) plus its
		// room. That gives them the same in-app channel every applicant has, staff can join from
		// the admin portal, and specific Guides can be attached via applicationSupportGuides.
		await createAcceptedApplicationForInvite(ctx, invite, profile._id, clubId);

		return { status: 'claimed' as const, clubId };
	}
});

// Shared by claimMyLeaderInvite and the CLI backfill below. Idempotent per club via the
// by_created_club_id lookup.
const createAcceptedApplicationForInvite = async (
	ctx: MutationCtx,
	invite: Doc<'clubLeaderInvites'>,
	applicantProfileId: Id<'profiles'>,
	clubId: Id<'clubs'>
) => {
	const existing = await ctx.db
		.query('clubApplications')
		.withIndex('by_created_club_id', (q) => q.eq('createdClubId', clubId))
		.first();
	if (existing) {
		return { applicationId: existing._id };
	}

	const now = Date.now();
	const applicationId = await ctx.db.insert('clubApplications', {
		applicantProfileId,
		status: 'accepted',
		name: invite.clubName,
		description: invite.clubDescription,
		location: invite.clubLocation,
		locationLatitude: invite.clubLocationLatitude,
		locationLongitude: invite.clubLocationLongitude,
		createdClubId: clubId,
		decidedAt: now,
		decidedByProfileId: invite.invitedByProfileId,
		createdAt: now,
		updatedAt: now
	});
	await ensureClubApplicationRoom(ctx, applicationId);
	return { applicationId };
};

// CLI backfill for invites claimed before the support chat existed:
//   npx convex run clubLeaderInvites:backfillApplicationForAcceptedInvite \
//     '{"inviteId": "...", "supportGuideProfileId": "..."}' [--prod]
// Creates the accepted application + room for an already-claimed invite and optionally attaches
// a support guide (applicationSupportGuides) in the same call.
export const backfillApplicationForAcceptedInvite = internalMutation({
	args: {
		inviteId: v.id('clubLeaderInvites'),
		supportGuideProfileId: v.optional(v.id('profiles'))
	},
	handler: async (ctx, args) => {
		const invite = await ctx.db.get(args.inviteId);
		if (!invite) {
			throw new ConvexError('Invite not found');
		}
		if (!invite.acceptedAt || !invite.acceptedByProfileId || !invite.createdClubId) {
			throw new ConvexError('Invite has not been claimed yet');
		}

		const { applicationId } = await createAcceptedApplicationForInvite(
			ctx,
			invite,
			invite.acceptedByProfileId,
			invite.createdClubId
		);

		if (args.supportGuideProfileId) {
			const guideProfile = await ctx.db.get(args.supportGuideProfileId);
			if (!guideProfile) {
				throw new ConvexError('Support guide profile not found');
			}
			const existingGrant = await ctx.db
				.query('applicationSupportGuides')
				.withIndex('by_application_and_guide', (q) =>
					q.eq('applicationId', applicationId).eq('guideProfileId', args.supportGuideProfileId!)
				)
				.first();
			if (!existingGrant) {
				await ctx.db.insert('applicationSupportGuides', {
					applicationId,
					guideProfileId: args.supportGuideProfileId,
					addedByProfileId: invite.invitedByProfileId,
					createdAt: Date.now()
				});
			}
		}

		return { applicationId };
	}
});

// ---------------------------------------------------------------------------
// Email delivery.
// ---------------------------------------------------------------------------

// Failures are reported to monitoring inside sendEmail and swallowed here, matching
// adminInvites.sendAdminInviteEmail — the invite row is already recorded, so the admin can simply
// tell the invitee directly if the email bounces.
export const sendLeaderInviteEmail = internalAction({
	args: {
		email: v.string(),
		clubName: v.string(),
		inviterName: v.optional(v.string())
	},
	handler: async (_ctx, args) => {
		// Same base-URL source as parent-consent links (childSignup.ts); when unset the email
		// still works, it just omits the button.
		const baseUrl = (process.env.BETTER_AUTH_URL ?? process.env.PUBLIC_CONVEX_SITE_URL)?.trim();
		const signUpUrl = baseUrl ? `${baseUrl.replace(/\/+$/, '')}/auth/sign-up` : undefined;
		try {
			await sendEmail({
				to: args.email,
				type: 'club-leader-invite',
				...clubLeaderInviteEmail({
					clubName: args.clubName,
					inviterName: args.inviterName,
					signUpUrl,
					expiresInDays: LEADER_INVITE_TTL_DAYS
				})
			});
		} catch {
			// Already reported inside sendEmail.
		}
	}
});
