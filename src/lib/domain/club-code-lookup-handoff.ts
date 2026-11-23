import type { FunctionReturnType } from 'convex/server';
import type { api } from '$convex/_generated/api';

type ClubCodeLookupResult = FunctionReturnType<typeof api.clubs.lookupClubByCode>;
type FoundLookup = Extract<ClubCodeLookupResult, { ok: true }>;

// CL-817: every club-code lookup uses up the visitor's rate limit. The join-club form looks the
// code up before navigating to its preview page, so it hands its result over instead of the
// preview page looking the same code up again. In-memory only (browser module state), used
// once, and only for a few seconds: a reload or a later visit does a fresh lookup.
const HANDOFF_MAX_AGE_MS = 30_000;

let handoff: { code: string; result: FoundLookup; at: number } | null = null;

export const handOffClubCodeLookup = (code: string, result: FoundLookup) => {
	if (typeof window === 'undefined') return;
	handoff = { code, result, at: Date.now() };
};

export const takeClubCodeLookup = (code: string): FoundLookup | null => {
	const current = handoff;
	handoff = null;
	if (!current || current.code !== code || Date.now() - current.at > HANDOFF_MAX_AGE_MS) {
		return null;
	}
	return current.result;
};
