import { betterAuth } from 'better-auth';
import { emailOTP, magicLink, username } from 'better-auth/plugins';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { createClient } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import type { GenericCtx } from '@convex-dev/better-auth';
import type { GenericActionCtx, GenericDataModel } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { components, internal } from './_generated/api';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import authConfig from './auth.config';
import { sendEmail } from './email/resend';
import { magicLinkEmail, passwordResetEmail, verificationOtpEmail } from './email/templates';
import { SELF_SERVICE_MAGIC_LINK_SECONDS } from '../lib/auth/magic-link';
import { pluginVerifyUrlToInterstitial } from './magicLinks';
import { CHILD_EMAIL_DOMAIN } from './childAccounts';
import { assertDateOfBirthChangeAllowed, isSyntheticChildEmail } from './notificationRouting';
import { getProfileAuthUserId, getProfileByAuthUserId, requireIdentity } from './permissions';
import { setPendingClubJoin } from './pendingClubJoinsModel';
import { MAX_USERNAME_LENGTH, sanitizeUsernameFromEmail } from './usernameValidator';
import { autoCreateJoinRequestFromNextPath } from './joinRequests';
import { isRateLimited, recordRateLimitAttempt } from './rateLimiting';

export const authComponent = createClient(components.betterAuth);

const trustedOrigins = [
	process.env.BETTER_AUTH_URL,
	process.env.PUBLIC_CONVEX_SITE_URL,
	// Local dev / preview ports.
	'http://localhost:5173',
	'http://localhost:4173',
	// Admin app dev origin (curiosity-learning-admin, separate repo, CEO admin-split decision).
	'http://localhost:4174',
	// Admin app deployed origin (e.g. https://admin.curiositylearning.org) — set per deployment
	// as a Convex env var; unset in environments without a deployed admin portal.
	process.env.ADMIN_APP_ORIGIN,
	// ngrok tunnel for external device testing.
	'https://arrased-semiurban-jean.ngrok-free.dev'
].filter((value): value is string => Boolean(value));

// Optional: allow LAN/loopback origins for local development.
// This weakens CSRF origin protections and should not be enabled in production.
if (process.env.ALLOW_LAN_TRUSTED_ORIGINS === 'true') {
	trustedOrigins.push(
		'localhost:*',
		'127.0.0.1:*',
		// Better Auth supports wildcard origin patterns; without a scheme we match the host (including port).
		'10.*',
		'192.168.*',
		'172.*',
		'*.local:*'
	);
}

const readEnv = (...keys: string[]) => {
	for (const key of keys) {
		const value = process.env[key]?.trim();
		if (value) {
			return value;
		}
	}
	return undefined;
};

const googleClientId = readEnv('GOOGLE_CLIENT_ID', 'AUTH_GOOGLE_ID');
const googleClientSecret = readEnv('GOOGLE_CLIENT_SECRET', 'AUTH_GOOGLE_SECRET');
const socialProviders =
	googleClientId && googleClientSecret
		? {
				google: {
					clientId: googleClientId,
					clientSecret: googleClientSecret,
					disableImplicitSignUp: true
				}
			}
		: undefined;

// Share auth cookies across sibling subdomains (admin split): Google OAuth started on the admin
// portal sets better-auth's signed state cookie via the admin origin's /api/auth proxy, but
// Google always calls back on BETTER_AUTH_URL's origin (the member app), which cannot see a
// host-only admin cookie — every admin OAuth attempt then dies with state_mismatch on the member
// app's /api/auth/error page, and even a successful callback would set the session cookie on the
// wrong origin. Set AUTH_COOKIE_DOMAIN (e.g. ".curiositylearning.org") only in deployments where
// both apps are subdomains of it; leave unset elsewhere — localhost dev needs nothing because
// cookies ignore ports, so 4174 and 5173 already share them.
const authCookieDomain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;

const REMEMBERED_SESSION_SECONDS = 60 * 60 * 24 * 30;

// CL-769 (review S4): a session created by a one-time sign-in link lasts 7 days, not 30. Such
// links are mostly pressed by parents on whatever device the email was opened on — often the
// family computer — and a leftover parent session there lets the child act as their parent.
// Applied by the session databaseHooks below. The session row is its own marker: a session whose
// lifetime (expiresAt - createdAt) is at most this long is a short session and stays capped at
// createdAt + 7 days. The cap matters as much as the shorter start: Better Auth's getSession
// "refreshes" any session whose expiresAt is within (expiresIn - updateAge) of now back to the
// full 30 days, which for a 7-day session is true on the very first request. (Sessions created
// with "don't remember me" are 1 day and never refreshed, so the cap never touches them.)
export const SIGN_IN_LINK_SESSION_SECONDS = 60 * 60 * 24 * 7;
const SIGN_IN_LINK_SESSION_MS = SIGN_IN_LINK_SESSION_SECONDS * 1000;
// Clock slack between createdAt and expiresAt being computed in createSession.
const SHORT_SESSION_SLACK_MS = 60 * 1000;
const toMs = (value: Date | string | number) => new Date(value).getTime();

const splitNameParts = (name?: string | null) => {
	if (!name) {
		return { firstName: undefined, lastName: undefined };
	}
	const normalized = name.trim();
	if (!normalized) {
		return { firstName: undefined, lastName: undefined };
	}
	const [first, ...rest] = normalized.split(/\s+/);
	const last = rest.join(' ').trim();
	return {
		firstName: first || undefined,
		lastName: last || undefined
	};
};

const normalizeUsername = (value?: string | null) => {
	const normalized = value?.trim().toLowerCase() ?? '';
	return normalized.length > 0 ? normalized : undefined;
};

// Mirrors clubs.ts resolveUniqueUsername: suffixes an email-derived username until it is free of
// conflicts, keeping candidates within MAX_USERNAME_LENGTH. Returns undefined when 2–99 are all
// taken; callers then leave the username for the user to pick in post-signup.
const findAvailableUsernameVariant = async (
	ctx: MutationCtx,
	authUserId: string,
	base: string
): Promise<string | undefined> => {
	for (let suffix = 2; suffix <= 99; suffix += 1) {
		const suffixText = String(suffix);
		const candidate = `${base.slice(0, MAX_USERNAME_LENGTH - suffixText.length)}${suffixText}`;
		const match = await ctx.db
			.query('profiles')
			.withIndex('by_username', (q) => q.eq('username', candidate))
			.first();
		if (!match || getProfileAuthUserId(match) === authUserId) {
			return candidate;
		}
	}
	return undefined;
};

// PRD 5.6: extracts a pending code-join intent from the post-auth `next` redirect path. Resolved
// to a clubId and recorded in the `pendingClubJoins` table (see pendingClubJoinsModel.ts) once the
// caller has a profileId to key off of — this only parses the code out of the URL.
const extractPendingJoinCode = (nextPath?: string | null): string | undefined => {
	if (!nextPath) {
		return undefined;
	}

	const joinPrefix = '/onboarding/join-club/';
	if (nextPath.startsWith(joinPrefix)) {
		const rawCode = nextPath.slice(joinPrefix.length).split(/[/?#]/)[0] ?? '';
		const code = rawCode.trim().toUpperCase();
		if (/^[A-Z0-9]{6}$/.test(code)) {
			return code;
		}
	}

	return undefined;
};

// A `credential` account row is what makes a password sign-in possible (Better Auth's password
// reset creates it when it is missing).
const hasPasswordAccount = async (
	ctx: { runQuery: GenericActionCtx<GenericDataModel>['runQuery'] },
	authUserId: string
) => {
	const accounts = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
		model: 'account',
		where: [{ field: 'userId', value: authUserId }],
		paginationOpts: { cursor: null, numItems: 20 }
	})) as { page: Array<{ providerId: string }> };
	return accounts.page.some((account) => account.providerId === 'credential');
};

// CL-775: a username never becomes an email address in the browser. "Forgot password?" and
// "Resend verification" accept a username: the browser sends it as `email` and this hook swaps in
// the account's address on the server. Both endpoints already answer the same whether or not an
// address has an account. An unknown or malformed username is swapped for an address that can
// never exist (`.invalid` is reserved, RFC 2606), so the endpoint gives exactly that same answer
// and sends nothing. (Answering from the hook instead would echo the request's headers, including
// its Content-Length, onto the response and cut the body short.) Usernames follow the username
// plugin's rules below (lowercase a-z, 0-9, _).
const USERNAME_AS_EMAIL_PATHS = new Set(['/request-password-reset', '/send-verification-email']);
const UNKNOWN_USERNAME_EMAIL = 'unknown-username@username.invalid';

// CL-775: the sign-in page's "a parent needs to approve this account" message. A child account
// is unverified until its parent consents (childSignup.approveConsent verifies it), and the
// username plugin answers FORBIDDEN (email not verified) only after the password matched. So
// this code reaches only someone who knows the child's password; the old public lookup told
// anyone whether a username existed and whether its consent was pending.
export const PARENT_CONSENT_PENDING_CODE = 'PARENT_CONSENT_PENDING';

const normalizeUsernameIdentifier = (value: unknown) =>
	typeof value === 'string' ? value.trim().toLowerCase() : '';

const authHooks = {
	before: createAuthMiddleware(async (ctx) => {
		if (!USERNAME_AS_EMAIL_PATHS.has(ctx.path)) return;
		const body = (ctx.body ?? {}) as Record<string, unknown>;
		const identifier = normalizeUsernameIdentifier(body.email);
		if (!identifier || identifier.includes('@')) return;
		const user = /^[a-z0-9_]+$/.test(identifier)
			? await ctx.context.adapter.findOne<{ email: string }>({
					model: 'user',
					where: [{ field: 'username', value: identifier }]
				})
			: null;
		return { context: { body: { ...body, email: user?.email ?? UNKNOWN_USERNAME_EMAIL } } };
	}),
	after: createAuthMiddleware(async (ctx) => {
		if (ctx.path !== '/sign-in/username') return;
		// An APIError; compared by its status so a second copy of better-call cannot break it.
		const returned = ctx.context.returned as { status?: unknown } | undefined;
		if (returned?.status !== 'FORBIDDEN') return;
		const identifier = normalizeUsernameIdentifier((ctx.body as { username?: unknown })?.username);
		if (!identifier) return;
		const user = await ctx.context.adapter.findOne<{ email: string; emailVerified?: boolean }>({
			model: 'user',
			where: [{ field: 'username', value: identifier }]
		});
		if (!user || user.emailVerified === true || !isSyntheticChildEmail(user.email)) return;
		throw new APIError('FORBIDDEN', {
			message: 'A parent or guardian needs to approve this account first',
			code: PARENT_CONSENT_PENDING_CODE
		});
	})
};

export const createAuth = (ctx: GenericCtx<GenericDataModel>) =>
	betterAuth({
		baseURL: process.env.BETTER_AUTH_URL,
		database: authComponent.adapter(ctx),
		session: {
			expiresIn: REMEMBERED_SESSION_SECONDS
		},
		hooks: authHooks,
		databaseHooks: {
			session: {
				create: {
					// `context` is the endpoint context of the request creating the session (Better
					// Auth keeps it in AsyncLocalStorage for every API call); only the magic-link verify
					// endpoint gets the short lifetime.
					before: async (session, context) => {
						if (context?.path !== '/magic-link/verify') return;
						return {
							data: { ...session, expiresAt: new Date(Date.now() + SIGN_IN_LINK_SESSION_MS) }
						};
					}
				},
				update: {
					// getSession has already loaded the session it refreshes into
					// context.context.session; a short one never moves past createdAt + 7 days.
					before: async (update, context) => {
						if (!update.expiresAt) return;
						const current = context?.context.session?.session;
						if (!current) return;
						const createdAt = toMs(current.createdAt);
						if (
							toMs(current.expiresAt) - createdAt >
							SIGN_IN_LINK_SESSION_MS + SHORT_SESSION_SLACK_MS
						)
							return;
						const cap = createdAt + SIGN_IN_LINK_SESSION_MS;
						if (toMs(update.expiresAt) <= cap) return;
						return { data: { ...update, expiresAt: new Date(cap) } };
					}
				}
			}
		},
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: true,
			sendResetPassword: async ({ user, url, token }) => {
				// A child's auth email is synthetic, not an inbox (sendEmail refuses it): answer the
				// request like any other instead of failing it, so the endpoint does not reveal
				// which usernames are child accounts. Children have no self-service reset yet.
				if (user.email.toLowerCase().endsWith(`@${CHILD_EMAIL_DOMAIN}`)) return;
				// An account without a password (a parent created at consent approval) is setting
				// one, not resetting it: the email says so (CL-807). Undefined when we cannot tell.
				const hasPassword = 'runQuery' in ctx ? await hasPasswordAccount(ctx, user.id) : undefined;
				await sendEmail({
					type: 'password-reset',
					to: user.email,
					...passwordResetEmail({ url, token, hasPassword })
				});
			}
		},
		emailVerification: {
			sendOnSignUp: true,
			sendOnSignIn: true,
			autoSignInAfterVerification: true
		},
		socialProviders,
		...(authCookieDomain
			? {
					advanced: {
						crossSubDomainCookies: {
							enabled: true,
							domain: authCookieDomain
						}
					}
				}
			: {}),
		plugins: [
			emailOTP({
				otpLength: 6,
				expiresIn: 300,
				overrideDefaultEmailVerification: true,
				sendVerificationOTP: async ({ email, otp, type }) => {
					await sendEmail({
						type: 'verification-otp',
						to: email,
						...verificationOtpEmail({ otp, type })
					});
				}
			}),
			// One-time sign-in links. Parent-facing emails carry links minted server-side by
			// magicLinks.mintMagicLink, which writes the plugin's verification rows directly — keep
			// `storeToken` in sync with it (it picks its own per-use lifetime). The plugin's own
			// POST /sign-in/magic-link is the "send me a new link" fallback on the sign-in page;
			// `expiresIn` applies to those links only.
			magicLink({
				expiresIn: SELF_SERVICE_MAGIC_LINK_SECONDS,
				// Links only sign in existing users; account creation keeps its own flows.
				disableSignUp: true,
				// Hashed at rest: a link stays valid for days, so a leaked verification table
				// must not hand out sessions.
				storeToken: 'hashed',
				sendMagicLink: async ({ email, url }, endpointCtx) => {
					// disableSignUp makes a link for an unknown address useless; don't email strangers
					// (the endpoint answers the same either way, so nothing is revealed). Same rule as
					// minted links (magicLinks.isMagicLinkRecipient, CL-768): unverified users and
					// platform admins get no link either — silently, for the same reason.
					if (!endpointCtx) return;
					const found = await endpointCtx.context.internalAdapter.findUserByEmail(email);
					if (!found) return;
					if (
						!('runQuery' in ctx) ||
						!(await ctx.runQuery(internal.magicLinks.isMagicLinkRecipient, {
							authUserId: found.user.id,
							email: found.user.email,
							emailVerified: found.user.emailVerified === true
						}))
					) {
						return;
					}
					// Per-address cap (5 per hour), since Better Auth's IP-based limiter is not in
					// effect here (docs/security.md, "Rate limits"). Silent, like the guards above.
					if (
						!('runMutation' in ctx) ||
						!(await ctx.runMutation(internal.magicLinks.consumeSelfServiceMagicLinkAllowance, {
							email: found.user.email
						}))
					) {
						return;
					}
					// Like every emailed link, through the /auth/link interstitial (review S1), so a
					// mail scanner's GET does not consume the token.
					await sendEmail({
						type: 'magic-link',
						to: email,
						...magicLinkEmail({ url: pluginVerifyUrlToInterstitial(url, email) ?? url })
					});
				}
			}),
			username({
				minUsernameLength: 3,
				maxUsernameLength: 30,
				usernameNormalization: (value) => value.trim().toLowerCase(),
				usernameValidator: (value) => /^[a-z0-9_]+$/.test(value)
			}),
			convex({ authConfig })
		],
		trustedOrigins
	});

export const getCurrentUser = query({
	args: {},
	handler: async (ctx) => {
		return await authComponent.safeGetAuthUser(ctx as unknown as GenericCtx<GenericDataModel>);
	}
});

export const getViewerIdentity = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		return { userId: identity.subject };
	}
});

/**
 * The CALLER's own sign-in methods, for Settings' "Set a password" card (review S8/D8). Parent
 * accounts are created password-less at consent approval and sign in with emailed links; this
 * lets Settings offer to set a password without the unauthenticated by-email lookup below.
 * `hasPassword` is a `credential` account row (what Better Auth's password reset creates when it
 * is missing). `isChildAccount` lets Settings never offer it to a child: their auth email is
 * synthetic and cannot receive a reset link.
 */
export const getMySignInMethods = query({
	args: {},
	returns: v.object({
		hasPassword: v.boolean(),
		hasGoogle: v.boolean(),
		isChildAccount: v.boolean()
	}),
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const authUser = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: '_id', value: identity.subject }]
		})) as { _id: string; email: string } | null;
		const isChildAccount = Boolean(
			authUser?.email.toLowerCase().endsWith(`@${CHILD_EMAIL_DOMAIN}`)
		);
		if (!authUser) return { hasPassword: false, hasGoogle: false, isChildAccount };
		const accounts = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'account',
			where: [{ field: 'userId', value: authUser._id }],
			paginationOpts: { cursor: null, numItems: 20 }
		})) as { page: Array<{ providerId: string }> };
		return {
			hasPassword: accounts.page.some((account) => account.providerId === 'credential'),
			hasGoogle: accounts.page.some((account) => account.providerId === 'google'),
			isChildAccount
		};
	}
});

// CL-775: the sign-up page's "this email already has an account" lookup. Anyone can call it,
// so it says no more than sign-up needs, and is rate-limited.
// - Sign-up has to say "this address already has an account" (Better Auth's own sign-up endpoint
//   says so too), whether to send a verification code, where to continue after signing in, and
//   whether to send the visitor to Google.
// - It does not say whether an account has a password: password-only and password-less (sign-in
//   link only, i.e. every parent created at consent approval) look the same. The sign-in page
//   offers "Email me a sign-in link" for any address instead of only for password-less ones.
// - A child's synthetic address is never reported as an account, and nothing here returns an
//   email address, username or id.
// - A mutation, not a query, so it can count calls: there is no client IP in a Convex function,
//   so the cap is global. Over the cap the answer is "no account" and sign-up carries on; Better
//   Auth's sign-up endpoint then catches the existing account (the page sends a verification
//   code or says to sign in instead).
export const SIGNUP_EMAIL_LOOKUP_RATE_LIMIT = { maxAttempts: 60, windowMs: 10 * 60 * 1000 };
const SIGNUP_EMAIL_LOOKUP_RATE_LIMIT_KEY = 'signupEmailLookup';

const signupEmailStatusValidator = v.object({
	exists: v.boolean(),
	isVerified: v.boolean(),
	firstLoginCompleted: v.boolean(),
	hasGoogle: v.boolean(),
	googleOnly: v.boolean()
});

const NO_SIGNUP_ACCOUNT = {
	exists: false,
	isVerified: false,
	firstLoginCompleted: false,
	hasGoogle: false,
	googleOnly: false
};

export const checkSignupEmail = mutation({
	args: {
		email: v.string()
	},
	returns: signupEmailStatusValidator,
	handler: async (ctx, args) => {
		const normalizedEmail = args.email.trim().toLowerCase();
		if (!normalizedEmail.includes('@')) return NO_SIGNUP_ACCOUNT;

		if (
			await isRateLimited(ctx, SIGNUP_EMAIL_LOOKUP_RATE_LIMIT_KEY, SIGNUP_EMAIL_LOOKUP_RATE_LIMIT)
		) {
			return NO_SIGNUP_ACCOUNT;
		}
		await recordRateLimitAttempt(
			ctx,
			SIGNUP_EMAIL_LOOKUP_RATE_LIMIT_KEY,
			SIGNUP_EMAIL_LOOKUP_RATE_LIMIT
		);

		if (isSyntheticChildEmail(normalizedEmail)) return NO_SIGNUP_ACCOUNT;

		const authUser = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: normalizedEmail }]
		})) as { _id: string; emailVerified?: boolean } | null;
		if (!authUser) return NO_SIGNUP_ACCOUNT;

		const profile = await getProfileByAuthUserId(ctx, authUser._id);
		const accounts = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
			model: 'account',
			where: [{ field: 'userId', value: authUser._id }],
			paginationOpts: { cursor: null, numItems: 20 }
		})) as { page: Array<{ providerId: string }> };
		const hasPassword = accounts.page.some((account) => account.providerId === 'credential');
		const hasGoogle = accounts.page.some((account) => account.providerId === 'google');

		return {
			exists: true,
			isVerified: Boolean(profile?.isVerified ?? authUser.emailVerified ?? false),
			firstLoginCompleted: Boolean(profile?.firstLoginCompleted),
			hasGoogle,
			googleOnly: hasGoogle && !hasPassword
		};
	}
});

export const ensureProfile = mutation({
	args: {},
	handler: async (ctx) => {
		const authUser = await authComponent.safeGetAuthUser(
			ctx as unknown as GenericCtx<GenericDataModel>
		);
		if (!authUser) {
			return null;
		}
		const existing = await getProfileByAuthUserId(ctx, authUser._id);

		const now = Date.now();
		const username = sanitizeUsernameFromEmail(authUser.email);
		const { firstName, lastName } = splitNameParts(authUser.name);

		if (existing) {
			await ctx.db.patch(existing._id, {
				firstName: existing.firstName ?? firstName,
				lastName: existing.lastName ?? lastName,
				coverPhotoUrl: existing.coverPhotoUrl ?? authUser.image ?? undefined,
				isVerified: authUser.emailVerified,
				updatedAt: now
			});
			return await ctx.db.get(existing._id);
		}

		const profileId = await ctx.db.insert('profiles', {
			authUserId: authUser._id,
			firstName,
			lastName,
			username,
			coverPhotoUrl: authUser.image ?? undefined,
			isVerified: authUser.emailVerified,
			firstLoginCompleted: false,
			updatedAt: now
		});

		return await ctx.db.get(profileId);
	}
});

export const completeSignupProfile = mutation({
	args: {
		signUpWith: v.union(v.literal('email'), v.literal('google')),
		dateOfBirth: v.optional(v.string()),
		username: v.optional(v.string()),
		nextPath: v.optional(v.string()),
		startClubApplicationDraft: v.optional(
			v.object({
				description: v.optional(v.string()),
				location: v.optional(v.string()),
				locationLatitude: v.optional(v.number()),
				locationLongitude: v.optional(v.number()),
				applicantRole: v.optional(v.string()),
				referralSource: v.optional(v.string()),
				referralOther: v.optional(v.string())
			})
		)
	},
	handler: async (ctx, args) => {
		const authUser = await authComponent.getAuthUser(
			ctx as unknown as GenericCtx<GenericDataModel>
		);
		const now = Date.now();
		const normalizedUsername = normalizeUsername(args.username);
		const authUsername = normalizeUsername(
			'username' in authUser ? (authUser.username as string | null | undefined) : undefined
		);
		const fallbackUsername = sanitizeUsernameFromEmail(authUser.email);
		const desiredUsername = normalizedUsername ?? fallbackUsername;
		const { firstName, lastName } = splitNameParts(authUser.name);
		const pendingJoinCode = extractPendingJoinCode(args.nextPath);

		const existing = await getProfileByAuthUserId(ctx, authUser._id);
		// Review B1: this is the adult signup path, but any signed-in caller can reach it. A child
		// account's date of birth (set at child signup) must not change here: the 16+ unlink gate
		// depends on it.
		if (existing) {
			await assertDateOfBirthChangeAllowed(ctx, existing, args.dateOfBirth);
		} else if (args.dateOfBirth !== undefined && isSyntheticChildEmail(authUser.email)) {
			throw new ConvexError("A child account's date of birth can't be changed");
		}

		let resolvedUsername = desiredUsername;
		if (desiredUsername) {
			const conflicting = await ctx.db
				.query('profiles')
				.withIndex('by_username', (q) => q.eq('username', desiredUsername))
				.first();
			if (conflicting && getProfileAuthUserId(conflicting) !== authUser._id) {
				if (normalizedUsername) {
					throw new ConvexError('Username is already taken');
				}
				// The conflicting name is only an email-derived default the user never chose —
				// pick a suffixed variant instead of failing the whole signup flow.
				resolvedUsername = await findAvailableUsernameVariant(ctx, authUser._id, desiredUsername);
			}
		}

		const patch = {
			isVerified: authUser.emailVerified,
			firstName: existing?.firstName ?? firstName,
			lastName: existing?.lastName ?? lastName,
			coverPhotoUrl: existing?.coverPhotoUrl ?? authUser.image ?? undefined,
			// A patched undefined would REMOVE an already-stored username (Convex patch
			// semantics), so keep the existing one when no new value was resolved.
			username: resolvedUsername ?? existing?.username,
			signUpWith: args.signUpWith,
			dateOfBirth: args.dateOfBirth ?? existing?.dateOfBirth,
			updatedAt: now
		};

		const profileId = existing
			? existing._id
			: await ctx.db.insert('profiles', {
					authUserId: authUser._id,
					firstLoginCompleted: false,
					...patch
				});

		if (existing) {
			await ctx.db.patch(existing._id, patch);
		}

		if (pendingJoinCode) {
			const club = await ctx.db
				.query('clubs')
				.withIndex('by_club_code', (q) => q.eq('clubCode', pendingJoinCode))
				.first();
			if (club && !club.abandonedAt) {
				await setPendingClubJoin(ctx, profileId, club._id, 'code');
			}
		}

		// CL-711 CEO feedback item 6: if `nextPath` points at a public club preview
		// (/clubs/{clubId}), the visitor tapped "Request to Join" before an account existed. Now
		// that the profile is created (adults don't have a separate consent gate), auto-complete
		// the join request they intended to send instead of requiring a second tap.
		await autoCreateJoinRequestFromNextPath(ctx, args.nextPath, profileId);

		if (resolvedUsername && resolvedUsername !== authUsername) {
			await ctx.runMutation(components.betterAuth.adapter.updateOne, {
				input: {
					model: 'user',
					where: [{ field: '_id', value: authUser._id }],
					update: {
						username: resolvedUsername,
						displayUsername: resolvedUsername,
						updatedAt: now
					}
				}
			});
		}
		if (args.startClubApplicationDraft) {
			await ctx.runMutation(internal.clubApplications.saveIncompleteApplicationForUser, {
				profileId,
				draft: args.startClubApplicationDraft
			});
		}
		return await ctx.db.get(profileId);
	}
});
