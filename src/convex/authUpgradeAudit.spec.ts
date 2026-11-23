/// <reference types="vite/client" />

import betterAuthTest from '@convex-dev/better-auth/test';
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { components, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

describe('auditBetterAuthUpgrade (CL-815 pre-deploy check)', () => {
	it('reports unverified users with a password or a linked account', async () => {
		const t = convexTest(schema, modules);
		betterAuthTest.register(t);
		const now = Date.now();
		const createUser = async (email: string, emailVerified: boolean) =>
			(
				(await t.mutation(components.betterAuth.adapter.create, {
					input: {
						model: 'user',
						data: { email, emailVerified, name: email, createdAt: now, updatedAt: now }
					}
				})) as { _id: string }
			)._id;
		const createAccount = (userId: string, providerId: string, accountId: string) =>
			t.mutation(components.betterAuth.adapter.create, {
				input: {
					model: 'account',
					data: { userId, providerId, accountId, createdAt: now, updatedAt: now }
				}
			});
		const verified = await createUser('ok@example.com', true);
		const unverifiedPassword = await createUser('pw@example.com', false);
		const unverifiedGoogle = await createUser('g@example.com', false);
		await createAccount(verified, 'credential', verified);
		await createAccount(verified, 'google', 'sub-1');
		await createAccount(unverifiedPassword, 'credential', unverifiedPassword);
		// Component 0.13 already refuses a duplicate (providerId, accountId) on write, so legacy
		// duplicates cannot be seeded here; the audit is for rows written before the upgrade.
		await createAccount(unverifiedGoogle, 'google', 'sub-2');

		const result = await t.action(internal.authUpgradeAudit.auditBetterAuthUpgrade, {});

		expect(result).toEqual({
			accounts: 4,
			users: 3,
			duplicateAccountKeys: [],
			unverifiedWithPassword: { count: 1, userIds: [unverifiedPassword] },
			unverifiedWithOtherAccounts: { count: 1, userIds: [unverifiedGoogle] }
		});
	});
});
