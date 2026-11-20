import { ConvexError, v } from 'convex/values';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { httpAction, internalMutation, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { getAuthUserEmail } from './authEmail';
import { CHILD_EMAIL_DOMAIN } from './childAccounts';
import { requireIdentity, requireProfile } from './permissions';

// CL-770: unsubscribe for non-essential email (today only application reminders). Before this
// there was no unsubscribe of any kind. Ron's requirement: people who are no longer interested
// must be able to stop these without hunting through settings, so every such email carries
//
// - a footer link to /email/unsubscribe?t=… (a page with one confirm button: a plain GET never
//   unsubscribes, because mail scanners open links in advance), and
// - List-Unsubscribe / List-Unsubscribe-Post headers (RFC 8058) pointing at the POST endpoint
//   below, so Gmail and Outlook show their own one-click "Unsubscribe" button.
//
// The token is an HMAC over (kind, address): it needs no database row, never expires, and works
// without signing in — which matters because a parent whose consent is still pending has no
// account at all. Suppressions are keyed by address (emailSuppressions), not profile.

export type SuppressibleEmailKind = 'application_reminder';

const suppressibleKindValidator = v.literal('application_reminder');

const normalizeEmail = (email: string) => email.trim().toLowerCase();

// A dedicated secret when configured; otherwise Better Auth's, with a domain-separating prefix in
// the signed message so a token can never be mistaken for anything Better Auth signs.
const getSigningSecret = () =>
	process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim() || process.env.BETTER_AUTH_SECRET?.trim() || null;

export const canSignUnsubscribeTokens = () => getSigningSecret() !== null;

const toBase64Url = (bytes: Uint8Array) => {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (value: string) => {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const sign = async (secret: string, message: string) => {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
	return toBase64Url(new Uint8Array(signature));
};

const signedMessage = (kind: string, email: string) => `cl-unsubscribe:v1:${kind}:${email}`;

/** A token for (kind, address), or null when no signing secret is configured. */
export const createUnsubscribeToken = async (kind: SuppressibleEmailKind, email: string) => {
	const secret = getSigningSecret();
	if (!secret) return null;
	const address = normalizeEmail(email);
	const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({ k: kind, e: address })));
	return `${payload}.${await sign(secret, signedMessage(kind, address))}`;
};

/** The (kind, address) a token was issued for, or null when it is malformed or forged. */
export const verifyUnsubscribeToken = async (
	token: string
): Promise<{ kind: SuppressibleEmailKind; email: string } | null> => {
	const secret = getSigningSecret();
	if (!secret) return null;
	const [payload, signature, ...rest] = token.split('.');
	if (!payload || !signature || rest.length > 0) return null;
	let parsed: { k?: unknown; e?: unknown };
	try {
		parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
	} catch {
		return null;
	}
	if (parsed.k !== 'application_reminder' || typeof parsed.e !== 'string') return null;
	const expected = await sign(secret, signedMessage(parsed.k, parsed.e));
	// Constant-time comparison: the signature is the only secret-dependent input.
	if (expected.length !== signature.length) return null;
	let difference = 0;
	for (let index = 0; index < expected.length; index += 1) {
		difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
	}
	return difference === 0 ? { kind: parsed.k, email: parsed.e } : null;
};

const getAppOrigin = () => {
	const baseUrl = process.env.BETTER_AUTH_URL?.trim();
	return baseUrl ? new URL(baseUrl).origin : null;
};

/**
 * The footer link and the List-Unsubscribe headers for one email, or null when they cannot be
 * built (no signing secret or no app/site URL). Callers must not send a suppressible email
 * without them.
 */
export const buildUnsubscribeLinks = async (kind: SuppressibleEmailKind, email: string) => {
	const token = await createUnsubscribeToken(kind, email);
	const appOrigin = getAppOrigin();
	const siteUrl = process.env.CONVEX_SITE_URL?.trim();
	if (!token || !appOrigin || !siteUrl) return null;
	const encoded = encodeURIComponent(token);
	const oneClickUrl = `${siteUrl.replace(/\/+$/, '')}/email/unsubscribe?t=${encoded}`;
	return {
		pageUrl: `${appOrigin}/email/unsubscribe?t=${encoded}`,
		headers: {
			'List-Unsubscribe': `<${oneClickUrl}>`,
			'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
		}
	};
};

export const isEmailSuppressed = async (
	ctx: QueryCtx | MutationCtx,
	kind: SuppressibleEmailKind,
	email: string
) =>
	(await ctx.db
		.query('emailSuppressions')
		.withIndex('by_email_and_kind', (q) => q.eq('email', normalizeEmail(email)).eq('kind', kind))
		.first()) !== null;

const suppress = async (
	ctx: MutationCtx,
	args: { kind: SuppressibleEmailKind; email: string; source: 'link' | 'one_click' | 'settings' }
) => {
	if (await isEmailSuppressed(ctx, args.kind, args.email)) return;
	await ctx.db.insert('emailSuppressions', {
		email: normalizeEmail(args.email),
		kind: args.kind,
		source: args.source,
		createdAt: Date.now()
	});
};

const maskEmail = (email: string) => {
	const [local, domain] = email.split('@');
	if (!domain) return email;
	return `${local.slice(0, 1)}${'•'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
};

// The /email/unsubscribe page: what the link is for, before the person confirms. Public by
// design (the token is the credential); the address is masked so a forwarded link reveals little.
export const describeUnsubscribeToken = query({
	args: { token: v.string() },
	returns: v.union(
		v.object({
			kind: suppressibleKindValidator,
			maskedEmail: v.string(),
			alreadyUnsubscribed: v.boolean()
		}),
		v.null()
	),
	handler: async (ctx, args) => {
		const verified = await verifyUnsubscribeToken(args.token);
		if (!verified) return null;
		return {
			kind: verified.kind,
			maskedEmail: maskEmail(verified.email),
			alreadyUnsubscribed: await isEmailSuppressed(ctx, verified.kind, verified.email)
		};
	}
});

// The page's confirm button. Idempotent.
export const unsubscribe = mutation({
	args: { token: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		const verified = await verifyUnsubscribeToken(args.token);
		if (!verified) throw new ConvexError('This unsubscribe link is not valid.');
		await suppress(ctx, { ...verified, source: 'link' });
		return null;
	}
});

export const suppressFromOneClick = internalMutation({
	args: { kind: suppressibleKindValidator, email: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		await suppress(ctx, { ...args, source: 'one_click' });
		return null;
	}
});

// RFC 8058 one-click endpoint (the List-Unsubscribe header). Mail providers POST here with the
// body "List-Unsubscribe=One-Click"; only POST unsubscribes.
export const oneClickUnsubscribe = httpAction(async (ctx, request) => {
	const token = new URL(request.url).searchParams.get('t');
	const verified = token ? await verifyUnsubscribeToken(token) : null;
	if (!verified) return new Response('Invalid unsubscribe link', { status: 400 });
	await ctx.runMutation(internal.emailUnsubscribe.suppressFromOneClick, verified);
	return new Response('Unsubscribed', { status: 200 });
});

// ---------------------------------------------------------------------------------------------
// CL-796: the "Application reminders" switch on the settings page. It reads and writes the same
// per-address suppression as the unsubscribe link, so the two always agree: unsubscribing from
// an email turns the switch off, and turning the switch back on lifts the unsubscribe.
// ---------------------------------------------------------------------------------------------

// The address the signed-in person gets reminders at: their sign-in email, or for a child account
// (no real sign-in address) the notification address they confirmed. Null when there is none.
const getMyReminderAddress = async (ctx: QueryCtx | MutationCtx) => {
	const identity = await requireIdentity(ctx);
	const profile = await requireProfile(ctx, identity.subject);
	const authEmail = await getAuthUserEmail(ctx, profile.authUserId);
	if (authEmail && !authEmail.toLowerCase().endsWith(`@${CHILD_EMAIL_DOMAIN}`)) {
		return normalizeEmail(authEmail);
	}
	if (profile.notificationEmail && profile.notificationEmailVerifiedAt !== undefined) {
		return normalizeEmail(profile.notificationEmail);
	}
	return null;
};

export const getMyApplicationReminders = query({
	args: {},
	returns: v.union(v.object({ email: v.string(), enabled: v.boolean() }), v.null()),
	handler: async (ctx) => {
		const email = await getMyReminderAddress(ctx);
		if (!email) return null;
		return { email, enabled: !(await isEmailSuppressed(ctx, 'application_reminder', email)) };
	}
});

export const setMyApplicationReminders = mutation({
	args: { enabled: v.boolean() },
	returns: v.null(),
	handler: async (ctx, args) => {
		const email = await getMyReminderAddress(ctx);
		if (!email) throw new ConvexError('There is no email address to send reminders to.');
		if (!args.enabled) {
			await suppress(ctx, { kind: 'application_reminder', email, source: 'settings' });
			return null;
		}
		const rows = await ctx.db
			.query('emailSuppressions')
			.withIndex('by_email_and_kind', (q) =>
				q.eq('email', email).eq('kind', 'application_reminder')
			)
			.collect();
		for (const row of rows) await ctx.db.delete(row._id);
		return null;
	}
});
