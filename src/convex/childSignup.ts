import { hashPassword } from 'better-auth/crypto';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { components } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
	action,
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	query
} from './_generated/server';
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
import {
	clearPendingClubJoinsForProfile,
	getLatestPendingClubJoin,
	setPendingClubJoin
} from './pendingClubJoinsModel';

// PRD 6.1.6/8.5: parental consent must be obtained within 90 days of account creation, or the
// child account and all associated data are automatically purged. See `purgeExpiredChildConsents`
// (invoked daily by the cron in `crons.ts`).
const CONSENT_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000;

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
			updatedAt: now
		});

		const pendingJoinCode = getPendingJoinCode(args.nextPath);
		if (pendingJoinCode) {
			const club = await ctx.db
				.query('clubs')
				.withIndex('by_club_code', (q) => q.eq('clubCode', pendingJoinCode))
				.first();
			if (club && !club.abandonedAt) {
				await setPendingClubJoin(ctx, profileId, club._id, 'code');
			}
		}

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
		// PRD 5.6: any deferred club-join intent for this profile — recorded either at signup time
		// (a code-join link, see createPendingChildAccount) or by joinRequests.acceptJoinRequest
		// (an accepted map join-request while this gate was still pending) — is consumed here, the
		// moment the consent gate clears.
		let joinedClubId = childProfile.activeClubId;
		const pendingJoin = await getLatestPendingClubJoin(ctx, consent.childProfileId);
		if (pendingJoin) {
			const club = await ctx.db.get(pendingJoin.clubId);
			if (club && !club.abandonedAt) {
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
			updatedAt: now
		});
		await clearPendingClubJoinsForProfile(ctx, consent.childProfileId);
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

// ---------------------------------------------------------------------------------------------
// 90-day parental consent purge (PRD 6.1.6/8.5)
//
// If a child account's parental consent is still `pending` more than 90 days after the consent
// row (== account) was created, the account and everything tied to it must be irrecoverably
// removed. Approved/declined consents and adult accounts are never touched.
//
// The Convex-table half (consent row, profile, notifications, any incomplete club application
// draft) is fully testable via convex-test. The Better Auth user/account/session rows live in
// the `betterAuth` component, which convex-test does not mount (see `authEmail.ts`) — that half
// is only exercisable against a real deployment, so it's isolated in its own internal action
// (`hardDeleteAuthUser`) rather than mixed into the unit-testable mutation.
// ---------------------------------------------------------------------------------------------

export const listExpiredPendingConsents = internalQuery({
	args: {
		olderThan: v.number()
	},
	returns: v.array(
		v.object({
			consentId: v.id('parentChildConsents'),
			childProfileId: v.id('profiles')
		})
	),
	handler: async (ctx, args) => {
		const pending = await ctx.db
			.query('parentChildConsents')
			.withIndex('by_status_and_created_at', (q) =>
				q.eq('status', 'pending').lt('createdAt', args.olderThan)
			)
			.collect();
		return pending.map((consent) => ({
			consentId: consent._id,
			childProfileId: consent.childProfileId
		}));
	}
});

// Deletes every Convex-table row tied to one expired-pending child account: the consent row,
// any incomplete club application draft started during signup, notifications addressed to the
// profile, and the profile itself. Re-verifies status/age so it can't be called against a
// consent that has since been approved/declined by the time the cron reaches it. Returns
// whether it actually deleted anything plus the profile's authUserId so the caller can also
// remove the Better Auth user.
export const purgeExpiredChildConsentData = internalMutation({
	args: {
		consentId: v.id('parentChildConsents'),
		olderThan: v.number()
	},
	returns: v.object({
		purged: v.boolean(),
		authUserId: v.union(v.string(), v.null())
	}),
	handler: async (ctx, args) => {
		const consent = await ctx.db.get(args.consentId);
		if (!consent || consent.status !== 'pending' || consent.createdAt >= args.olderThan) {
			return { purged: false, authUserId: null };
		}

		const profile = await ctx.db.get(consent.childProfileId);
		const authUserId = profile ? getProfileAuthUserId(profile) : null;

		const incompleteApplications = await ctx.db
			.query('clubApplications')
			.withIndex('by_applicant_profile_id', (q) => q.eq('applicantProfileId', consent.childProfileId))
			.collect();
		for (const application of incompleteApplications) {
			if (application.status === 'incomplete') {
				await ctx.db.delete(application._id);
			}
		}

		const notifications = await ctx.db
			.query('notifications')
			.withIndex('by_profile', (q) => q.eq('profileId', consent.childProfileId))
			.collect();
		for (const notification of notifications) {
			await ctx.db.delete(notification._id);
		}

		await clearPendingClubJoinsForProfile(ctx, consent.childProfileId);

		await ctx.db.delete(consent._id);
		if (profile) {
			await ctx.db.delete(profile._id);
		}

		return authUserId ? { purged: true, authUserId } : { purged: false, authUserId: null };
	}
});

// Removes the Better Auth `user` row plus its `account`/`session` rows via the adapter
// component's deleteMany/deleteOne. Only reachable from `purgeExpiredChildConsents` below, never
// exposed publicly. Not covered by convex-test (component not mounted there, see module header);
// exercised manually against a real deployment instead.
const MAX_DELETE_ITERATIONS = 50;

export const hardDeleteAuthUser = internalAction({
	args: {
		authUserId: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		// deleteOne removes at most one matching row per call, so loop until none remain (a user
		// realistically has a handful of session/account rows, never anywhere near the safety cap).
		for (const model of ['session', 'account'] as const) {
			for (let i = 0; i < MAX_DELETE_ITERATIONS; i++) {
				const deleted = await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
					input: {
						model,
						where: [{ field: 'userId', value: args.authUserId }]
					}
				});
				if (!deleted) break;
			}
		}
		await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
			input: {
				model: 'user',
				where: [{ field: '_id', value: args.authUserId }]
			}
		});
		return null;
	}
});

// Entry point invoked by the daily cron (see `crons.ts`). Finds every consent still `pending`
// after `CONSENT_EXPIRY_MS`, purges the Convex-side data for each, and hard-deletes the
// corresponding Better Auth user. Returns a count summary for the cron to log. Errors for an
// individual account are reported to monitoring and skipped so one bad row can't block the rest
// of the batch; the run still completes and its summary reflects partial progress.
export const purgeExpiredChildConsents = internalAction({
	args: {},
	returns: v.object({
		scanned: v.number(),
		purged: v.number(),
		failed: v.number()
	}),
	handler: async (
		ctx
	): Promise<{ scanned: number; purged: number; failed: number }> => {
		const olderThan = Date.now() - CONSENT_EXPIRY_MS;
		const candidates: Array<{
			consentId: Id<'parentChildConsents'>;
			childProfileId: Id<'profiles'>;
		}> = await ctx.runQuery(internal.childSignup.listExpiredPendingConsents, {
			olderThan
		});

		let purged = 0;
		let failed = 0;
		for (const candidate of candidates) {
			try {
				const result = await ctx.runMutation(internal.childSignup.purgeExpiredChildConsentData, {
					consentId: candidate.consentId,
					olderThan
				});
				if (!result.purged || !result.authUserId) continue;
				await ctx.runAction(internal.childSignup.hardDeleteAuthUser, {
					authUserId: result.authUserId
				});
				purged += 1;
			} catch (error) {
				failed += 1;
				await reportConvexError(error, {
					area: 'auth',
					operation: 'child-signup:purge-expired-consent',
					identifiers: { consentId: candidate.consentId }
				});
			}
		}

		return { scanned: candidates.length, purged, failed };
	}
});
