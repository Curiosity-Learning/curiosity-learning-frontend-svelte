import { ConvexError, v } from 'convex/values';
import { internalAction, internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { internal } from './_generated/api';
import {
	getProfileByAuthUserId,
	isGlobalAdmin,
	requireGlobalAdmin,
	requireIdentity
} from './permissions';
import { getAuthUserEmailInfo, getAuthUserIdByEmail } from './authEmail';
import { sendEmail } from './email/resend';
import { adminInviteEmail } from './email/templates';

// ---------------------------------------------------------------------------
// Admin invites (PRD 5.10 follow-up).
//
// `profiles.globalRole = 'admin'` was originally CLI/ops-only (profiles.setGlobalRole). This
// module adds the one sanctioned self-serve path: an existing admin records an invite for an
// email address, and the invitee — after signing in with a *verified* Better Auth account whose
// email matches — claims it via `claimAdminInvite`. Design constraints, in order:
//
//   - No public mutation accepts a "make this user an admin" argument. `claimAdminInvite` takes
//     no input at all: it only ever grants to the caller, keyed off the caller's own verified
//     auth email, so it cannot be used to escalate anyone else.
//   - Every management endpoint (create/revoke/list/remove) requires an existing global admin.
//   - Invites expire (INVITE_TTL_MS) and are single-use; rows are kept forever as an audit
//     trail (who invited whom, who accepted, who revoked).
//   - Bootstrap (the very first admin, when nobody can call createInvite yet) goes through the
//     CLI-only `seedInvite` internal mutation:
//       npx convex run adminInvites:seedInvite '{"email": "person@example.com"}' [--prod]
//   - An admin cannot demote themselves (removeAdmin), so the platform can never reach zero
//     admins through this module.
// ---------------------------------------------------------------------------

export const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const INVITE_TTL_DAYS = 7;

const normalizeEmail = (email: string) => email.trim().toLowerCase();

// Light-touch shape check only — the invite is harmless if the address is undeliverable, and
// Better Auth is the authority on the address at claim time.
const isPlausibleEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const inviteStatus = (invite: Doc<'adminInvites'>, now: number) => {
	if (invite.acceptedAt) return 'accepted' as const;
	if (invite.revokedAt) return 'revoked' as const;
	if (invite.expiresAt <= now) return 'expired' as const;
	return 'pending' as const;
};

const getPendingInviteByEmail = async (ctx: QueryCtx | MutationCtx, email: string) => {
	const invites = await ctx.db
		.query('adminInvites')
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

// Shared create path for createInvite (admin-called) and seedInvite (CLI bootstrap).
const insertInvite = async (
	ctx: MutationCtx,
	args: { email: string; invitedByProfileId?: Doc<'profiles'>['_id'] }
) => {
	const email = normalizeEmail(args.email);
	if (!isPlausibleEmail(email)) {
		throw new ConvexError('That does not look like a valid email address');
	}

	const existingAuthUserId = await getAuthUserIdByEmail(ctx, email);
	if (existingAuthUserId) {
		const profile = await getProfileByAuthUserId(ctx, existingAuthUserId);
		if (profile?.globalRole === 'admin') {
			throw new ConvexError('That user is already an admin');
		}
	}

	if (await getPendingInviteByEmail(ctx, email)) {
		throw new ConvexError('There is already a pending invite for that email');
	}

	const now = Date.now();
	const inviteId = await ctx.db.insert('adminInvites', {
		email,
		invitedByProfileId: args.invitedByProfileId,
		createdAt: now,
		expiresAt: now + INVITE_TTL_MS
	});
	return { inviteId, email };
};

// ---------------------------------------------------------------------------
// Admin-facing management endpoints.
// ---------------------------------------------------------------------------

export const listAdmins = query({
	args: {},
	handler: async (ctx) => {
		await requireGlobalAdmin(ctx);
		// Collect-and-filter over profiles matches the admin.ts precedent; admins are a handful
		// of rows and this query is itself admin-only.
		const profiles = await ctx.db.query('profiles').collect();
		const admins = profiles.filter((profile) => profile.globalRole === 'admin');
		return await Promise.all(
			admins.map(async (profile) => ({
				profileId: profile._id,
				name: displayName(profile),
				username: profile.username ?? null,
				email: (await getAuthUserEmailInfo(ctx, profile.authUserId))?.email ?? null
			}))
		);
	}
});

export const listInvites = query({
	args: {},
	handler: async (ctx) => {
		await requireGlobalAdmin(ctx);
		const invites = await ctx.db.query('adminInvites').order('desc').collect();
		const now = Date.now();
		return await Promise.all(
			invites.map(async (invite) => ({
				inviteId: invite._id,
				email: invite.email,
				status: inviteStatus(invite, now),
				createdAt: invite.createdAt,
				expiresAt: invite.expiresAt,
				acceptedAt: invite.acceptedAt ?? null,
				invitedBy: invite.invitedByProfileId
					? displayName(await ctx.db.get(invite.invitedByProfileId))
					: null
			}))
		);
	}
});

export const createInvite = mutation({
	args: { email: v.string() },
	handler: async (ctx, args) => {
		const identity = await requireGlobalAdmin(ctx);
		const callerProfile = await getProfileByAuthUserId(ctx, identity.subject);
		if (!callerProfile) {
			throw new ConvexError('Profile not found');
		}

		const { inviteId, email } = await insertInvite(ctx, {
			email: args.email,
			invitedByProfileId: callerProfile._id
		});

		await ctx.scheduler.runAfter(0, internal.adminInvites.sendAdminInviteEmail, {
			email,
			inviterName: displayName(callerProfile) ?? undefined
		});

		return { inviteId };
	}
});

export const revokeInvite = mutation({
	args: { inviteId: v.id('adminInvites') },
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

export const removeAdmin = mutation({
	args: { profileId: v.id('profiles') },
	handler: async (ctx, args) => {
		const identity = await requireGlobalAdmin(ctx);
		const callerProfile = await getProfileByAuthUserId(ctx, identity.subject);
		if (!callerProfile) {
			throw new ConvexError('Profile not found');
		}
		// Self-demotion is forbidden so this module can never leave the platform with zero
		// admins: whoever is calling stays an admin.
		if (callerProfile._id === args.profileId) {
			throw new ConvexError('You cannot remove your own admin access');
		}
		const target = await ctx.db.get(args.profileId);
		if (!target || target.globalRole !== 'admin') {
			throw new ConvexError('That user is not an admin');
		}
		await ctx.db.patch(target._id, { globalRole: undefined, updatedAt: Date.now() });
		return null;
	}
});

// ---------------------------------------------------------------------------
// Claim path (called by the admin portal for any signed-in non-admin).
// ---------------------------------------------------------------------------

export const claimAdminInvite = mutation({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);

		if (await isGlobalAdmin(ctx, identity.subject)) {
			return { status: 'already_admin' as const };
		}

		const emailInfo = await getAuthUserEmailInfo(ctx, identity.subject);
		// requireEmailVerification blocks unverified email/password sign-ins and Google emails
		// arrive verified, so this is belt-and-braces — but admin grant is exactly where
		// belt-and-braces belongs.
		if (!emailInfo?.emailVerified) {
			return { status: 'no_invite' as const };
		}

		const invite = await getPendingInviteByEmail(ctx, normalizeEmail(emailInfo.email));
		if (!invite) {
			return { status: 'no_invite' as const };
		}

		const now = Date.now();
		// Admin accounts created directly on the admin portal never run the member app's
		// onboarding, so a profile row may not exist yet — create a minimal one
		// (auth.ensureProfile would backfill names/username if they ever use the member app).
		const existingProfile = await getProfileByAuthUserId(ctx, identity.subject);
		const profileId =
			existingProfile?._id ??
			(await ctx.db.insert('profiles', {
				authUserId: identity.subject,
				isVerified: true,
				firstLoginCompleted: false,
				updatedAt: now
			}));

		await ctx.db.patch(profileId, { globalRole: 'admin', updatedAt: now });
		await ctx.db.patch(invite._id, { acceptedAt: now, acceptedByProfileId: profileId });

		return { status: 'granted' as const };
	}
});

// ---------------------------------------------------------------------------
// Bootstrap + email delivery.
// ---------------------------------------------------------------------------

// CLI-only bootstrap for the very first admin on a deployment (nobody can call createInvite
// until at least one admin exists):
//   npx convex run adminInvites:seedInvite '{"email": "person@example.com"}' [--prod]
export const seedInvite = internalMutation({
	args: { email: v.string() },
	handler: async (ctx, args) => {
		const { inviteId, email } = await insertInvite(ctx, { email: args.email });
		return { inviteId, email, expiresInDays: INVITE_TTL_DAYS };
	}
});

// Failures are reported to monitoring inside sendEmail and swallowed here, matching
// notifications.sendNotificationEmail — the invite row is already recorded, so the admin can
// simply tell the invitee directly if the email bounces.
export const sendAdminInviteEmail = internalAction({
	args: {
		email: v.string(),
		inviterName: v.optional(v.string())
	},
	handler: async (_ctx, args) => {
		const adminPortalUrl = process.env.ADMIN_APP_ORIGIN?.trim() || undefined;
		try {
			await sendEmail({
				to: args.email,
				type: 'admin-invite',
				...adminInviteEmail({
					inviterName: args.inviterName,
					adminPortalUrl,
					expiresInDays: INVITE_TTL_DAYS
				})
			});
		} catch {
			// Already reported inside sendEmail.
		}
	}
});
