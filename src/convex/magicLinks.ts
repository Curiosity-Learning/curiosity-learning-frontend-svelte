import { v } from 'convex/values';
import { components, internal } from './_generated/api';
import { internalQuery } from './_generated/server';
import type { ActionCtx, MutationCtx } from './_generated/server';
import { getProfileByAuthUserId } from './permissions';
import { MAGIC_LINK_EXPIRES_IN_SECONDS, toMagicLinkCallbackParam } from '../lib/auth/magic-link';

// Server-side minting of Better Auth magic sign-in links, for emails WE send (parent chat emails,
// the consent page's "sign in" button) — the plugin's own POST /sign-in/magic-link would send a
// second email and needs an HTTP request, neither of which fits a mutation.
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
// - URL: `${baseURL}${basePath}/magic-link/verify?token=…&callbackURL=…&errorCallbackURL=…`.
// magicLinks.spec.ts asserts this row against the real component; if the plugin changes its
// storage or verify contract, that spec (and these links) must be updated together.

// Better Auth's default basePath; auth.ts does not override it and the SvelteKit app proxies
// /api/auth/* to the Convex site (src/routes/api/auth/[...all]).
const AUTH_BASE_PATH = '/api/auth';

const TOKEN_LENGTH = 32;
const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

const generateMagicLinkToken = () => {
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

const getAuthBaseUrl = () => {
	const baseUrl = process.env.BETTER_AUTH_URL?.trim();
	if (!baseUrl) return null;
	// Mirrors the plugin: a baseURL that already carries a path is used as-is, otherwise the
	// basePath is appended.
	const url = new URL(baseUrl);
	const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
	return `${url.origin}${pathname || AUTH_BASE_PATH}`;
};

// Who may sign in by email link at all (CL-768, review B1/S11). Shared by mintMagicLink and the
// plugin's sendMagicLink (auth.ts), so links WE mint and links the plugin emails follow one rule:
// - verified users only: the verify endpoint marks an unverified user verified on use, so a link
//   for one would both skip email verification and "verify" a row someone else may have
//   pre-registered (see childSignup.approveConsent);
// - never platform admins: an email link is a no-password door into a session, and admin
//   sessions are shared with the admin portal (AUTH_COOKIE_DOMAIN). Admins sign in with their
//   password or Google.
export const isMagicLinkRecipient = internalQuery({
	args: { authUserId: v.string(), emailVerified: v.boolean() },
	returns: v.boolean(),
	handler: async (ctx, args) => {
		if (!args.emailVerified) return false;
		const profile = await getProfileByAuthUserId(ctx, args.authUserId);
		return profile?.globalRole !== 'admin';
	}
});

/**
 * Mints a one-time sign-in link for an EXISTING, VERIFIED, non-admin Better Auth user (see
 * isMagicLinkRecipient). Returns null (the caller then falls back to a plain app link) when
 * BETTER_AUTH_URL is unset, no user has this email (the plugin runs with disableSignUp, so such a
 * link could only ever fail), or the user may not sign in by link.
 *
 * callbackURL / errorCallbackURL are app-relative paths (Better Auth only trusts relative paths
 * of a restricted shape; see lib/auth/magic-link.ts).
 *
 * Only call this where the recipient has proven they own `email`: the link IS a session.
 */
export const mintMagicLink = async (
	// Only the component calls are needed, so both mutations (chat, consent) and actions
	// (notifications.deliverNotificationEmail) can mint.
	ctx: Pick<MutationCtx, 'runQuery' | 'runMutation'> | Pick<ActionCtx, 'runQuery' | 'runMutation'>,
	args: { email: string; callbackURL: string; errorCallbackURL?: string }
): Promise<string | null> => {
	const authBaseUrl = getAuthBaseUrl();
	if (!authBaseUrl) return null;
	const email = args.email.trim().toLowerCase();
	const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: 'email', value: email }]
	})) as { _id: string; emailVerified?: boolean } | null;
	if (!user) return null;
	if (
		!(await ctx.runQuery(internal.magicLinks.isMagicLinkRecipient, {
			authUserId: user._id,
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
				expiresAt: now + MAGIC_LINK_EXPIRES_IN_SECONDS * 1000,
				createdAt: now,
				updatedAt: now
			}
		}
	});

	const url = new URL(`${authBaseUrl}/magic-link/verify`);
	url.searchParams.set('token', token);
	url.searchParams.set('callbackURL', toMagicLinkCallbackParam(args.callbackURL));
	if (args.errorCallbackURL) {
		url.searchParams.set('errorCallbackURL', toMagicLinkCallbackParam(args.errorCallbackURL));
	}
	return url.toString();
};
