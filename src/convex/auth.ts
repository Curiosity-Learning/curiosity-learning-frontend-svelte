import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins';
import { createClient } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import type { GenericCtx } from '@convex-dev/better-auth';
import type { GenericDataModel } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { components } from './_generated/api';
import { mutation, query } from './_generated/server';
import authConfig from './auth.config';
import { requireIdentity } from './permissions';

export const authComponent = createClient(components.betterAuth);

const resendEmail = async (args: { to: string; subject: string; html: string; text: string }) => {
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) {
		throw new Error('RESEND_API_KEY is not set (Convex environment variable).');
	}

	const from = process.env.RESEND_FROM ?? 'Curiosity Learning <onboarding@resend.dev>';

	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			authorization: `Bearer ${apiKey}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			from,
			to: args.to,
			subject: args.subject,
			html: args.html,
			text: args.text
		})
	});

	if (!response.ok) {
		let details = '';
		try {
			details = JSON.stringify(await response.json());
		} catch {
			details = await response.text().catch(() => '');
		}
		throw new Error(`Resend send failed: ${response.status} ${response.statusText} ${details}`);
	}
};

const otpPurposeByType = {
	'email-verification': 'verify your email address',
	'sign-in': 'sign in',
	'forget-password': 'reset your password'
} as const;

const trustedOrigins = [
	process.env.BETTER_AUTH_URL,
	process.env.PUBLIC_CONVEX_SITE_URL,
	// Local dev / preview ports.
	'http://localhost:5173',
	'http://localhost:4173',
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

const resolvePendingClubIntent = (
	nextPath?: string | null
): { pendingClubCode?: string; pendingRole?: 'Learner' | 'Guide' } => {
	if (!nextPath) {
		return {};
	}

	const joinPrefix = '/onboarding/join-club/';
	if (nextPath.startsWith(joinPrefix)) {
		const rawCode = nextPath.slice(joinPrefix.length).split(/[/?#]/)[0] ?? '';
		const code = rawCode.trim().toUpperCase();
		if (/^[A-Z0-9]{6}$/.test(code)) {
			return {
				pendingClubCode: code,
				pendingRole: 'Learner'
			};
		}
	}

	if (nextPath.startsWith('/onboarding/start-club')) {
		return { pendingRole: 'Guide' };
	}

	return {};
};

export const createAuth = (ctx: GenericCtx<GenericDataModel>) =>
	betterAuth({
		baseURL: process.env.BETTER_AUTH_URL,
		database: authComponent.adapter(ctx),
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: true,
			sendResetPassword: async ({ user, url, token }) => {
				await resendEmail({
					to: user.email,
					subject: 'Reset your password',
					text: `Reset your password:\n\n${url}\n\nToken: ${token}`,
					html: `<p>Reset your password:</p><p><a href="${url}">${url}</a></p><p style="color:#666">Token: ${token}</p>`
				});
			}
		},
		emailVerification: {
			sendOnSignUp: true,
			sendOnSignIn: true,
			autoSignInAfterVerification: true
		},
		socialProviders,
		plugins: [
			emailOTP({
				otpLength: 6,
				expiresIn: 300,
				overrideDefaultEmailVerification: true,
				sendVerificationOTP: async ({ email, otp, type }) => {
					const purpose = otpPurposeByType[type];
					const subject =
						type === 'forget-password'
							? 'Reset your password code'
							: type === 'sign-in'
								? 'Your sign-in code'
								: 'Verify your email code';

					await resendEmail({
						to: email,
						subject,
						text: `Use this 6-digit code to ${purpose}: ${otp}\n\nThis code expires in 5 minutes.`,
						html: `<p>Use this 6-digit code to ${purpose}:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${otp}</p><p style="color:#666">This code expires in 5 minutes.</p>`
					});
				}
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

export const getSignupAccountStatusByEmail = query({
	args: {
		email: v.string()
	},
	handler: async (ctx, args) => {
		const normalizedEmail = args.email.trim().toLowerCase();
		if (!normalizedEmail) {
			return {
				exists: false,
				isVerified: false,
				firstLoginCompleted: false,
				hasPassword: false,
				hasGoogle: false
			};
		}

		const authUser = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: normalizedEmail }]
		})) as { _id: string; emailVerified?: boolean } | null;

		const profile = await ctx.db
			.query('profiles')
			.withIndex('by_email', (q) => q.eq('email', normalizedEmail))
			.first();

		if (!authUser && !profile) {
			return {
				exists: false,
				isVerified: false,
				firstLoginCompleted: false,
				hasPassword: false,
				hasGoogle: false
			};
		}

		let hasPassword = false;
		let hasGoogle = false;

		if (authUser?._id) {
			const accounts = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
				model: 'account',
				where: [{ field: 'userId', value: authUser._id }],
				paginationOpts: {
					cursor: null,
					numItems: 20
				}
			})) as { page: Array<{ providerId: string }> };

			hasPassword = accounts.page.some((account) => account.providerId === 'credential');
			hasGoogle = accounts.page.some((account) => account.providerId === 'google');
		}

		return {
			exists: true,
			isVerified: Boolean(profile?.isVerified ?? authUser?.emailVerified ?? false),
			firstLoginCompleted: Boolean(profile?.firstLoginCompleted),
			hasPassword,
			hasGoogle
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
		const existing = await ctx.db
			.query('profiles')
			.withIndex('by_user_id', (q) => q.eq('userId', authUser._id))
			.first();

		const now = Date.now();
		const username = authUser.email.split('@')[0].toLowerCase();
		const { firstName, lastName } = splitNameParts(authUser.name);

		if (existing) {
			await ctx.db.patch(existing._id, {
				email: authUser.email,
				firstName: existing.firstName ?? firstName,
				lastName: existing.lastName ?? lastName,
				coverPhotoUrl: existing.coverPhotoUrl ?? authUser.image ?? undefined,
				isVerified: authUser.emailVerified,
				updatedAt: now
			});
			return await ctx.db.get(existing._id);
		}

		const profileId = await ctx.db.insert('profiles', {
			userId: authUser._id,
			email: authUser.email,
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
		nextPath: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const authUser = await authComponent.getAuthUser(
			ctx as unknown as GenericCtx<GenericDataModel>
		);
		const now = Date.now();
		const normalizedUsername = args.username?.trim().toLowerCase() || undefined;
		const fallbackUsername = authUser.email.split('@')[0].toLowerCase();
		const desiredUsername = normalizedUsername ?? fallbackUsername;
		const { firstName, lastName } = splitNameParts(authUser.name);
		const pending = resolvePendingClubIntent(args.nextPath);

		const existing = await ctx.db
			.query('profiles')
			.withIndex('by_user_id', (q) => q.eq('userId', authUser._id))
			.first();

		if (desiredUsername) {
			const conflicting = await ctx.db
				.query('profiles')
				.withIndex('by_username', (q) => q.eq('username', desiredUsername))
				.first();
			if (conflicting && conflicting.userId !== authUser._id) {
				throw new ConvexError('Username is already taken');
			}
		}

		const patch = {
			email: authUser.email,
			isVerified: authUser.emailVerified,
			firstName: existing?.firstName ?? firstName,
			lastName: existing?.lastName ?? lastName,
			coverPhotoUrl: existing?.coverPhotoUrl ?? authUser.image ?? undefined,
			username: desiredUsername,
			signUpWith: args.signUpWith,
			dateOfBirth: args.dateOfBirth ?? existing?.dateOfBirth,
			pendingClubCode: pending.pendingClubCode ?? existing?.pendingClubCode,
			pendingRole: pending.pendingRole ?? existing?.pendingRole,
			updatedAt: now
		};

		if (existing) {
			await ctx.db.patch(existing._id, patch);
			return await ctx.db.get(existing._id);
		}

		const profileId = await ctx.db.insert('profiles', {
			userId: authUser._id,
			firstLoginCompleted: false,
			...patch
		});
		return await ctx.db.get(profileId);
	}
});
