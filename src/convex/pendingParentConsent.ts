import { verifyPassword } from 'better-auth/crypto';
import { v } from 'convex/values';
import type { Infer } from 'convex/values';
import { components, internal } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { action, internalMutation, internalQuery } from './_generated/server';
import {
	createConsentToken,
	isValidParentEmail,
	normalizeEmail,
	parentConsentUrl,
	sendParentConsentEmail
} from './childSignup';
import { reportConvexError } from './monitoring';
import { getProfileByAuthUserId } from './permissions';
import { isRateLimited, recordRateLimitAttempt } from './rateLimiting';

/**
 * CL-772 (PRD 6.1.6 "resend option"): a child whose parent has not approved yet can see where
 * the approval email went, send it again, or send it to a different address.
 *
 * A pending child cannot sign in (no session until the parent approves), so these actions take
 * the child's username and password instead. They answer "invalid credentials" for an unknown
 * username and for a wrong password alike (with the same password-hash work), so they reveal no
 * more than the sign-in form does, and wrong passwords are capped per username.
 *
 * Changing the address gives the consent a new token: the link in the old email stops working
 * (the consent page shows "link not found"). The consent row, and with it the 90-day purge
 * clock (`createdAt`), stays the same. Nothing here looks up whether an address has an account,
 * and the answer is the same whichever address is given.
 *
 * Every send (resend or change) counts against two fixed windows: per consent (a few per hour,
 * so one inbox is not flooded) and per child (a daily cap across all addresses). Over a limit
 * nothing is sent or changed and the caller gets `rate_limited`, so the page can say so.
 */

export const PARENT_CONSENT_SEND_LIMIT_PER_CONSENT = { maxAttempts: 3, windowMs: 60 * 60 * 1000 };
export const PARENT_CONSENT_SEND_LIMIT_PER_CHILD = {
	maxAttempts: 6,
	windowMs: 24 * 60 * 60 * 1000
};
export const PARENT_CONSENT_PASSWORD_LIMIT = { maxAttempts: 10, windowMs: 15 * 60 * 1000 };

const consentSendKey = (consentId: string) => `parentConsentSend:consent:${consentId}`;
const childSendKey = (childProfileId: string) => `parentConsentSend:child:${childProfileId}`;
const passwordKey = (username: string) => `parentConsentPassword:${username}`;

// A real scrypt hash of a random throwaway password: unknown usernames still pay for one
// password check, so response time does not tell them apart from a wrong password.
const DUMMY_PASSWORD_HASH =
	'b1750d2ba532de6c1a8e8de5c9cfa3b3:6ce54c8e2348f4a0ac435a6dce1feaa5ac2af2d57a196c7f037c83120b67d43e2de00a9b707893d5a6a3dcafc342a5c575bde3d30fbf2815d30effc1b49176ca';

const normalizeUsername = (value: string) => value.trim().toLowerCase();

const credentialArgs = { username: v.string(), password: v.string() };

const resultValidator = v.union(
	v.object({ status: v.literal('invalid_credentials') }),
	v.object({ status: v.literal('too_many_attempts') }),
	v.object({ status: v.literal('not_pending') }),
	v.object({ status: v.literal('invalid_email') }),
	v.object({ status: v.literal('pending'), parentEmail: v.string() }),
	v.object({ status: v.literal('sent'), parentEmail: v.string() }),
	v.object({ status: v.literal('send_failed'), parentEmail: v.string() }),
	v.object({
		status: v.literal('rate_limited'),
		parentEmail: v.string(),
		retryAfter: v.union(v.literal('hour'), v.literal('day'))
	})
);
export type PendingParentConsentResult = Infer<typeof resultValidator>;

export const lookUpChildCredential = internalQuery({
	args: { username: v.string() },
	returns: v.object({
		passwordLimited: v.boolean(),
		credential: v.union(
			v.null(),
			v.object({ authUserId: v.string(), passwordHash: v.string() })
		)
	}),
	handler: async (ctx, args) => {
		const passwordLimited = await isRateLimited(
			ctx,
			passwordKey(args.username),
			PARENT_CONSENT_PASSWORD_LIMIT
		);
		if (passwordLimited || !/^[a-z0-9_]{3,30}$/.test(args.username)) {
			return { passwordLimited, credential: null };
		}
		const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'username', value: args.username }]
		})) as { _id: string } | null;
		if (!user) return { passwordLimited, credential: null };
		const account = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'account',
			where: [
				{ field: 'userId', value: user._id },
				{ field: 'providerId', value: 'credential' }
			]
		})) as { password?: string | null } | null;
		if (!account?.password) return { passwordLimited, credential: null };
		return {
			passwordLimited,
			credential: { authUserId: user._id, passwordHash: account.password }
		};
	}
});

export const recordFailedPasswordCheck = internalMutation({
	args: { username: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		await recordRateLimitAttempt(ctx, passwordKey(args.username), PARENT_CONSENT_PASSWORD_LIMIT);
		return null;
	}
});

const getPendingConsentForAuthUser = async (
	ctx: Parameters<typeof getProfileByAuthUserId>[0],
	authUserId: string
) => {
	const profile = await getProfileByAuthUserId(ctx, authUserId);
	if (!profile) return null;
	const consent = await ctx.db
		.query('parentChildConsents')
		.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', profile._id))
		.order('desc')
		.first();
	if (!consent || consent.status !== 'pending') return null;
	return { profile, consent };
};

export const getPendingConsentEmail = internalQuery({
	args: { authUserId: v.string() },
	returns: v.union(v.null(), v.string()),
	handler: async (ctx, args) => {
		const found = await getPendingConsentForAuthUser(ctx, args.authUserId);
		return found?.consent.parentEmail ?? null;
	}
});

/**
 * Checks both send limits and, when neither is hit, counts the send and (for a new address)
 * stores the address with a fresh token. Returns what the action needs to send the email.
 * Never throws on a counted path (rateLimiting.ts design note).
 */
export const prepareParentConsentSend = internalMutation({
	args: {
		authUserId: v.string(),
		newParentEmail: v.optional(v.string()),
		newToken: v.string()
	},
	returns: v.union(
		v.object({ status: v.literal('not_pending') }),
		v.object({
			status: v.literal('rate_limited'),
			parentEmail: v.string(),
			retryAfter: v.union(v.literal('hour'), v.literal('day'))
		}),
		v.object({
			status: v.literal('ready'),
			parentEmail: v.string(),
			token: v.string(),
			childUsername: v.string()
		})
	),
	handler: async (ctx, args) => {
		const found = await getPendingConsentForAuthUser(ctx, args.authUserId);
		if (!found) return { status: 'not_pending' as const };
		const { profile, consent } = found;

		if (await isRateLimited(ctx, childSendKey(profile._id), PARENT_CONSENT_SEND_LIMIT_PER_CHILD)) {
			return {
				status: 'rate_limited' as const,
				parentEmail: consent.parentEmail,
				retryAfter: 'day' as const
			};
		}
		if (await isRateLimited(ctx, consentSendKey(consent._id), PARENT_CONSENT_SEND_LIMIT_PER_CONSENT)) {
			return {
				status: 'rate_limited' as const,
				parentEmail: consent.parentEmail,
				retryAfter: 'hour' as const
			};
		}
		await recordRateLimitAttempt(
			ctx,
			childSendKey(profile._id),
			PARENT_CONSENT_SEND_LIMIT_PER_CHILD
		);
		await recordRateLimitAttempt(
			ctx,
			consentSendKey(consent._id),
			PARENT_CONSENT_SEND_LIMIT_PER_CONSENT
		);

		let { parentEmail, token } = consent;
		if (args.newParentEmail && args.newParentEmail !== consent.parentEmail) {
			parentEmail = args.newParentEmail;
			token = args.newToken;
			await ctx.db.patch(consent._id, { parentEmail, token, updatedAt: Date.now() });
		}
		return {
			status: 'ready' as const,
			parentEmail,
			token,
			childUsername: profile.username ?? ''
		};
	}
});

const verifyChildCredentials = async (
	ctx: ActionCtx,
	args: { username: string; password: string }
): Promise<{ status: 'invalid_credentials' | 'too_many_attempts' } | { authUserId: string }> => {
	const username = normalizeUsername(args.username);
	const { passwordLimited, credential } = await ctx.runQuery(
		internal.pendingParentConsent.lookUpChildCredential,
		{ username }
	);
	if (passwordLimited) return { status: 'too_many_attempts' };
	const passwordMatches = await verifyPassword({
		hash: credential?.passwordHash ?? DUMMY_PASSWORD_HASH,
		password: args.password
	});
	if (!credential || !passwordMatches) {
		await ctx.runMutation(internal.pendingParentConsent.recordFailedPasswordCheck, { username });
		return { status: 'invalid_credentials' };
	}
	return { authUserId: credential.authUserId };
};

const send = async (
	ctx: ActionCtx,
	args: { username: string; password: string; newParentEmail?: string }
): Promise<PendingParentConsentResult> => {
	const newParentEmail =
		args.newParentEmail === undefined ? undefined : normalizeEmail(args.newParentEmail);
	if (newParentEmail !== undefined && !isValidParentEmail(newParentEmail)) {
		return { status: 'invalid_email' };
	}
	const verified = await verifyChildCredentials(ctx, args);
	if ('status' in verified) return verified;

	const prepared = await ctx.runMutation(internal.pendingParentConsent.prepareParentConsentSend, {
		authUserId: verified.authUserId,
		newParentEmail,
		newToken: createConsentToken()
	});
	if (prepared.status !== 'ready') return prepared;
	try {
		await sendParentConsentEmail({
			parentEmail: prepared.parentEmail,
			childUsername: prepared.childUsername,
			consentUrl: parentConsentUrl(prepared.token)
		});
	} catch (error) {
		await reportConvexError(error, { area: 'auth', operation: 'child-signup:resend-consent' });
		return { status: 'send_failed', parentEmail: prepared.parentEmail };
	}
	return { status: 'sent', parentEmail: prepared.parentEmail };
};

/** Where the approval email went, for the child's "waiting for your parent" panel. */
export const getPendingParentConsent = action({
	args: credentialArgs,
	returns: resultValidator,
	handler: async (ctx, args): Promise<PendingParentConsentResult> => {
		const verified = await verifyChildCredentials(ctx, args);
		if ('status' in verified) return verified;
		const parentEmail = await ctx.runQuery(internal.pendingParentConsent.getPendingConsentEmail, {
			authUserId: verified.authUserId
		});
		return parentEmail === null ? { status: 'not_pending' } : { status: 'pending', parentEmail };
	}
});

/** Sends the approval email again, to the same address and with the same link. */
export const resendParentConsentEmail = action({
	args: credentialArgs,
	returns: resultValidator,
	handler: async (ctx, args): Promise<PendingParentConsentResult> => send(ctx, args)
});

/**
 * Sends the approval email to a different address. The old link stops working. The same
 * address as before is treated as a resend (the link stays).
 */
export const changeParentConsentEmail = action({
	args: { ...credentialArgs, parentEmail: v.string() },
	returns: resultValidator,
	handler: async (ctx, args): Promise<PendingParentConsentResult> =>
		send(ctx, { username: args.username, password: args.password, newParentEmail: args.parentEmail })
});
