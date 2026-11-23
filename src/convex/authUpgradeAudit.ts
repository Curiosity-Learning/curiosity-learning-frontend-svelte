import { v } from 'convex/values';
import { components } from './_generated/api';
import { internalAction } from './_generated/server';

// CL-815 pre-deploy check for the Better Auth 1.7 upgrade (read-only; remove after the deploy).
// Run against a deployment BEFORE deploying the upgrade to it:
//   npx convex run authUpgradeAudit:auditBetterAuthUpgrade            (worktree / dev)
//   npx convex run authUpgradeAudit:auditBetterAuthUpgrade --prod     (prod: needs Ron's OK)
// Only ids and counts come back, never emails.
// - duplicateAccountKeys: (providerId, accountId) pairs with more than one account row. The 1.7
//   upgrade guide asks for none: Better Auth 1.7 rejects an account lookup that matches several.
// - unverifiedWithPassword: users whose email was never confirmed but who have a password. On
//   their next magic-link / email-OTP sign-in 1.7 deletes that password (GHSA-qq9h fix), so they
//   will have to reset it.
// - unverifiedWithOtherAccounts: unverified users with a linked non-password account (Google);
//   that link is dropped the same way.
const PAGE_SIZE = 200;

type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };

export const auditBetterAuthUpgrade = internalAction({
	args: {},
	returns: v.object({
		accounts: v.number(),
		users: v.number(),
		duplicateAccountKeys: v.array(
			v.object({ providerId: v.string(), accountId: v.string(), count: v.number() })
		),
		unverifiedWithPassword: v.object({ count: v.number(), userIds: v.array(v.string()) }),
		unverifiedWithOtherAccounts: v.object({ count: v.number(), userIds: v.array(v.string()) })
	}),
	handler: async (ctx) => {
		const accounts: Array<{ providerId: string; accountId: string; userId: string }> = [];
		for (let cursor: string | null = null; ; ) {
			const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
				model: 'account',
				where: [],
				paginationOpts: { cursor, numItems: PAGE_SIZE }
			})) as Page<{ providerId: string; accountId: string; userId: string }>;
			accounts.push(...result.page);
			if (result.isDone) break;
			cursor = result.continueCursor;
		}
		const unverifiedUserIds = new Set<string>();
		let users = 0;
		for (let cursor: string | null = null; ; ) {
			const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
				model: 'user',
				where: [],
				paginationOpts: { cursor, numItems: PAGE_SIZE }
			})) as Page<{ _id: string; emailVerified?: boolean }>;
			users += result.page.length;
			for (const user of result.page) {
				if (user.emailVerified !== true) unverifiedUserIds.add(user._id);
			}
			if (result.isDone) break;
			cursor = result.continueCursor;
		}

		const keyCounts = new Map<string, { providerId: string; accountId: string; count: number }>();
		const withPassword = new Set<string>();
		const withOther = new Set<string>();
		for (const account of accounts) {
			const key = `${account.providerId}\u0000${account.accountId}`;
			const entry = keyCounts.get(key) ?? {
				providerId: account.providerId,
				accountId: account.accountId,
				count: 0
			};
			entry.count += 1;
			keyCounts.set(key, entry);
			if (!unverifiedUserIds.has(account.userId)) continue;
			(account.providerId === 'credential' ? withPassword : withOther).add(account.userId);
		}
		return {
			accounts: accounts.length,
			users,
			duplicateAccountKeys: [...keyCounts.values()].filter((entry) => entry.count > 1),
			unverifiedWithPassword: { count: withPassword.size, userIds: [...withPassword] },
			unverifiedWithOtherAccounts: { count: withOther.size, userIds: [...withOther] }
		};
	}
});
