/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { internal } from './_generated/api';
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
	options: { createdAt: number; withIncompleteApplication?: boolean }
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
	return { profileId, consentId };
};

describe('purgeExpiredChildConsentData', () => {
	it('purges a consent still pending after 90+ days: consent, profile, notifications, incomplete application', async () => {
		const t = convexTest(schema, modules);
		const now = Date.now();
		const { profileId, consentId } = await t.run((ctx) =>
			seedPendingChild(ctx, {
				createdAt: now - 91 * DAY,
				withIncompleteApplication: true
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
