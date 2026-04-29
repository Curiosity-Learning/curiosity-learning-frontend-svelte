import { hashPassword } from 'better-auth/crypto';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { components } from './_generated/api';
import { action, internalMutation, mutation, query } from './_generated/server';
import { syntheticEmailForUsername } from './childAccounts';
import { sendEmail } from './email/resend';
import { parentConsentEmail } from './email/templates';

const INVITE_CODE_PATTERN = /^[A-Z0-9]{6}$/;

const normalizeUsername = (value: string) => value.trim().toLowerCase();
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const normalizeInviteCode = (value: string) => value.trim().toUpperCase();

const createConsentToken = () => {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const displayNameFromEmail = (email: string) => email.split('@')[0]?.trim() || email;

const getPendingJoinCode = (nextPath?: string) => {
	const joinPrefix = '/onboarding/join-club/';
	if (!nextPath?.startsWith(joinPrefix)) return null;
	const code = normalizeInviteCode(nextPath.slice(joinPrefix.length).split(/[/?#]/)[0] ?? '');
	return INVITE_CODE_PATTERN.test(code) ? code : null;
};

const sendParentConsentEmail = async (args: {
	parentEmail: string;
	childUsername: string;
	consentUrl: string;
}) => {
	await sendEmail({
		to: args.parentEmail,
		...parentConsentEmail({
			childUsername: args.childUsername,
			consentUrl: args.consentUrl
		})
	});
};

export const registerChild = action({
	args: {
		username: v.string(),
		password: v.string(),
		parentEmail: v.string(),
		dateOfBirth: v.optional(v.string()),
		nextPath: v.optional(v.string())
	},
	returns: v.object({
		success: v.boolean()
	}),
	handler: async (ctx, args) => {
		const username = normalizeUsername(args.username);
		const parentEmail = normalizeEmail(args.parentEmail);
		if (!/^[a-z0-9_]{3,30}$/.test(username)) {
			throw new ConvexError(
				'Username can only contain lowercase letters, numbers, and underscores'
			);
		}
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) {
			throw new ConvexError('A valid parent email is required');
		}
		if (args.password.length < 8) {
			throw new ConvexError('Password must be at least 8 characters');
		}

		const token = createConsentToken();
		const passwordHash = await hashPassword(args.password);
		await ctx.runMutation(internal.childSignup.createPendingChildAccount, {
			username,
			parentEmail,
			passwordHash,
			token,
			dateOfBirth: args.dateOfBirth,
			nextPath: args.nextPath
		});

		const baseUrl = process.env.BETTER_AUTH_URL ?? process.env.PUBLIC_CONVEX_SITE_URL;
		if (!baseUrl) {
			throw new Error('BETTER_AUTH_URL or PUBLIC_CONVEX_SITE_URL is required for consent links');
		}
		await sendParentConsentEmail({
			parentEmail,
			childUsername: username,
			consentUrl: `${baseUrl}/onboarding/parent-consent/${token}`
		});
		return { success: true };
	}
});

export const createPendingChildAccount = internalMutation({
	args: {
		username: v.string(),
		parentEmail: v.string(),
		passwordHash: v.string(),
		token: v.string(),
		dateOfBirth: v.optional(v.string()),
		nextPath: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const existingAuthUser = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'username', value: args.username }]
		})) as { _id: string } | null;
		if (existingAuthUser) {
			throw new ConvexError('Username is already taken');
		}

		const existingProfile = await ctx.db
			.query('profiles')
			.withIndex('by_username', (q) => q.eq('username', args.username))
			.first();
		if (existingProfile) {
			throw new ConvexError('Username is already taken');
		}

		const now = Date.now();
		const authUser = (await ctx.runMutation(components.betterAuth.adapter.create, {
			input: {
				model: 'user',
				data: {
					email: syntheticEmailForUsername(args.username),
					emailVerified: false,
					name: args.username,
					username: args.username,
					displayUsername: args.username,
					createdAt: now,
					updatedAt: now
				}
			}
		})) as { _id: string; email: string };

		await ctx.runMutation(components.betterAuth.adapter.create, {
			input: {
				model: 'account',
				data: {
					accountId: authUser._id,
					providerId: 'credential',
					userId: authUser._id,
					password: args.passwordHash,
					createdAt: now,
					updatedAt: now
				}
			}
		});

		const profileId = await ctx.db.insert('profiles', {
			userId: authUser._id,
			username: args.username,
			dateOfBirth: args.dateOfBirth,
			isVerified: false,
			firstLoginCompleted: false,
			pendingClubCode: getPendingJoinCode(args.nextPath) ?? undefined,
			pendingRole: getPendingJoinCode(args.nextPath) ? 'Learner' : undefined,
			updatedAt: now
		});

		await ctx.db.insert('parentChildConsents', {
			childUserId: authUser._id,
			childProfileId: profileId,
			parentEmail: args.parentEmail,
			status: 'pending',
			token: args.token,
			onboardingIntentPath: args.nextPath,
			createdAt: now,
			updatedAt: now
		});
		return null;
	}
});

export const getConsentByToken = query({
	args: {
		token: v.string()
	},
	returns: v.any(),
	handler: async (ctx, args) => {
		const consent = await ctx.db
			.query('parentChildConsents')
			.withIndex('by_token', (q) => q.eq('token', args.token))
			.first();
		if (!consent) return null;
		const childProfile = await ctx.db.get(consent.childProfileId);
		return {
			...consent,
			childUsername: childProfile?.username ?? null
		};
	}
});

export const approveConsent = mutation({
	args: {
		token: v.string(),
		acceptedTerms: v.boolean(),
		acceptedPrivacyPolicy: v.boolean()
	},
	returns: v.object({
		success: v.boolean()
	}),
	handler: async (ctx, args) => {
		if (!args.acceptedTerms || !args.acceptedPrivacyPolicy) {
			throw new ConvexError('Terms and privacy policy approval is required');
		}
		const consent = await ctx.db
			.query('parentChildConsents')
			.withIndex('by_token', (q) => q.eq('token', args.token))
			.first();
		if (!consent) {
			throw new ConvexError('Consent request not found');
		}
		if (consent.status === 'approved') {
			return { success: true };
		}

		const now = Date.now();
		const existingParentAuthUser = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: consent.parentEmail }]
		})) as { _id: string; email: string; emailVerified?: boolean; name?: string | null } | null;
		const parentAuthUser =
			existingParentAuthUser ??
			((await ctx.runMutation(components.betterAuth.adapter.create, {
				input: {
					model: 'user',
					data: {
						email: consent.parentEmail,
						emailVerified: true,
						name: displayNameFromEmail(consent.parentEmail),
						createdAt: now,
						updatedAt: now
					}
				}
			})) as { _id: string; email: string; emailVerified?: boolean; name?: string | null });

		if (existingParentAuthUser && !existingParentAuthUser.emailVerified) {
			await ctx.runMutation(components.betterAuth.adapter.updateOne, {
				input: {
					model: 'user',
					where: [{ field: '_id', value: existingParentAuthUser._id }],
					update: {
						emailVerified: true,
						updatedAt: now
					}
				}
			});
		}

		const existingParentProfile = await ctx.db
			.query('profiles')
			.withIndex('by_user_id', (q) => q.eq('userId', parentAuthUser._id))
			.first();
		const parentProfileId =
			existingParentProfile?._id ??
			(await ctx.db.insert('profiles', {
				userId: parentAuthUser._id,
				firstName: displayNameFromEmail(parentAuthUser.email),
				isVerified: true,
				firstLoginCompleted: false,
				updatedAt: now
			}));

		if (existingParentProfile) {
			await ctx.db.patch(existingParentProfile._id, {
				userId: parentAuthUser._id,
				isVerified: true,
				updatedAt: now
			});
		}

		const existingParent = await ctx.db
			.query('parents')
			.withIndex('by_user_id', (q) => q.eq('userId', parentAuthUser._id))
			.first();
		const parentId =
			existingParent?._id ??
			(await ctx.db.insert('parents', {
				userId: parentAuthUser._id,
				profileId: parentProfileId,
				email: parentAuthUser.email,
				createdAt: now,
				updatedAt: now
			}));
		if (existingParent) {
			await ctx.db.patch(existingParent._id, {
				profileId: parentProfileId,
				email: parentAuthUser.email,
				updatedAt: now
			});
		}

		const childProfile = await ctx.db.get(consent.childProfileId);
		if (!childProfile) {
			throw new ConvexError('Child profile not found');
		}
		let joinedClubId = childProfile.activeClubId;
		const joinCode = getPendingJoinCode(consent.onboardingIntentPath);
		if (joinCode) {
			const club = await ctx.db
				.query('clubs')
				.withIndex('by_club_code', (q) => q.eq('clubCode', joinCode))
				.first();
			if (club) {
				const existingMembership = await ctx.db
					.query('clubMembers')
					.withIndex('by_club_and_user', (q) =>
						q.eq('clubId', club._id).eq('userId', consent.childUserId)
					)
					.first();
				if (!existingMembership) {
					const learnerRole = await ctx.db
						.query('clubRoles')
						.withIndex('by_name', (q) => q.eq('name', 'Learner'))
						.first();
					if (!learnerRole) {
						throw new ConvexError('Default role Learner is not configured');
					}
					await ctx.db.insert('clubMembers', {
						clubId: club._id,
						userId: consent.childUserId,
						roleId: learnerRole._id,
						firstName: childProfile.firstName,
						lastName: childProfile.lastName,
						username: childProfile.username,
						coverPhotoUrl: childProfile.coverPhotoUrl,
						createdAt: now
					});
				}
				joinedClubId = club._id;
			}
		}

		await ctx.db.patch(consent._id, {
			status: 'approved',
			parentUserId: parentAuthUser._id,
			parentProfileId,
			parentId,
			termsAcceptedAt: now,
			privacyPolicyAcceptedAt: now,
			approvedAt: now,
			updatedAt: now
		});
		await ctx.db.patch(consent.childProfileId, {
			isVerified: true,
			parentId,
			activeClubId: joinedClubId,
			firstLoginCompleted: Boolean(joinedClubId) || childProfile.firstLoginCompleted,
			pendingClubCode: undefined,
			pendingRole: undefined,
			updatedAt: now
		});
		await ctx.runMutation(components.betterAuth.adapter.updateOne, {
			input: {
				model: 'user',
				where: [{ field: '_id', value: consent.childUserId }],
				update: {
					emailVerified: true,
					updatedAt: now
				}
			}
		});
		return { success: true };
	}
});
