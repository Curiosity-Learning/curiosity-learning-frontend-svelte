/// <reference types="vite/client" />

import betterAuthTest from '@convex-dev/better-auth/test';
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
});
