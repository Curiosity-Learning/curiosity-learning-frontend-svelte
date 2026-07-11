import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';

type Ctx = QueryCtx | MutationCtx;

export type PendingClubJoinSource = 'code' | 'map_request';

// PRD 5.6: deferred club-join intent, keyed by profile. Replaces the old
// `profiles.pendingClubCode`/`pendingRole` fields — see schema.ts's `pendingClubJoins` table doc
// comment for the full rationale. v1 flows only ever create one pending intent per profile at a
// time, but this module still keeps get-latest / clear-all semantics so a hypothetical second
// intent can never leave stale rows behind.

// Records (or replaces) the profile's pending club-join intent. Clears any existing pending
// intents first so a profile only ever has one live row, matching the old fields' single-value
// semantics.
export const setPendingClubJoin = async (
	ctx: MutationCtx,
	profileId: Id<'profiles'>,
	clubId: Id<'clubs'>,
	source: PendingClubJoinSource
) => {
	await clearPendingClubJoinsForProfile(ctx, profileId);
	await ctx.db.insert('pendingClubJoins', {
		profileId,
		clubId,
		source,
		createdAt: Date.now()
	});
};

// Returns the most recently created pending join for a profile, or null if none exists.
export const getLatestPendingClubJoin = async (ctx: Ctx, profileId: Id<'profiles'>) => {
	const rows = await ctx.db
		.query('pendingClubJoins')
		.withIndex('by_profile', (q) => q.eq('profileId', profileId))
		.collect();
	if (!rows.length) {
		return null;
	}
	return rows.reduce((latest, row) => (row.createdAt > latest.createdAt ? row : latest));
};

// Clears every pending join row for a profile (consumption/cleanup — always clear-all, never
// just the one that was acted on, matching the old fields' "unset on any successful join" habit).
export const clearPendingClubJoinsForProfile = async (ctx: MutationCtx, profileId: Id<'profiles'>) => {
	const rows = await ctx.db
		.query('pendingClubJoins')
		.withIndex('by_profile', (q) => q.eq('profileId', profileId))
		.collect();
	for (const row of rows) {
		await ctx.db.delete(row._id);
	}
};
