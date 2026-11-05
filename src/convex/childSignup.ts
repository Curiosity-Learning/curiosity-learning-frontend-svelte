import { hashPassword } from 'better-auth/crypto';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { components } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
	action,
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	query
} from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { syntheticEmailForUsername } from './childAccounts';
import { sendEmail } from './email/resend';
import { parentConsentEmail } from './email/templates';
import { reportConvexError } from './monitoring';
import { ensureParentLink, normalizeChildNotificationEmail } from './parentAccounts';
import {
	CHILD_EMAIL_VERIFICATION_RATE_LIMIT,
	childEmailVerificationRateLimitKey,
	issueChildEmailVerification
} from './childEmailVerification';
import { getActiveOrLatestByKey } from './legalDocuments';
import { recordRateLimitAttempt } from './rateLimiting';
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
import { autoCreateJoinRequestFromNextPath } from './joinRequests';
import { mintMagicLink } from './magicLinks';
import { CONSENT_SCREEN_MAGIC_LINK_SECONDS } from '../lib/auth/magic-link';

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

// Deletes every Better Auth row that lets someone act as `authUserId` — sign-in methods
// (`account`, all providers: a password, a linked Google account) and live `session` rows —
// through the component adapter's paginated deleteMany. Leaves the `user` row itself.
const AUTH_ROW_DELETE_PAGE_SIZE = 100;
const deleteAuthRowsForUser = async (ctx: MutationCtx, authUserId: string) => {
	for (const model of ['account', 'session'] as const) {
		let cursor: string | null = null;
		for (;;) {
			const result: { isDone: boolean; continueCursor: string } = await ctx.runMutation(
				components.betterAuth.adapter.deleteMany,
				{
					input: { model, where: [{ field: 'userId', value: authUserId }] },
					paginationOpts: { cursor, numItems: AUTH_ROW_DELETE_PAGE_SIZE }
				}
			);
			if (result.isDone) break;
			cursor = result.continueCursor;
		}
	}
};

// The wording the consent screen shows (onboarding.parentConsent.agreement in the i18n
// messages): ONE checkbox covering the child's account and the parent's own account (review
// D9). Recorded on every approval; bump it whenever that sentence changes meaning.
export const PARENT_CONSENT_WORDING_KEY = 'parentConsent.v2.combined';
const UNVERSIONED_LEGAL_DOCUMENT = 'unversioned';
const SUPPORTED_CONSENT_LOCALES = new Set(['en', 'nl']);

/**
 * The parent approves a pending child account (consent screen v2, CL-769, review S12/S13/D8/D9).
 *
 * Keyed by the consent token only — never add a childProfileId arg (review S13, structural test
 * in parentAccounts.spec.ts): the token was only ever emailed to `parentEmail`, so holding it is
 * the proof, and the child is derived from it.
 *
 * `childEmail` (optional): the parent chose "To {child}'s own email address". Validated with the
 * child page's rules BEFORE anything is written, so a bad address fails the whole call and the
 * consent stays pending (the parent fixes it and presses Approve again). A valid one is stored
 * PENDING with source 'consent' and gets the same confirmation email as the child page
 * (childEmailVerification.issueChildEmailVerification); nothing routes to it until the child
 * confirms. Unlike setChildNotificationEmail there is no fresh-session rule (the consent token is
 * the proof; there is no session yet) and no "routing changed" notice to the parent (they made
 * the choice on this screen a moment ago, and the success screen says what happens next).
 *
 * Record keeping: the consent row gets the legal document versions, wording key, locale and
 * `coversParentAccount`; the parent profile gets termsAcceptedAt/privacyPolicyAcceptedAt (+
 * versions) only where not already set, so an earlier acceptance is never overwritten.
 */
export const approveConsent = mutation({
	args: {
		token: v.string(),
		acceptedTerms: v.boolean(),
		acceptedPrivacyPolicy: v.boolean(),
		childEmail: v.optional(v.string()),
		locale: v.optional(v.string())
	},
	returns: v.object({
		success: v.boolean(),
		// One-time sign-in link for the parent, only on the approval itself (see below).
		signInUrl: v.optional(v.string()),
		// The normalized pending child address, when one was given with this approval.
		childEmail: v.optional(v.string()),
		// False when an existing (verified) adult account under parentEmail was adopted, so the
		// success screen does not claim it "created" one. Only on the approval itself.
		parentAccountCreated: v.optional(v.boolean())
	}),
	handler: async (
		ctx,
		args
	): Promise<{
		success: boolean;
		signInUrl?: string;
		childEmail?: string;
		parentAccountCreated?: boolean;
	}> => {
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
		// No sign-in link on a revisit: the consent token never expires once approved, and handing
		// out a fresh session for it would turn the consent email into a permanent login link.
		// A revisit changes nothing else either (no child email: that lives on the child's page).
		if (consent.status === 'approved') {
			return { success: true };
		}

		// Before any write (see the doc comment). The parent account is found or created under
		// consent.parentEmail below, so that is both "the consent address" and "the parent's auth
		// email" the child page refuses (edge case 1).
		const childEmail =
			args.childEmail === undefined || args.childEmail.trim() === ''
				? null
				: normalizeChildNotificationEmail(args.childEmail, [consent.parentEmail]);
		const locale = args.locale?.trim().toLowerCase();

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

		if (existingParentAuthUser && existingParentAuthUser.emailVerified !== true) {
			// CL-768 (review B1): an UNVERIFIED user under the parent's address was registered by
			// someone who never proved they own it — most plausibly the child, who knows the address
			// because they typed it. Approving consent is the first proof of ownership, so it must
			// not inherit anything that registrant set up: marking the row verified while its
			// password (credential account) or sessions survive would hand them a working login to
			// the parent account, which is linked to the child below. Strip every sign-in method and
			// session first, and reset the self-chosen name/username, then verify. The user row
			// itself is kept (not deleted and recreated) because a profiles row may already point at
			// its id; that profile is adopted below like any other.
			await deleteAuthRowsForUser(ctx, existingParentAuthUser._id);
			await ctx.runMutation(components.betterAuth.adapter.updateOne, {
				input: {
					model: 'user',
					where: [{ field: '_id', value: existingParentAuthUser._id }],
					update: {
						emailVerified: true,
						name: displayNameFromEmail(consent.parentEmail),
						image: null,
						username: null,
						displayUsername: null,
						updatedAt: now
					}
				}
			});
		}

		// The versions /terms and /privacy show right now, i.e. what the checkbox links to.
		const termsVersion =
			(await getActiveOrLatestByKey(ctx, 'terms_and_conditions'))?.version ??
			UNVERSIONED_LEGAL_DOCUMENT;
		const privacyPolicyVersion =
			(await getActiveOrLatestByKey(ctx, 'privacy_policy'))?.version ?? UNVERSIONED_LEGAL_DOCUMENT;

		const existingParentProfile = await getProfileByAuthUserId(ctx, parentAuthUser._id);
		const parentProfileId =
			existingParentProfile?._id ??
			(await ctx.db.insert('profiles', {
				authUserId: parentAuthUser._id,
				firstName: displayNameFromEmail(parentAuthUser.email),
				isVerified: true,
				firstLoginCompleted: false,
				termsAcceptedAt: now,
				termsVersion,
				privacyPolicyAcceptedAt: now,
				privacyPolicyVersion,
				updatedAt: now
			}));

		if (existingParentProfile) {
			// Review S12: the earliest acceptance is the record — an adult who already accepted (at
			// sign-up, or approving a sibling) keeps that date and version.
			await ctx.db.patch(existingParentProfile._id, {
				authUserId: parentAuthUser._id,
				isVerified: true,
				...(existingParentProfile.termsAcceptedAt === undefined
					? { termsAcceptedAt: now, termsVersion }
					: {}),
				...(existingParentProfile.privacyPolicyAcceptedAt === undefined
					? { privacyPolicyAcceptedAt: now, privacyPolicyVersion }
					: {}),
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

		// CL-711 CEO feedback item 6: if the child's original sign-up flow was started from a
		// public club preview (/clubs/{clubId} — "Request to Join"), the request couldn't be
		// created until now: minors only get a join request once parental consent clears (PRD
		// 6.1.4). `onboardingIntentPath` is the `nextPath` recorded at registration time (see
		// createPendingChildAccount above).
		await autoCreateJoinRequestFromNextPath(
			ctx,
			consent.onboardingIntentPath,
			consent.childProfileId
		);

		await ctx.db.patch(consent._id, {
			status: 'approved',
			parentProfileId,
			termsAcceptedAt: now,
			privacyPolicyAcceptedAt: now,
			approvedAt: now,
			termsVersion,
			privacyPolicyVersion,
			wordingKey: PARENT_CONSENT_WORDING_KEY,
			locale: locale && SUPPORTED_CONSENT_LOCALES.has(locale) ? locale : undefined,
			coversParentAccount: true,
			updatedAt: now
		});
		// Link the parent now so emails about the child (e.g. club chat notifications) can deep
		// link straight to /child/[id]. See the parentAccounts.ts module header.
		await ensureParentLink(ctx, parentProfileId, consent.childProfileId);
		await ctx.db.patch(consent.childProfileId, {
			isVerified: true,
			parentProfileId,
			activeClubId: joinedClubId,
			firstLoginCompleted: Boolean(joinedClubId) || childProfile.firstLoginCompleted,
			...(childEmail
				? {
						// Pending: notificationEmailVerifiedAt stays unset until the child confirms.
						notificationEmail: childEmail,
						notificationEmailSetAt: now,
						notificationEmailSetByProfileId: parentProfileId,
						notificationEmailVerifiedAt: undefined,
						notificationEmailSource: 'consent' as const,
						notificationEmailReminderSentAt: undefined
					}
				: {}),
			updatedAt: now
		});
		if (childEmail) {
			// Counts toward the child page's 3-per-24h cap like any other confirmation email (it is
			// the first one, so it can never be refused here).
			await recordRateLimitAttempt(
				ctx,
				childEmailVerificationRateLimitKey(consent.childProfileId),
				CHILD_EMAIL_VERIFICATION_RATE_LIMIT
			);
			await issueChildEmailVerification(ctx, {
				childProfileId: consent.childProfileId,
				email: childEmail,
				requestedByProfileId: parentProfileId
			});
		}
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
		// Lets the consent page sign the parent straight in to the child's overview — their
		// account was just created without credentials. Safe to mint here because the consent
		// token was only ever sent to parentEmail, so holding it already proves possession of
		// that address (the same proof a magic-link email would give).
		// Minted in this mutation, unlike every emailed link (minted in send actions, review S2),
		// because the page needs the link in the approval's own response. Trade-offs, accepted:
		// mutation randomness is a ChaCha12 CSPRNG seeded per execution rather than OS randomness
		// (see magicLinks.ts), and the token is in this mutation's return value (shown on screen,
		// not stored by us). The short lifetime bounds both: the button is pressed within minutes
		// or not at all, and the emails cover a parent who closes the tab.
		const signInUrl = await mintMagicLink(ctx, {
			email: consent.parentEmail,
			callbackPath: `/child/${consent.childProfileId}`,
			expiresInSeconds: CONSENT_SCREEN_MAGIC_LINK_SECONDS
		});
		return {
			success: true,
			// An unverified row under the address was stripped above: to the parent it is new.
			parentAccountCreated: existingParentAuthUser?.emailVerified !== true,
			...(signInUrl ? { signInUrl } : {}),
			...(childEmail ? { childEmail } : {})
		};
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
			.withIndex('by_applicant_profile_id', (q) =>
				q.eq('applicantProfileId', consent.childProfileId)
			)
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
	handler: async (ctx): Promise<{ scanned: number; purged: number; failed: number }> => {
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

// ---------------------------------------------------------------------------------------------
// One-off prod audit (review S3) for consents approved BEFORE approveConsent started stripping
// an adopted unverified account (6fa7edb). Back then approval only flipped `emailVerified` and
// left the registrant's password in place, so whoever pre-registered the parent's address (most
// plausibly the child) may still sign in as the "parent". CLI only:
//   npx convex run childSignup:auditAdoptedParentAccounts --prod
//   npx convex run childSignup:stripAdoptedParentCredentials '{"consentId":"..."}' --prod
// A legitimate adult who signed up with a password and verified BEFORE approving also matches
// (their password predates the approval too): review every row by hand before stripping.
// ---------------------------------------------------------------------------------------------

const ADOPTION_AUDIT_CONSENT_LIMIT = 2000;

type AuthUserRow = { _id: string; createdAt: number };
type CredentialAccountRow = { _id: string; createdAt: number };

// The parent auth user and its password account, when that password predates the approval.
const findCredentialPredatingApproval = async (
	ctx: QueryCtx | MutationCtx,
	consent: Doc<'parentChildConsents'>
) => {
	if (consent.status !== 'approved' || consent.approvedAt === undefined) return null;
	const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'user',
		where: [{ field: 'email', value: normalizeEmail(consent.parentEmail) }]
	})) as AuthUserRow | null;
	if (!user) return null;
	const account = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
		model: 'account',
		where: [
			{ field: 'userId', value: user._id },
			{ field: 'providerId', value: 'credential' }
		]
	})) as CredentialAccountRow | null;
	if (!account || account.createdAt >= consent.approvedAt) return null;
	return { user, account, approvedAt: consent.approvedAt };
};

// Approved consents whose parent auth user has a `credential` account created before
// `approvedAt`: that password was set before anyone proved the address. Output carries ids and
// timestamps only (no emails, no password data).
export const auditAdoptedParentAccounts = internalQuery({
	args: {},
	returns: v.object({
		flagged: v.array(
			v.object({
				consentId: v.id('parentChildConsents'),
				childProfileId: v.id('profiles'),
				parentAuthUserId: v.string(),
				userCreatedAt: v.number(),
				credentialCreatedAt: v.number(),
				approvedAt: v.number()
			})
		),
		scanned: v.number(),
		truncated: v.boolean()
	}),
	handler: async (ctx) => {
		const consents = await ctx.db
			.query('parentChildConsents')
			.withIndex('by_status_and_created_at', (q) => q.eq('status', 'approved'))
			.take(ADOPTION_AUDIT_CONSENT_LIMIT + 1);
		const truncated = consents.length > ADOPTION_AUDIT_CONSENT_LIMIT;
		const scannedConsents = consents.slice(0, ADOPTION_AUDIT_CONSENT_LIMIT);
		const flagged = [];
		for (const consent of scannedConsents) {
			const match = await findCredentialPredatingApproval(ctx, consent);
			if (!match) continue;
			flagged.push({
				consentId: consent._id,
				childProfileId: consent.childProfileId,
				parentAuthUserId: match.user._id,
				userCreatedAt: match.user.createdAt,
				credentialCreatedAt: match.account.createdAt,
				approvedAt: match.approvedAt
			});
		}
		return { flagged, scanned: scannedConsents.length, truncated };
	}
});

// For ONE flagged consent: deletes the parent auth user's `account` rows (password and any
// linked provider) and `session` rows, exactly as approveConsent now does when it adopts an
// unverified user. The user row, profile and parent link stay; the parent signs in by email
// link or sets a password again (Settings, "Set a password"). Refuses a consent that does not
// (or no longer) match the audit, so a mistyped id cannot strip an unrelated account.
export const stripAdoptedParentCredentials = internalMutation({
	args: { consentId: v.id('parentChildConsents') },
	returns: v.object({ parentAuthUserId: v.string() }),
	handler: async (ctx, args) => {
		const consent = await ctx.db.get(args.consentId);
		if (!consent) throw new ConvexError('Consent not found');
		const match = await findCredentialPredatingApproval(ctx, consent);
		if (!match) {
			throw new ConvexError('This consent has no password account that predates its approval');
		}
		await deleteAuthRowsForUser(ctx, match.user._id);
		return { parentAuthUserId: match.user._id };
	}
});
