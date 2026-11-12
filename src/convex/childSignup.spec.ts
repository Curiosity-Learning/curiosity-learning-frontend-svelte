/// <reference types="vite/client" />

import betterAuthTest from '@convex-dev/better-auth/test';
import { hashPassword } from 'better-auth/crypto';
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import schema from './schema';
import { PARENT_CONSENT_WORDING_KEY } from './childSignup';
import { NOTIFICATION_EMAIL_IS_PARENT } from '../lib/domain/child-notification-email';
import {
	CONSENT_SCREEN_MAGIC_LINK_SECONDS,
	isPasswordlessSignInAccount,
	parseMagicLinkInterstitialFragment
} from '../lib/auth/magic-link';

const modules = import.meta.glob('./**/*.ts');

type SentEmail = { to: string; type: string; subject: string; text: string; html: string };

// Only the consent-screen-v2 specs look at sent mail; the rest never send any.
const { sendEmailMock } = vi.hoisted(() => ({
	sendEmailMock: vi.fn<(email: SentEmail) => Promise<{ providerMessageId: string }>>(async () => ({
		providerMessageId: 'resend-msg-1'
	}))
}));

vi.mock('./email/resend', () => ({
	sendEmail: sendEmailMock
}));

const DAY = 24 * 60 * 60 * 1000;
const CONSENT_EXPIRY_MS = 90 * DAY;

// Note: `purgeExpiredChildConsents` (the action that orchestrates the full purge, including
// hard-deleting the Better Auth user via `hardDeleteAuthUser`) is not covered here because the
// betterAuth component is not mounted in convex-test (see authEmail.ts). These specs cover the
// fully-testable Convex-table half instead: `listExpiredPendingConsents` (selection) and
// `purgeExpiredChildConsentData` (deletion), which is where the account-selection logic that
// matters for PRD 6.1.6/8.5 actually lives.

const seedPendingChild = async (
	ctx: MutationCtx,
	options: { createdAt: number; withIncompleteApplication?: boolean; withPendingClubJoin?: boolean }
) => {
	const now = Date.now();
	const profileId = await ctx.db.insert('profiles', {
		authUserId: `child-auth-${options.createdAt}`,
		username: `child_${options.createdAt}`,
		isVerified: false,
		firstLoginCompleted: false,
		updatedAt: now
	});
	const consentId = await ctx.db.insert('parentChildConsents', {
		childProfileId: profileId,
		parentEmail: 'parent@example.com',
		status: 'pending',
		token: `token-${options.createdAt}`,
		createdAt: options.createdAt,
		updatedAt: options.createdAt
	});
	await ctx.db.insert('notifications', {
		profileId,
		title: 'Welcome',
		message: 'Hi',
		isRead: false,
		createdAt: now
	});
	if (options.withIncompleteApplication) {
		await ctx.db.insert('clubApplications', {
			applicantProfileId: profileId,
			status: 'incomplete',
			name: 'Draft club',
			createdAt: now,
			updatedAt: now
		});
	}
	if (options.withPendingClubJoin) {
		const guideProfileId = await ctx.db.insert('profiles', {
			authUserId: `guide-auth-${options.createdAt}`,
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const clubId = await ctx.db.insert('clubs', {
			name: 'Pending Join Club',
			clubCode: `CD${options.createdAt}`.slice(0, 6),
			discoverable: false,
			createdByProfileId: guideProfileId,
			createdAt: now,
			updatedAt: now
		});
		await ctx.db.insert('pendingClubJoins', {
			profileId,
			clubId,
			source: 'code',
			createdAt: now
		});
	}
	return { profileId, consentId };
};

describe('purgeExpiredChildConsentData', () => {
	it('purges a consent still pending after 90+ days: consent, profile, notifications, incomplete application, pending club join', async () => {
		const t = convexTest(schema, modules);
		const now = Date.now();
		const { profileId, consentId } = await t.run((ctx) =>
			seedPendingChild(ctx, {
				createdAt: now - 91 * DAY,
				withIncompleteApplication: true,
				withPendingClubJoin: true
			})
		);

		const olderThan = now - CONSENT_EXPIRY_MS;
		const result = await t.mutation(internal.childSignup.purgeExpiredChildConsentData, {
			consentId,
			olderThan
		});

		expect(result.purged).toBe(true);
		expect(result.authUserId).toBe(`child-auth-${now - 91 * DAY}`);

		await t.run(async (ctx) => {
			expect(await ctx.db.get(consentId)).toBeNull();
			expect(await ctx.db.get(profileId)).toBeNull();
			const notifications = await ctx.db
				.query('notifications')
				.withIndex('by_profile', (q) => q.eq('profileId', profileId))
				.collect();
			expect(notifications).toHaveLength(0);
			const applications = await ctx.db
				.query('clubApplications')
				.withIndex('by_applicant_profile_id', (q) => q.eq('applicantProfileId', profileId))
				.collect();
			expect(applications).toHaveLength(0);
			const pendingJoins = await ctx.db
				.query('pendingClubJoins')
				.withIndex('by_profile', (q) => q.eq('profileId', profileId))
				.collect();
			expect(pendingJoins).toHaveLength(0);
		});
	});

	it('does not purge a consent that is only 89 days old', async () => {
		const t = convexTest(schema, modules);
		const now = Date.now();
		const { profileId, consentId } = await t.run((ctx) =>
			seedPendingChild(ctx, { createdAt: now - 89 * DAY })
		);

		const olderThan = now - CONSENT_EXPIRY_MS;
		const result = await t.mutation(internal.childSignup.purgeExpiredChildConsentData, {
			consentId,
			olderThan
		});

		expect(result.purged).toBe(false);
		await t.run(async (ctx) => {
			expect(await ctx.db.get(consentId)).not.toBeNull();
			expect(await ctx.db.get(profileId)).not.toBeNull();
		});
	});

	it('never purges an approved consent, even if old', async () => {
		const t = convexTest(schema, modules);
		const now = Date.now();
		const { profileId, consentId } = await t.run(async (ctx) => {
			const seeded = await seedPendingChild(ctx, { createdAt: now - 120 * DAY });
			await ctx.db.patch(seeded.consentId, { status: 'approved', approvedAt: now });
			return seeded;
		});

		const olderThan = now - CONSENT_EXPIRY_MS;
		const result = await t.mutation(internal.childSignup.purgeExpiredChildConsentData, {
			consentId,
			olderThan
		});

		expect(result.purged).toBe(false);
		await t.run(async (ctx) => {
			expect(await ctx.db.get(consentId)).not.toBeNull();
			expect(await ctx.db.get(profileId)).not.toBeNull();
		});
	});
});

describe('listExpiredPendingConsents', () => {
	it('selects only pending consents older than the cutoff', async () => {
		const t = convexTest(schema, modules);
		const now = Date.now();
		const { consentId: expiredId } = await t.run((ctx) =>
			seedPendingChild(ctx, { createdAt: now - 91 * DAY })
		);
		await t.run((ctx) => seedPendingChild(ctx, { createdAt: now - 89 * DAY }));
		await t.run(async (ctx) => {
			const seeded = await seedPendingChild(ctx, { createdAt: now - 120 * DAY });
			await ctx.db.patch(seeded.consentId, { status: 'approved', approvedAt: now });
		});

		const olderThan = now - CONSENT_EXPIRY_MS;
		const results = await t.query(internal.childSignup.listExpiredPendingConsents, {
			olderThan
		});

		expect(results).toHaveLength(1);
		expect(results[0].consentId).toBe(expiredId);
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	sendEmailMock.mockClear();
});

describe('approveConsent', () => {
	// approveConsent finds-or-creates the parent's Better Auth user through the component adapter,
	// so this one mounts the real betterAuth component (its shipped test helper) instead of mocking.
	it('links the parent to the child, so the parent can read the child overview straight away', async () => {
		const t = convexTest(schema, modules);
		betterAuthTest.register(t);
		const now = Date.now();
		const childAuthUser = (await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'user',
				data: {
					email: 'kid@children.curiosity.local',
					emailVerified: false,
					name: 'Kid',
					createdAt: now,
					updatedAt: now
				}
			}
		})) as { _id: string };
		const { profileId: childProfileId } = await t.run(async (ctx) => {
			const seeded = await seedPendingChild(ctx, { createdAt: now });
			await ctx.db.patch(seeded.profileId, { authUserId: childAuthUser._id });
			return seeded;
		});

		await t.mutation(api.childSignup.approveConsent, {
			token: `token-${now}`,
			acceptedTerms: true,
			acceptedPrivacyPolicy: true
		});

		const { parentProfileId, parentAuthUserId, links } = await t.run(async (ctx) => {
			const consent = await ctx.db
				.query('parentChildConsents')
				.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', childProfileId))
				.unique();
			const parentProfile = consent?.parentProfileId
				? await ctx.db.get(consent.parentProfileId)
				: null;
			return {
				parentProfileId: parentProfile?._id,
				parentAuthUserId: parentProfile?.authUserId,
				links: await ctx.db
					.query('parentLinks')
					.withIndex('by_child', (q) => q.eq('childProfileId', childProfileId))
					.collect()
			};
		});
		expect(parentProfileId).toBeDefined();
		expect(parentAuthUserId).toBeDefined();
		expect(links).toHaveLength(1);
		expect(links[0].parentProfileId).toBe(parentProfileId);

		const overview = await t
			.withIdentity({ subject: parentAuthUserId! })
			.query(api.parentAccounts.getChildOverview, { childProfileId });
		expect(overview.childProfileId).toBe(childProfileId);
	});

	// The consent page offers to sign the parent straight in: their account was just created
	// without credentials. Only the approval itself gets a link — the consent token stays valid,
	// so a link on every revisit would make the consent email a permanent login link.
	it('returns a one-time sign-in link to the child overview on the first approval only', async () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const t = convexTest(schema, modules);
		betterAuthTest.register(t);
		const now = Date.now();
		const childAuthUser = (await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'user',
				data: {
					email: 'kid@children.curiosity.local',
					emailVerified: false,
					name: 'Kid',
					createdAt: now,
					updatedAt: now
				}
			}
		})) as { _id: string };
		const { profileId: childProfileId } = await t.run(async (ctx) => {
			const seeded = await seedPendingChild(ctx, { createdAt: now });
			await ctx.db.patch(seeded.profileId, { authUserId: childAuthUser._id });
			return seeded;
		});
		const approve = () =>
			t.mutation(api.childSignup.approveConsent, {
				token: `token-${now}`,
				acceptedTerms: true,
				acceptedPrivacyPolicy: true
			});

		const first = await approve();
		expect(first.success).toBe(true);
		// Through the /auth/link interstitial, like every sign-in link (review S1).
		const signInUrl = new URL(first.signInUrl!);
		expect(`${signInUrl.origin}${signInUrl.pathname}`).toBe('https://app.example.com/auth/link');
		expect(parseMagicLinkInterstitialFragment(signInUrl.hash)?.next).toBe(
			`/child/${childProfileId}`
		);
		// For the parent account approveConsent just created.
		const verification = (await t.query(components.betterAuth.adapter.findMany, {
			model: 'verification',
			where: [],
			paginationOpts: { cursor: null, numItems: 10 }
		})) as { page: Array<{ value: string; expiresAt: number }> };
		expect(verification.page.map((row) => JSON.parse(row.value))).toEqual([
			{ email: 'parent@example.com' }
		]);
		// Shown on screen right after approval: 30 minutes (review S3).
		expect(verification.page[0].expiresAt).toBeLessThanOrEqual(
			Date.now() + CONSENT_SCREEN_MAGIC_LINK_SECONDS * 1000
		);
		expect(CONSENT_SCREEN_MAGIC_LINK_SECONDS).toBe(30 * 60);

		const revisit = await approve();
		expect(revisit).toEqual({ success: true });
	});

	// CL-768 (review B1): someone (most plausibly the child) can register an adult account under
	// the parent's address with a password of their own and never verify it. Approving consent
	// must not turn that into a verified parent account they can sign in to.
	describe('an existing account under the parent address', () => {
		const stubAuthEnv = () => {
			vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
			vi.stubEnv('CONVEX_SITE_URL', 'https://site.example.com');
			vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-'.repeat(4));
		};
		const PASSWORD = 'pre-registered-password-1';

		const setup = async (options: { parentVerified: boolean }) => {
			stubAuthEnv();
			const t = convexTest(schema, modules);
			betterAuthTest.register(t);
			const now = Date.now();
			const childAuthUser = (await t.mutation(components.betterAuth.adapter.create, {
				input: {
					model: 'user',
					data: {
						email: 'kid@children.curiosity.local',
						emailVerified: false,
						name: 'Kid',
						createdAt: now,
						updatedAt: now
					}
				}
			})) as { _id: string };
			const parentUser = (await t.mutation(components.betterAuth.adapter.create, {
				input: {
					model: 'user',
					data: {
						email: 'parent@example.com',
						emailVerified: options.parentVerified,
						name: 'Chosen By Registrant',
						username: 'sneaky_kid',
						displayUsername: 'sneaky_kid',
						createdAt: now,
						updatedAt: now
					}
				}
			})) as { _id: string };
			// What /sign-up/email leaves behind: a credential account with the registrant's password.
			await t.mutation(components.betterAuth.adapter.create, {
				input: {
					model: 'account',
					data: {
						accountId: parentUser._id,
						providerId: 'credential',
						userId: parentUser._id,
						password: await hashPassword(PASSWORD),
						createdAt: now,
						updatedAt: now
					}
				}
			});
			for (const token of ['session-one', 'session-two']) {
				await t.mutation(components.betterAuth.adapter.create, {
					input: {
						model: 'session',
						data: {
							token,
							userId: parentUser._id,
							expiresAt: now + DAY,
							createdAt: now,
							updatedAt: now
						}
					}
				});
			}
			const { profileId: childProfileId } = await t.run(async (ctx) => {
				const seeded = await seedPendingChild(ctx, { createdAt: now });
				await ctx.db.patch(seeded.profileId, { authUserId: childAuthUser._id });
				return seeded;
			});
			const approve = () =>
				t.mutation(api.childSignup.approveConsent, {
					token: `token-${now}`,
					acceptedTerms: true,
					acceptedPrivacyPolicy: true
				});
			const rowsFor = async (model: 'account' | 'session') =>
				(
					(await t.query(components.betterAuth.adapter.findMany, {
						model,
						where: [{ field: 'userId', value: parentUser._id }],
						paginationOpts: { cursor: null, numItems: 10 }
					})) as { page: unknown[] }
				).page;
			const signInWithPassword = () =>
				t.fetch('/api/auth/sign-in/email', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ email: 'parent@example.com', password: PASSWORD })
				});
			const getParentUser = () =>
				t.query(components.betterAuth.adapter.findOne, {
					model: 'user',
					where: [{ field: '_id', value: parentUser._id }]
				}) as Promise<{
					emailVerified: boolean;
					name: string;
					username?: string | null;
				} | null>;
			const getParentLinks = () =>
				t.run(async (ctx) => {
					const parentProfile = await ctx.db
						.query('profiles')
						.withIndex('by_auth_user_id', (q) => q.eq('authUserId', parentUser._id))
						.unique();
					const links = await ctx.db
						.query('parentLinks')
						.withIndex('by_child', (q) => q.eq('childProfileId', childProfileId))
						.collect();
					return { parentProfileId: parentProfile?._id, links };
				});
			return { t, now, approve, rowsFor, signInWithPassword, getParentUser, getParentLinks };
		};

		it('an unverified one loses its password and sessions before it becomes the parent account', async () => {
			const { approve, rowsFor, signInWithPassword, getParentUser, getParentLinks } = await setup({
				parentVerified: false
			});
			expect(await rowsFor('account')).toHaveLength(1);
			expect(await rowsFor('session')).toHaveLength(2);

			await approve();

			expect(await rowsFor('account')).toHaveLength(0);
			expect(await rowsFor('session')).toHaveLength(0);
			const user = await getParentUser();
			expect(user?.emailVerified).toBe(true);
			// The registrant's self-chosen name does not carry over either. The username stays (see
			// the second-adoption test below); with no password account it cannot sign in.
			expect(user?.name).toBe('parent');
			// Still the same user, and still linked to the child.
			const { parentProfileId, links } = await getParentLinks();
			expect(parentProfileId).toBeDefined();
			expect(links.map((link) => link.parentProfileId)).toEqual([parentProfileId]);
			// The registrant's password no longer signs in, through the real Better Auth route.
			const signIn = await signInWithPassword();
			expect(signIn.status).toBe(401);
			expect(signIn.headers.get('set-cookie') ?? '').not.toContain('better-auth.session_token=');
		});

		// Found in QA on CL-784: the first version cleared `username` to null, and the auth adapter's
		// uniqueness check treats null as a value, so the second adoption on a deployment threw
		// "user username already exists" and that child stayed pending.
		it('a second unverified account on the same deployment is adopted too', async () => {
			const { t, now, approve } = await setup({ parentVerified: false });
			await approve();

			const laterAt = now + 1;
			const secondParent = (await t.mutation(components.betterAuth.adapter.create, {
				input: {
					model: 'user',
					data: {
						email: 'second-parent@example.com',
						emailVerified: false,
						name: 'Also Chosen By A Registrant',
						username: 'sneaky_two',
						displayUsername: 'sneaky_two',
						createdAt: laterAt,
						updatedAt: laterAt
					}
				}
			})) as { _id: string };
			await t.mutation(components.betterAuth.adapter.create, {
				input: {
					model: 'account',
					data: {
						accountId: secondParent._id,
						providerId: 'credential',
						userId: secondParent._id,
						password: await hashPassword(PASSWORD),
						createdAt: laterAt,
						updatedAt: laterAt
					}
				}
			});
			const secondChildAuthUser = (await t.mutation(components.betterAuth.adapter.create, {
				input: {
					model: 'user',
					data: {
						email: 'kid-two@children.curiosity.local',
						emailVerified: false,
						name: 'Kid Two',
						createdAt: laterAt,
						updatedAt: laterAt
					}
				}
			})) as { _id: string };
			const secondChildProfileId = await t.run(async (ctx) => {
				const seeded = await seedPendingChild(ctx, { createdAt: laterAt });
				await ctx.db.patch(seeded.profileId, { authUserId: secondChildAuthUser._id });
				await ctx.db.patch(seeded.consentId, { parentEmail: 'second-parent@example.com' });
				return seeded.profileId;
			});

			await t.mutation(api.childSignup.approveConsent, {
				token: `token-${laterAt}`,
				acceptedTerms: true,
				acceptedPrivacyPolicy: true
			});

			const accounts = (await t.query(components.betterAuth.adapter.findMany, {
				model: 'account',
				where: [{ field: 'userId', value: secondParent._id }],
				paginationOpts: { cursor: null, numItems: 10 }
			})) as { page: unknown[] };
			expect(accounts.page).toHaveLength(0);
			const second = (await t.query(components.betterAuth.adapter.findOne, {
				model: 'user',
				where: [{ field: '_id', value: secondParent._id }]
			})) as { emailVerified: boolean; name: string } | null;
			expect(second?.emailVerified).toBe(true);
			expect(second?.name).toBe('second-parent');
			const child = await t.run((ctx) => ctx.db.get(secondChildProfileId));
			expect(child?.isVerified).toBe(true);
		});

		it('a verified one is adopted unchanged: password, sessions and name stay', async () => {
			const { approve, rowsFor, signInWithPassword, getParentUser, getParentLinks } = await setup({
				parentVerified: true
			});

			await approve();

			expect(await rowsFor('account')).toHaveLength(1);
			expect(await rowsFor('session')).toHaveLength(2);
			const user = await getParentUser();
			expect(user?.emailVerified).toBe(true);
			expect(user?.name).toBe('Chosen By Registrant');
			const { parentProfileId, links } = await getParentLinks();
			expect(links.map((link) => link.parentProfileId)).toEqual([parentProfileId]);
			// Control for the test above: the same sign-in works for a genuinely verified owner.
			const signIn = await signInWithPassword();
			expect(signIn.status).toBe(200);
			expect(signIn.headers.get('set-cookie')).toContain('better-auth.session_token=');
		});
	});
});

// Consent screen v2 (CL-769, review S12/S13/D8/D9, edge case 1): the optional child email chosen
// on the consent screen, and what the approval records.
describe('approveConsent: consent screen v2', () => {
	const setup = async () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const t = convexTest(schema, modules);
		betterAuthTest.register(t);
		// A second child for the same parent (a sibling) gets its own createdAt, hence token.
		const seedChild = async (createdAt: number) => {
			const childAuthUser = (await t.mutation(components.betterAuth.adapter.create, {
				input: {
					model: 'user',
					data: {
						email: `kid${createdAt}@children.curiosity.local`,
						emailVerified: false,
						name: 'Kid',
						createdAt,
						updatedAt: createdAt
					}
				}
			})) as { _id: string };
			const { profileId } = await t.run(async (ctx) => {
				const seeded = await seedPendingChild(ctx, { createdAt });
				await ctx.db.patch(seeded.profileId, { authUserId: childAuthUser._id });
				return seeded;
			});
			return { childProfileId: profileId, token: `token-${createdAt}` };
		};
		const approve = (token: string, extra: { childEmail?: string; locale?: string } = {}) =>
			t.mutation(api.childSignup.approveConsent, {
				token,
				acceptedTerms: true,
				acceptedPrivacyPolicy: true,
				...extra
			});
		const consentFor = (childProfileId: Id<'profiles'>) =>
			t.run((ctx) =>
				ctx.db
					.query('parentChildConsents')
					.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', childProfileId))
					.unique()
			);
		const settle = () => t.finishAllScheduledFunctions(vi.runAllTimers);
		const sent = () => sendEmailMock.mock.calls.map(([email]) => email);
		return { t, seedChild, approve, consentFor, settle, sent };
	};

	it('with no child email: routing is untouched and only the parent hears about the child', async () => {
		const { t, seedChild, approve, consentFor, settle, sent } = await setup();
		const { childProfileId, token } = await seedChild(Date.now());
		vi.useFakeTimers();

		const result = await approve(token, { locale: 'nl' });
		expect(result.childEmail).toBeUndefined();
		expect(result.parentAccountCreated).toBe(true);
		await settle();

		const child = await t.run((ctx) => ctx.db.get(childProfileId));
		expect(child?.notificationEmail).toBeUndefined();
		expect(child?.notificationEmailSource).toBeUndefined();
		expect(await t.run((ctx) => ctx.db.query('childEmailVerifications').collect())).toEqual([]);
		expect(sent()).toEqual([]);
		expect((await consentFor(childProfileId))?.locale).toBe('nl');
	});

	it('with a child email: stores it PENDING from the consent, emails it a confirmation, sends the parent no routing notice', async () => {
		const { t, seedChild, approve, consentFor, settle, sent } = await setup();
		const { childProfileId, token } = await seedChild(Date.now());
		vi.useFakeTimers();

		const result = await approve(token, { childEmail: '  Kid.Own@Example.com ' });
		expect(result.childEmail).toBe('kid.own@example.com');
		await settle();

		const parentProfileId = (await consentFor(childProfileId))?.parentProfileId;
		const child = await t.run((ctx) => ctx.db.get(childProfileId));
		expect(child?.notificationEmail).toBe('kid.own@example.com');
		expect(child?.notificationEmailVerifiedAt).toBeUndefined();
		expect(child?.notificationEmailSource).toBe('consent');
		expect(child?.notificationEmailSetAt).toEqual(expect.any(Number));
		expect(child?.notificationEmailSetByProfileId).toBe(parentProfileId);

		// The same confirmation path as the child page (childEmailVerification.ts): one row, hash
		// only, and the generic confirmation email.
		const rows = await t.run((ctx) => ctx.db.query('childEmailVerifications').collect());
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			childProfileId,
			email: 'kid.own@example.com',
			requestedByProfileId: parentProfileId,
			tokenHash: expect.any(String)
		});
		expect(sent().map((email) => [email.type, email.to])).toEqual([
			['child-email-verification', 'kid.own@example.com']
		]);
		expect(sent()[0].text).toMatch(/https:\/\/app\.example\.com\/verify-email\/[a-zA-Z]+/);
		// Counts toward the 3-per-24h confirmation cap.
		const attempts = await t.run((ctx) => ctx.db.query('rateLimits').collect());
		expect(attempts.map((row) => row.key)).toEqual([`childEmailVerification:${childProfileId}`]);
	});

	for (const [label, childEmail] of [
		["the parent's own address (any case)", 'PARENT@example.com'],
		['an invalid address', 'not-an-email'],
		['the synthetic child domain', 'kid@children.curiosity.local']
	] as const) {
		it(`refuses ${label} before writing anything: the consent stays pending`, async () => {
			const { t, seedChild, approve, consentFor, settle, sent } = await setup();
			const { childProfileId, token } = await seedChild(Date.now());

			const failure = approve(token, { childEmail });
			await expect(failure).rejects.toThrow(ConvexError);
			if (childEmail === 'PARENT@example.com') {
				await expect(failure).rejects.toThrow(NOTIFICATION_EMAIL_IS_PARENT);
			}
			vi.useFakeTimers();
			await settle();

			expect((await consentFor(childProfileId))?.status).toBe('pending');
			const child = await t.run((ctx) => ctx.db.get(childProfileId));
			expect(child?.isVerified).toBe(false);
			expect(child?.notificationEmail).toBeUndefined();
			// Not even the parent account was created.
			expect(
				await t.query(components.betterAuth.adapter.findOne, {
					model: 'user',
					where: [{ field: 'email', value: 'parent@example.com' }]
				})
			).toBeNull();
			expect(sent()).toEqual([]);

			// The parent fixes it and approves again.
			const retry = await approve(token);
			expect(retry.signInUrl).toEqual(expect.any(String));
			expect((await consentFor(childProfileId))?.status).toBe('approved');
		});
	}

	it('records what was agreed to on the consent, and on the parent profile only the first time', async () => {
		const { t, seedChild, approve, consentFor } = await setup();
		await t.run(async (ctx) => {
			const now = Date.now();
			for (const [documentKey, fullName, version] of [
				['terms_and_conditions', 'Terms and Conditions', '2026-09'],
				['privacy_policy', 'Privacy Policy', '2026-10']
			] as const) {
				await ctx.db.insert('legalDocuments', {
					documentKey,
					fullName,
					title: fullName,
					content: '...',
					version,
					isActive: true,
					createdAt: now,
					updatedAt: now
				});
			}
		});
		vi.useFakeTimers();
		const firstAt = new Date('2026-11-01T10:00:00Z').getTime();
		vi.setSystemTime(firstAt);
		const first = await seedChild(firstAt);
		await approve(first.token, { locale: 'en' });

		const firstConsent = await consentFor(first.childProfileId);
		expect(firstConsent).toMatchObject({
			status: 'approved',
			termsAcceptedAt: firstAt,
			privacyPolicyAcceptedAt: firstAt,
			termsVersion: '2026-09',
			privacyPolicyVersion: '2026-10',
			wordingKey: PARENT_CONSENT_WORDING_KEY,
			locale: 'en',
			coversParentAccount: true
		});
		expect(PARENT_CONSENT_WORDING_KEY).toBe('parentConsent.v2.combined');
		const parentProfileId = firstConsent!.parentProfileId!;
		const expectedParentRecord = {
			termsAcceptedAt: firstAt,
			termsVersion: '2026-09',
			privacyPolicyAcceptedAt: firstAt,
			privacyPolicyVersion: '2026-10'
		};
		expect(await t.run((ctx) => ctx.db.get(parentProfileId))).toMatchObject(expectedParentRecord);

		// A sibling approved later, under newer documents: the sibling's consent records the new
		// versions, the parent's earliest acceptance stays.
		await t.run(async (ctx) => {
			const terms = await ctx.db
				.query('legalDocuments')
				.withIndex('by_document_key_and_active', (q) =>
					q.eq('documentKey', 'terms_and_conditions').eq('isActive', true)
				)
				.unique();
			await ctx.db.patch(terms!._id, { version: '2026-12' });
		});
		const secondAt = firstAt + 7 * DAY;
		vi.setSystemTime(secondAt);
		const second = await seedChild(secondAt);
		const secondResult = await approve(second.token, { locale: 'xx-unknown' });
		expect(secondResult.parentAccountCreated).toBe(false);

		const secondConsent = await consentFor(second.childProfileId);
		expect(secondConsent).toMatchObject({
			parentProfileId,
			termsAcceptedAt: secondAt,
			termsVersion: '2026-12',
			coversParentAccount: true
		});
		// Unsupported locales are not stored.
		expect(secondConsent?.locale).toBeUndefined();
		expect(await t.run((ctx) => ctx.db.get(parentProfileId))).toMatchObject(expectedParentRecord);
	});

	it("falls back to 'unversioned' without published legal documents, and keeps an existing adult's earlier acceptance", async () => {
		const { t, seedChild, approve, consentFor } = await setup();
		const now = Date.now();
		const parentUser = (await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'user',
				data: {
					email: 'parent@example.com',
					emailVerified: true,
					name: 'Existing Adult',
					createdAt: now,
					updatedAt: now
				}
			}
		})) as { _id: string };
		const parentProfileId = await t.run((ctx) =>
			ctx.db.insert('profiles', {
				authUserId: parentUser._id,
				isVerified: true,
				firstLoginCompleted: true,
				// Accepted the Terms before, with no recorded privacy acceptance.
				termsAcceptedAt: now - 100 * DAY,
				termsVersion: 'v1',
				updatedAt: now
			})
		);
		const { childProfileId, token } = await seedChild(now);

		const result = await approve(token);
		expect(result.parentAccountCreated).toBe(false);

		expect(await consentFor(childProfileId)).toMatchObject({
			parentProfileId,
			termsVersion: 'unversioned',
			privacyPolicyVersion: 'unversioned'
		});
		const parent = await t.run((ctx) => ctx.db.get(parentProfileId));
		expect(parent?.termsAcceptedAt).toBe(now - 100 * DAY);
		expect(parent?.termsVersion).toBe('v1');
		expect(parent?.privacyPolicyAcceptedAt).toEqual(expect.any(Number));
		expect(parent?.privacyPolicyVersion).toBe('unversioned');
	});

	it('returns a sign-in link only on the first approval; a revisit with a child email changes nothing', async () => {
		const { t, seedChild, approve } = await setup();
		const { childProfileId, token } = await seedChild(Date.now());

		const first = await approve(token);
		expect(first.signInUrl).toEqual(expect.any(String));

		const revisit = await approve(token, { childEmail: 'kid.own@example.com' });
		expect(revisit).toEqual({ success: true });
		const child = await t.run((ctx) => ctx.db.get(childProfileId));
		expect(child?.notificationEmail).toBeUndefined();
	});
});

// What a freshly approved parent sees after signing in: Settings offers "Set a password" (review
// S8/D8) and a club-less parent lands on the child's page (edge case 14).
describe('the parent account after approval', () => {
	it('has no password (Settings offers to set one) and lands on its first linked child', async () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
		const t = convexTest(schema, modules);
		betterAuthTest.register(t);
		const now = Date.now();
		const childAuthUser = (await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'user',
				data: {
					email: 'kid@children.curiosity.local',
					emailVerified: false,
					name: 'Kid',
					createdAt: now,
					updatedAt: now
				}
			}
		})) as { _id: string };
		const { profileId: childProfileId } = await t.run(async (ctx) => {
			const seeded = await seedPendingChild(ctx, { createdAt: now });
			await ctx.db.patch(seeded.profileId, { authUserId: childAuthUser._id });
			return seeded;
		});
		await t.mutation(api.childSignup.approveConsent, {
			token: `token-${now}`,
			acceptedTerms: true,
			acceptedPrivacyPolicy: true
		});
		const parentUser = (await t.query(components.betterAuth.adapter.findOne, {
			model: 'user',
			where: [{ field: 'email', value: 'parent@example.com' }]
		})) as { _id: string };
		const parent = t.withIdentity({ subject: parentUser._id });
		const child = t.withIdentity({ subject: childAuthUser._id });

		expect(await parent.query(api.auth.getMySignInMethods, {})).toEqual({
			hasPassword: false,
			hasGoogle: false,
			isChildAccount: false
		});
		// Review S9: so the sign-in page offers "Email me a sign-in link" for this address.
		expect(
			isPasswordlessSignInAccount(
				await t.query(api.auth.getSignupAccountStatusByEmail, { email: 'Parent@Example.com' })
			)
		).toBe(true);
		// The child has a password and is never offered the card.
		await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'account',
				data: {
					accountId: childAuthUser._id,
					providerId: 'credential',
					userId: childAuthUser._id,
					password: await hashPassword('child-password-1'),
					createdAt: now,
					updatedAt: now
				}
			}
		});
		expect(await child.query(api.auth.getMySignInMethods, {})).toMatchObject({
			hasPassword: true,
			isChildAccount: true
		});
		// Once the reset flow has created the parent's credential account, the card goes away.
		await t.mutation(components.betterAuth.adapter.create, {
			input: {
				model: 'account',
				data: {
					accountId: parentUser._id,
					providerId: 'credential',
					userId: parentUser._id,
					password: await hashPassword('parent-password-1'),
					createdAt: now,
					updatedAt: now
				}
			}
		});
		expect((await parent.query(api.auth.getMySignInMethods, {})).hasPassword).toBe(true);
		expect(
			isPasswordlessSignInAccount(
				await t.query(api.auth.getSignupAccountStatusByEmail, { email: 'parent@example.com' })
			)
		).toBe(false);

		expect(await parent.query(api.parentAccounts.getMyFirstLinkedChildId, {})).toBe(childProfileId);
		expect(await child.query(api.parentAccounts.getMyFirstLinkedChildId, {})).toBeNull();
		expect(await t.query(api.parentAccounts.getMyFirstLinkedChildId, {})).toBeNull();
	});
});

// Review S3: consents approved before approveConsent stripped adopted accounts may have left the
// registrant's password on the parent account. The audit lists them (ids and timestamps only);
// the strip removes the account and session rows for one flagged consent.
describe('auditAdoptedParentAccounts / stripAdoptedParentCredentials', () => {
	const createUser = async (t: ReturnType<typeof convexTest>, email: string, createdAt: number) =>
		(
			(await t.mutation(components.betterAuth.adapter.create, {
				input: {
					model: 'user',
					data: { email, emailVerified: true, name: email, createdAt, updatedAt: createdAt }
				}
			})) as { _id: string }
		)._id;
	const createRow = (
		t: ReturnType<typeof convexTest>,
		model: 'account' | 'session',
		userId: string,
		createdAt: number
	) =>
		model === 'account'
			? t.mutation(components.betterAuth.adapter.create, {
					input: {
						model: 'account',
						data: {
							accountId: userId,
							providerId: 'credential',
							userId,
							password: 'hash',
							createdAt,
							updatedAt: createdAt
						}
					}
				})
			: t.mutation(components.betterAuth.adapter.create, {
					input: {
						model: 'session',
						data: {
							token: `session-${userId}-${createdAt}`,
							userId,
							expiresAt: createdAt + 30 * DAY,
							createdAt,
							updatedAt: createdAt
						}
					}
				});
	const countRows = async (t: ReturnType<typeof convexTest>, model: 'account' | 'session') =>
		(
			(await t.query(components.betterAuth.adapter.findMany, {
				model,
				paginationOpts: { cursor: null, numItems: 100 }
			})) as { page: unknown[] }
		).page.length;

	const seed = async () => {
		const t = convexTest(schema, modules);
		betterAuthTest.register(t);
		const approvedAt = Date.now();
		// Pre-registered before approval, password from then: flagged.
		const adoptedUserId = await createUser(t, 'adopted@example.com', approvedAt - 5 * DAY);
		await createRow(t, 'account', adoptedUserId, approvedAt - 5 * DAY);
		await createRow(t, 'session', adoptedUserId, approvedAt - DAY);
		// Created password-less at approval, password set afterwards: not flagged.
		const laterUserId = await createUser(t, 'later@example.com', approvedAt);
		await createRow(t, 'account', laterUserId, approvedAt + DAY);
		// A pending consent is never flagged.
		const pendingUserId = await createUser(t, 'pending@example.com', approvedAt - 5 * DAY);
		await createRow(t, 'account', pendingUserId, approvedAt - 5 * DAY);
		const ids = await t.run(async (ctx) => {
			const insertConsent = async (parentEmail: string, approved: boolean) => {
				const childProfileId = await ctx.db.insert('profiles', {
					authUserId: `child-${parentEmail}`,
					isVerified: true,
					firstLoginCompleted: true,
					updatedAt: approvedAt
				});
				const consentId = await ctx.db.insert('parentChildConsents', {
					childProfileId,
					parentEmail,
					status: approved ? 'approved' : 'pending',
					token: `token-${parentEmail}`,
					...(approved ? { approvedAt } : {}),
					createdAt: approvedAt - 6 * DAY,
					updatedAt: approvedAt
				});
				return { childProfileId, consentId };
			};
			return {
				adopted: await insertConsent('Adopted@example.com', true),
				later: await insertConsent('later@example.com', true),
				pending: await insertConsent('pending@example.com', false)
			};
		});
		return { t, approvedAt, adoptedUserId, ...ids };
	};

	it('lists only approved consents whose password predates the approval, without emails', async () => {
		const { t, approvedAt, adoptedUserId, adopted } = await seed();
		const result = await t.query(internal.childSignup.auditAdoptedParentAccounts, {});
		expect(result).toEqual({
			flagged: [
				{
					consentId: adopted.consentId,
					childProfileId: adopted.childProfileId,
					parentAuthUserId: adoptedUserId,
					userCreatedAt: approvedAt - 5 * DAY,
					credentialCreatedAt: approvedAt - 5 * DAY,
					approvedAt
				}
			],
			scanned: 2,
			truncated: false
		});
		expect(JSON.stringify(result)).not.toContain('@');
	});

	it("strips one flagged consent's account and session rows, and refuses an unflagged one", async () => {
		const { t, adopted, later } = await seed();
		expect(await countRows(t, 'account')).toBe(3);
		expect(await countRows(t, 'session')).toBe(1);

		await t.mutation(internal.childSignup.stripAdoptedParentCredentials, {
			consentId: adopted.consentId
		});
		expect(await countRows(t, 'account')).toBe(2);
		expect(await countRows(t, 'session')).toBe(0);
		expect((await t.query(internal.childSignup.auditAdoptedParentAccounts, {})).flagged).toEqual(
			[]
		);

		await expect(
			t.mutation(internal.childSignup.stripAdoptedParentCredentials, {
				consentId: later.consentId
			})
		).rejects.toThrow('no password account that predates its approval');
		expect(await countRows(t, 'account')).toBe(2);
	});
});
