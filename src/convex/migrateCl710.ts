import { internalMutation } from './_generated/server';

// CL-710 (CEO decision 2026-07-11): the required onboarding-call step was removed —
// the interview IS the onboarding call, and `accepted` is now the terminal status.
// This backfill converts pre-existing rows to the new shape BEFORE the schema that
// drops `finalized`/`onboardingCallCompletedAt`/`finalizedByProfileId`/`finalizedAt`
// can validate:
//   - status 'finalized' -> 'accepted' (semantics preserved: both mean createdClubId is set)
//   - the three removed fields are unset wherever present
//
// Run once per deployment (dev already done 2026-07-12; prod: run at deploy):
//   npx convex run migrateCl710:run
// Safe to re-run (idempotent). Delete this file once prod has been migrated,
// following the repo convention of removing completed backfill helpers.
export const run = internalMutation({
	args: {},
	handler: async (ctx) => {
		const applications = await ctx.db.query('clubApplications').collect();
		let patched = 0;
		for (const application of applications) {
			// Loosely typed on purpose: these fields no longer exist in the schema,
			// so the current generated types can't name them.
			const legacy = application as Record<string, unknown>;
			const needsStatusFix = legacy.status === 'finalized';
			const hasRemovedField =
				legacy.onboardingCallCompletedAt !== undefined ||
				legacy.finalizedByProfileId !== undefined ||
				legacy.finalizedAt !== undefined;
			if (!needsStatusFix && !hasRemovedField) continue;

			await ctx.db.patch(application._id, {
				...(needsStatusFix ? { status: 'accepted' } : {}),
				onboardingCallCompletedAt: undefined,
				finalizedByProfileId: undefined,
				finalizedAt: undefined
			} as never);
			patched += 1;
		}
		return { scanned: applications.length, patched };
	}
});
