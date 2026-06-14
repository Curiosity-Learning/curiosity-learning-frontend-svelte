import { hashPassword } from 'better-auth/crypto';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { components } from './_generated/api';
import { action, internalMutation, mutation, query } from './_generated/server';
import { syntheticEmailForUsername } from './childAccounts';
import { sendEmail } from './email/resend';
import { parentConsentEmail } from './email/templates';
import { reportConvexError } from './monitoring';
import {
	getClubRoleByKey,
	getMembershipByProfileId,
	getProfileAuthUserId,
	getProfileByAuthUserId
} from './permissions';

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
		type: 'parent-consent',
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
	returns: v.object({
		success: v.boolean()
	}),
	handler: async (ctx, args) => {
		try {
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
				nextPath: args.nextPath,
				startClubApplicationDraft: args.startClubApplicationDraft
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
		} catch (error) {
			if (!(error instanceof ConvexError)) {
				await reportConvexError(error, {
					area: 'auth',
					operation: 'child-signup:register'
				});
			}
			throw error;
		}
	}
});

export const createPendingChildAccount = internalMutation({
	args: {
		username: v.string(),
		parentEmail: v.string(),
		passwordHash: v.string(),
		token: v.string(),
		dateOfBirth: v.optional(v.string()),
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
			authUserId: authUser._id,
			username: args.username,
			dateOfBirth: args.dateOfBirth,
			isVerified: false,
			firstLoginCompleted: false,
			pendingClubCode: getPendingJoinCode(args.nextPath) ?? undefined,
			pendingRole: getPendingJoinCode(args.nextPath) ? 'Learner' : undefined,
			updatedAt: now
		});

		await ctx.db.insert('parentChildConsents', {
			childProfileId: profileId,
			parentEmail: args.parentEmail,
			status: 'pending',
			token: args.token,
			onboardingIntentPath: args.nextPath,
			createdAt: now,
			updatedAt: now
		});
		if (args.startClubApplicationDraft) {
			await ctx.runMutation(internal.clubApplications.saveIncompleteApplicationForUser, {
				profileId,
				draft: args.startClubApplicationDraft
			});
		}
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

		const existingParentProfile = await getProfileByAuthUserId(ctx, parentAuthUser._id);
		const parentProfileId =
			existingParentProfile?._id ??
			(await ctx.db.insert('profiles', {
				authUserId: parentAuthUser._id,
				firstName: displayNameFromEmail(parentAuthUser.email),
				isVerified: true,
				firstLoginCompleted: false,
				updatedAt: now
			}));

		if (existingParentProfile) {
			await ctx.db.patch(existingParentProfile._id, {
				authUserId: parentAuthUser._id,
				isVerified: true,
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
				const existingMembership = await getMembershipByProfileId(
					ctx,
					club._id,
					consent.childProfileId
				);
				if (!existingMembership) {
					const learnerRole = await getClubRoleByKey(ctx, 'learner');
					if (!learnerRole) {
						throw new ConvexError('Default role Learner is not configured');
					}
					await ctx.db.insert('clubMembers', {
						clubId: club._id,
						profileId: consent.childProfileId,
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
			parentProfileId,
			termsAcceptedAt: now,
			privacyPolicyAcceptedAt: now,
			approvedAt: now,
			updatedAt: now
		});
		await ctx.db.patch(consent.childProfileId, {
			isVerified: true,
			parentProfileId,
			activeClubId: joinedClubId,
			firstLoginCompleted: Boolean(joinedClubId) || childProfile.firstLoginCompleted,
			pendingClubCode: undefined,
			pendingRole: undefined,
			updatedAt: now
		});
		const childAuthUserId = getProfileAuthUserId(childProfile);
		if (!childAuthUserId) {
			throw new ConvexError('Child profile is not linked to an auth user');
		}
		await ctx.runMutation(components.betterAuth.adapter.updateOne, {
			input: {
				model: 'user',
				where: [{ field: '_id', value: childAuthUserId }],
				update: {
					emailVerified: true,
					updatedAt: now
				}
			}
		});
		return { success: true };
	}
});
