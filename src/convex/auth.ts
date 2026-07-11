import { betterAuth } from 'better-auth';
import { emailOTP, username } from 'better-auth/plugins';
import { createClient } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import type { GenericCtx } from '@convex-dev/better-auth';
import type { GenericDataModel } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { components, internal } from './_generated/api';
import { mutation, query } from './_generated/server';
import authConfig from './auth.config';
import { sendEmail } from './email/resend';
import { passwordResetEmail, verificationOtpEmail } from './email/templates';
import { getProfileAuthUserId, getProfileByAuthUserId, requireIdentity } from './permissions';
import { setPendingClubJoin } from './pendingClubJoinsModel';

export const authComponent = createClient(components.betterAuth);

const trustedOrigins = [
	process.env.BETTER_AUTH_URL,
	process.env.PUBLIC_CONVEX_SITE_URL,
	// Local dev / preview ports.
	'http://localhost:5173',
	'http://localhost:4173',
	// Admin app dev origin (curiosity-learning-admin, separate repo, CEO admin-split decision).
	'http://localhost:4174',
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

const REMEMBERED_SESSION_SECONDS = 60 * 60 * 24 * 30;

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

export const createAuth = (ctx: GenericCtx<GenericDataModel>) =>
	betterAuth({
		baseURL: process.env.BETTER_AUTH_URL,
		database: authComponent.adapter(ctx),
		session: {
			expiresIn: REMEMBERED_SESSION_SECONDS
		},
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: true,
			sendResetPassword: async ({ user, url, token }) => {
				await sendEmail({
					type: 'password-reset',
					to: user.email,
					...passwordResetEmail({ url, token })
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
					await sendEmail({
						type: 'verification-otp',
						to: email,
						...verificationOtpEmail({ otp, type })
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

		const profile = authUser?._id ? await getProfileByAuthUserId(ctx, authUser._id) : null;

		if (!authUser) {
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

export const resolveAuthIdentifier = query({
	args: {
		identifier: v.string()
	},
	handler: async (ctx, args) => {
		const normalizedIdentifier = args.identifier.trim().toLowerCase();
		if (!normalizedIdentifier) {
			return { email: null };
		}

		if (normalizedIdentifier.includes('@')) {
			return { email: normalizedIdentifier };
		}

		const authUser = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'username', value: normalizedIdentifier }]
		})) as { email?: string } | null;

		return {
			email: authUser?.email ?? null
		};
	}
});

export const getAuthUserByUsername = query({
	args: {
		username: v.string()
	},
	returns: v.any(),
	handler: async (ctx, args) => {
		const normalizedUsername = args.username.trim().toLowerCase();
		if (!normalizedUsername) return null;

		return (await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'username', value: normalizedUsername }]
		})) as { _id: string; email: string; emailVerified?: boolean; username?: string | null } | null;
	}
});

export const getUsernameLoginStatus = query({
	args: {
		username: v.string()
	},
	returns: v.object({
		exists: v.boolean(),
		parentConsentStatus: v.optional(v.union(v.literal('pending'), v.literal('approved')))
	}),
	handler: async (ctx, args) => {
		const normalizedUsername = args.username.trim().toLowerCase();
		if (!normalizedUsername) {
			return { exists: false };
		}
		const profile = await ctx.db
			.query('profiles')
			.withIndex('by_username', (q) => q.eq('username', normalizedUsername))
			.first();
		if (!profile) {
			return { exists: false };
		}
		const consent = await ctx.db
			.query('parentChildConsents')
			.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', profile._id))
			.order('desc')
			.first();
		return {
			exists: true,
			parentConsentStatus: consent?.status
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
		const username = authUser.email.split('@')[0].toLowerCase();
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
		const fallbackUsername = normalizeUsername(authUser.email.split('@')[0]);
		const desiredUsername = normalizedUsername ?? fallbackUsername;
		const { firstName, lastName } = splitNameParts(authUser.name);
		const pendingJoinCode = extractPendingJoinCode(args.nextPath);

		const existing = await getProfileByAuthUserId(ctx, authUser._id);

		if (desiredUsername) {
			const conflicting = await ctx.db
				.query('profiles')
				.withIndex('by_username', (q) => q.eq('username', desiredUsername))
				.first();
			if (conflicting && getProfileAuthUserId(conflicting) !== authUser._id) {
				throw new ConvexError('Username is already taken');
			}
		}

		const patch = {
			isVerified: authUser.emailVerified,
			firstName: existing?.firstName ?? firstName,
			lastName: existing?.lastName ?? lastName,
			coverPhotoUrl: existing?.coverPhotoUrl ?? authUser.image ?? undefined,
			username: desiredUsername,
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

		if (desiredUsername && desiredUsername !== authUsername) {
			await ctx.runMutation(components.betterAuth.adapter.updateOne, {
				input: {
					model: 'user',
					where: [{ field: '_id', value: authUser._id }],
					update: {
						username: desiredUsername,
						displayUsername: desiredUsername,
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
