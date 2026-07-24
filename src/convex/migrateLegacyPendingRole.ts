import { internalMutation } from './_generated/server';

// The pre-PRD-5.6 pendingClubCode/pendingRole deferral mechanism on profiles was replaced by
// the pendingClubJoins table; dev data was cleaned up in place, but prod profiles (14 rows as
// of 2026-07-24) still carry pendingRole. Prod has no clubs yet, so these stale intents are
// meaningless — just unset the fields.
//
// Run once per deployment that still has legacy rows:
//   npx convex run migrateLegacyPendingRole:run --prod
// Safe to re-run (idempotent). Delete this file — and the transitional
// pendingClubCode/pendingRole declarations in schema.ts — once prod has been cleaned, per the
// repo convention of removing completed backfill helpers.
export const run = internalMutation({
	args: {},
	handler: async (ctx) => {
		const profiles = await ctx.db.query('profiles').collect();
		let patched = 0;
		for (const profile of profiles) {
			const legacy = profile as Record<string, unknown>;
			if (legacy.pendingClubCode === undefined && legacy.pendingRole === undefined) continue;
			await ctx.db.patch(profile._id, {
				pendingClubCode: undefined,
				pendingRole: undefined
			} as never);
			patched += 1;
		}
		return { scanned: profiles.length, patched };
	}
});
