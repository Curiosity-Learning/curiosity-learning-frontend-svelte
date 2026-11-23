// CL-815: the Better Auth 1.7 pre-deploy data check, as a pure function shared by the internal
// action (authUpgradeAudit.ts, runs on a deployment that already has this branch) and the local
// script scripts/better-auth-upgrade-audit.ts (reads `npx convex data` dumps, so it works
// against prod BEFORE the deploy). No imports: Node runs this file directly.

export type AuditAccount = { providerId: string; accountId: string; userId: string };
export type AuditUser = { _id: string; emailVerified?: boolean };

export const summarizeBetterAuthUpgradeAudit = (accounts: AuditAccount[], users: AuditUser[]) => {
	const unverifiedUserIds = new Set(
		users.filter((user) => user.emailVerified !== true).map((user) => user._id)
	);
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
		users: users.length,
		duplicateAccountKeys: [...keyCounts.values()].filter((entry) => entry.count > 1),
		unverifiedWithPassword: { count: withPassword.size, userIds: [...withPassword] },
		unverifiedWithOtherAccounts: { count: withOther.size, userIds: [...withOther] }
	};
};
