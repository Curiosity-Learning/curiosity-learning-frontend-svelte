/// <reference types="vite/client" />

import betterAuthTest from '@convex-dev/better-auth/test';
import { hashPassword } from 'better-auth/crypto';
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, components, internal } from './_generated/api';
import type { MutationCtx } from './_generated/server';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

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
	vi.unstubAllEnvs();
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
		const signInUrl = new URL(first.signInUrl!);
		expect(`${signInUrl.origin}${signInUrl.pathname}`).toBe(
			'https://app.example.com/api/auth/magic-link/verify'
		);
		expect(decodeURIComponent(signInUrl.searchParams.get('callbackURL')!)).toBe(
			`/child/${childProfileId}`
		);
		// For the parent account approveConsent just created.
		const verification = (await t.query(components.betterAuth.adapter.findMany, {
			model: 'verification',
			where: [],
			paginationOpts: { cursor: null, numItems: 10 }
		})) as { page: Array<{ value: string }> };
		expect(verification.page.map((row) => JSON.parse(row.value))).toEqual([
			{ email: 'parent@example.com' }
		]);

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
			return { t, approve, rowsFor, signInWithPassword, getParentUser, getParentLinks };
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
			// The registrant's self-chosen identity does not carry over either.
			expect(user?.name).toBe('parent');
			expect(user?.username ?? null).toBeNull();
			// Still the same user, and still linked to the child.
			const { parentProfileId, links } = await getParentLinks();
			expect(parentProfileId).toBeDefined();
			expect(links.map((link) => link.parentProfileId)).toEqual([parentProfileId]);
			// The registrant's password no longer signs in, through the real Better Auth route.
			const signIn = await signInWithPassword();
			expect(signIn.status).toBe(401);
			expect(signIn.headers.get('set-cookie') ?? '').not.toContain('better-auth.session_token=');
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
