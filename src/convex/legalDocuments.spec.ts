import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import { PRIVACY_POLICY_VERSION, privacyPolicyContent } from './legalContent';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const seedPrivacyPolicy = (
	t: ReturnType<typeof convexTest>,
	{ version, content }: { version: string; content: string }
) =>
	t.run(async (ctx) => {
		const now = Date.now();
		await ctx.db.insert('legalDocuments', {
			documentKey: 'privacy_policy',
			fullName: 'Privacy Policy',
			title: 'Privacy Policy',
			content,
			version,
			isActive: true,
			createdAt: now,
			updatedAt: now
		});
	});

describe('legalDocuments.publishBundled', () => {
	it('publishes the bundled privacy policy, which names Sentry, over the previous version', async () => {
		const t = convexTest(schema, modules);
		await seedPrivacyPolicy(t, { version: '1.1', content: 'Old policy without the processor' });

		const result = await t.mutation(internal.legalDocuments.publishBundled, {
			documentKey: 'privacy_policy'
		});
		expect(result).toEqual({
			published: true,
			version: PRIVACY_POLICY_VERSION,
			previousVersion: '1.1'
		});

		const active = await t.query(api.legalDocuments.getActiveByKey, {
			documentKey: 'privacy_policy'
		});
		expect(active).toMatchObject({ version: PRIVACY_POLICY_VERSION, isActive: true });
		expect(active?.content).toBe(privacyPolicyContent);
		expect(active?.content).toContain(
			'Sentry, in its European Union data region, for error monitoring.'
		);

		const all = await t.run((ctx) => ctx.db.query('legalDocuments').collect());
		expect(all.filter((document) => document.isActive)).toHaveLength(1);
	});

	it('does nothing when the bundled version is already active', async () => {
		const t = convexTest(schema, modules);
		await t.mutation(internal.legalDocuments.publishBundled, { documentKey: 'privacy_policy' });

		await expect(
			t.mutation(internal.legalDocuments.publishBundled, { documentKey: 'privacy_policy' })
		).resolves.toEqual({ published: false, version: PRIVACY_POLICY_VERSION });
		const all = await t.run((ctx) => ctx.db.query('legalDocuments').collect());
		expect(all).toHaveLength(1);
	});

	it('refuses changed text under a version that is already published', async () => {
		const t = convexTest(schema, modules);
		await seedPrivacyPolicy(t, { version: PRIVACY_POLICY_VERSION, content: 'Different text' });

		await expect(
			t.mutation(internal.legalDocuments.publishBundled, { documentKey: 'privacy_policy' })
		).rejects.toThrow(/bump the version/);
	});
});
