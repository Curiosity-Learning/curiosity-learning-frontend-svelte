import { v } from 'convex/values';
import { components, internal } from './_generated/api';
import { internalMutation, internalQuery } from './_generated/server';
import type { ActionCtx, MutationCtx } from './_generated/server';
import { CHILD_EMAIL_DOMAIN } from './childAccounts';
import { getProfileByAuthUserId } from './permissions';
import {
	MAGIC_LINK_INTERSTITIAL_PATH,
	buildMagicLinkInterstitialFragment,
	isMagicLinkCallbackPath,
	maskEmail
} from '../lib/auth/magic-link';

// Server-side minting of Better Auth magic sign-in links, for emails WE send (parent chat and
// notification emails, minted in the send ACTION right before sendEmail so no plaintext token
// sits in scheduler args — review S2) and the consent page's "sign in" button (minted in the
// approveConsent mutation, see there) — the plugin's own POST /sign-in/magic-link would send a
// second email and needs an HTTP request, neither of which fits.
//
// Randomness: tokens come from crypto.getRandomValues. In Convex queries/mutations that is NOT
// the OS CSPRNG — the runtime refuses "cryptographic randomness" in UDFs and backs
// getRandomValues with a ChaCha12 stream cipher RNG seeded with a fresh 32-byte seed per
// execution (convex-backend crates/isolate: ops/crypto.rs uses provider.rng(),
// environment/udf/phase.rs ChaCha12Rng::from_seed(rng_seed)). ChaCha12 is a cryptographically
// strong generator, and the seed is per execution, so tokens are unpredictable to callers; the
// residual difference from an action is that the seed is part of the backend's execution record
// (that is what makes mutations deterministic and retryable). Actions get real OS randomness, so
// every email mints in its action; only the consent screen mints in a mutation. Never mint at
// module scope: the import-phase seed is fixed per deployment.
//
// KEEP IN SYNC ON BETTER AUTH UPGRADES. This writes the `verification` row exactly the way the
// magic-link plugin's sign-in endpoint does and builds the URL its verify endpoint reads
// (better-auth/dist/plugins/magic-link/index.mjs, checked against better-auth 1.4.9):
// - token: 32 random letters (generateRandomString(32, 'a-z', 'A-Z'));
// - identifier: storeToken(token) — with `storeToken: 'hashed'` (set in auth.ts) that is
//   defaultKeyHasher: base64url(SHA-256(token)) without padding (magic-link/utils.mjs);
// - value: JSON.stringify({ email }) — verify parses { email, name } and signs in the user found
//   by findUserByEmail(email) (lowercased); with `disableSignUp` an unknown email fails;
// - expiresAt: now + expiresIn seconds;
// - URL: `${basePath}/magic-link/verify?token=…&callbackURL=…&errorCallbackURL=…` — built in the
//   browser by the /auth/link interstitial (lib/auth/magic-link.ts buildMagicLinkVerifyPath);
//   what we hand out is `${appOrigin}/auth/link#t=…&next=…&as=…`.
// magicLinks.spec.ts asserts this row against the real component; if the plugin changes its
// storage or verify contract, that spec (and these links) must be updated together.

const TOKEN_LENGTH = 32;
const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const generateMagicLinkToken = () => {
	// Rejection sampling keeps the letters uniform: 208 = 4 * 52 is the largest multiple of the
	// alphabet size that fits in a byte.
	const limit = 256 - (256 % TOKEN_ALPHABET.length);
	let token = '';
	while (token.length < TOKEN_LENGTH) {
		for (const byte of crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH * 2))) {
			if (byte < limit && token.length < TOKEN_LENGTH) {
				token += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
			}
		}
	}
	return token;
};

// Same output as better-auth's magic-link defaultKeyHasher.
export const hashMagicLinkToken = async (token: string) => {
	const digest = new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
	);
	let binary = '';
	for (const byte of digest) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

// The app origin the interstitial lives on (BETTER_AUTH_URL is the member app's URL; its
// /api/auth proxy reaches Better Auth).
const getAppOrigin = () => {
	const baseUrl = process.env.BETTER_AUTH_URL?.trim();
	if (!baseUrl) return null;
	return new URL(baseUrl).origin;
};

// Turns a token into the link we hand out: the /auth/link interstitial with everything in the
// fragment. Also used for the plugin's own emailed links (auth.ts sendMagicLink).
export const buildMagicLinkInterstitialUrl = (
	appOrigin: string,
	link: { token: string; next: string; email: string }
) =>
	`${appOrigin}${MAGIC_LINK_INTERSTITIAL_PATH}#${buildMagicLinkInterstitialFragment({
		token: link.token,
		next: link.next,
		as: maskEmail(link.email)
	})}`;

// Who may sign in by email link at all (CL-768, review B1/S11). Shared by mintMagicLink and the
// plugin's sendMagicLink (auth.ts), so links WE mint and links the plugin emails follow one rule:
// - verified users only: the verify endpoint marks an unverified user verified on use, so a link
//   for one would both skip email verification and "verify" a row someone else may have
//   pre-registered (see childSignup.approveConsent);
// - never platform admins: an email link is a no-password door into a session, and admin
//   sessions are shared with the admin portal (AUTH_COOKIE_DOMAIN). Admins sign in with their
//   password or Google;
// - never child accounts: their synthetic auth email is not an inbox (sendEmail refuses it).
export const isMagicLinkRecipient = internalQuery({
	args: { authUserId: v.string(), email: v.string(), emailVerified: v.boolean() },
	returns: v.boolean(),
	handler: async (ctx, args) => {
		if (!args.emailVerified) return false;
		if (args.email.trim().toLowerCase().endsWith(`@${CHILD_EMAIL_DOMAIN}`)) return false;
		const profile = await getProfileByAuthUserId(ctx, args.authUserId);
		return profile?.globalRole !== 'admin';
	}
});

/**
 * Mints a one-time sign-in link for an EXISTING, VERIFIED, non-admin Better Auth user (see
 * isMagicLinkRecipient) and returns the /auth/link interstitial URL for it. Returns null (the
 * caller then falls back to a plain app link) when BETTER_AUTH_URL is unset, no user has this
 * email (the plugin runs with disableSignUp, so such a link could only ever fail), or the user
 * may not sign in by link.
 *
 * callbackPath is an app-relative path of the restricted shape Better Auth trusts (see
 * lib/auth/magic-link.ts); a failed or expired link lands on the sign-in page with it as `next`.
 * expiresInSeconds: one of the per-use lifetimes in lib/auth/magic-link.ts.
 *
 * Only call this where the recipient has proven they own `email`: the link IS a session.
 */
export const mintMagicLink = async (
	// Only the component calls are needed, so both the consent mutation and the send actions can
	// mint.
	ctx: Pick<MutationCtx, 'runQuery' | 'runMutation'> | Pick<ActionCtx, 'runQuery' | 'runMutation'>,
	args: { email: string; callbackPath: string; expiresInSeconds: number }
): Promise<string | null> => {
	const appOrigin = getAppOrigin();
	if (!appOrigin) return null;
	// The verify endpoint would 403 such a link; the plain-link fallback is the better failure.
	if (!isMagicLinkCallbackPath(args.callbackPath)) return null;
	const email = args.email.trim().toLowerCase();
	const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: 'email', value: email }]
	})) as { _id: string; emailVerified?: boolean } | null;
	if (!user) return null;
	if (
		!(await ctx.runQuery(internal.magicLinks.isMagicLinkRecipient, {
			authUserId: user._id,
			email,
			emailVerified: user.emailVerified === true
		}))
	) {
		return null;
	}

	const token = generateMagicLinkToken();
	const now = Date.now();
	await ctx.runMutation(components.betterAuth.adapter.create, {
		input: {
			model: 'verification',
			data: {
				identifier: await hashMagicLinkToken(token),
				value: JSON.stringify({ email }),
				expiresAt: now + args.expiresInSeconds * 1000,
				createdAt: now,
				updatedAt: now
			}
		}
	});

	return buildMagicLinkInterstitialUrl(appOrigin, { token, next: args.callbackPath, email });
};

// For the plugin's own emailed links (auth.ts sendMagicLink): the plugin hands us its verify URL;
// re-point it at the interstitial like every other emailed link. The plugin's callbackURL is our
// toMagicLinkCallbackParam(path), query-encoded; null when the URL is not the shape we expect
// (the caller then sends the plugin's URL unchanged rather than nothing).
export const pluginVerifyUrlToInterstitial = (verifyUrl: string, email: string) => {
	const appOrigin = getAppOrigin();
	if (!appOrigin) return null;
	try {
		const url = new URL(verifyUrl);
		const token = url.searchParams.get('token');
		const callback = url.searchParams.get('callbackURL');
		if (!token) return null;
		const next = callback ? decodeURIComponent(callback) : '/';
		if (!isMagicLinkCallbackPath(next)) return null;
		return buildMagicLinkInterstitialUrl(appOrigin, { token, next, email });
	} catch {
		return null;
	}
};

// Daily cleanup (crons.ts runDailyMaintenance) of expired Better Auth `verification` rows: minted
// sign-in links are only deleted when used or when an expired one is clicked, so unclicked ones
// would pile up. Covers every expired verification row (OTP codes, reset tokens too) — none can
// ever be used again. Deletes at most one page per call through the component adapter's
// paginated deleteMany (on its expiresAt index); the cron calls again while `hasMore`.
const EXPIRED_VERIFICATION_PAGE_SIZE = 200;

export const deleteExpiredVerifications = internalMutation({
	args: {},
	returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
	handler: async (ctx) => {
		const result: { count: number; isDone: boolean } = await ctx.runMutation(
			components.betterAuth.adapter.deleteMany,
			{
				input: {
					model: 'verification',
					where: [{ field: 'expiresAt', operator: 'lt', value: Date.now() }]
				},
				paginationOpts: { cursor: null, numItems: EXPIRED_VERIFICATION_PAGE_SIZE }
			}
		);
		return { deleted: result.count, hasMore: !result.isDone };
	}
});
