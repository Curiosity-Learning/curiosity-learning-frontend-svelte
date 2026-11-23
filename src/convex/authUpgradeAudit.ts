import { v } from 'convex/values';
import { components } from './_generated/api';
import { internalAction } from './_generated/server';
import { summarizeBetterAuthUpgradeAudit } from './authUpgradeAuditModel';

// CL-815 pre-deploy check for the Better Auth 1.7 upgrade (read-only; remove after the deploy).
// Internal: CLI only. Only ids and counts come back, never emails. See authUpgradeAuditModel.ts
// for what is reported.
//
// This action only exists on deployments that already run this branch (worktree, preview, dev
// after merge). For prod BEFORE the deploy, use the local script instead, which reads
// `npx convex data` dumps (see docs/security.md, "Before deploying the Better Auth 1.7 upgrade"):
//   node scripts/better-auth-upgrade-audit.ts accounts.jsonl users.jsonl
//   npx convex run authUpgradeAudit:auditBetterAuthUpgrade      (deployments with this branch)
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
		const users: Array<{ _id: string; emailVerified?: boolean }> = [];
		for (let cursor: string | null = null; ; ) {
			const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
				model: 'user',
				where: [],
				paginationOpts: { cursor, numItems: PAGE_SIZE }
			})) as Page<{ _id: string; emailVerified?: boolean }>;
			users.push(...result.page);
			if (result.isDone) break;
			cursor = result.continueCursor;
		}
		return summarizeBetterAuthUpgradeAudit(accounts, users);
	}
});
