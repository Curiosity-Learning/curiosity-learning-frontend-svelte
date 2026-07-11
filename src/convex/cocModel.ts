import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { getClubRoleByKey, getMembershipByProfileId } from './permissions';
import { ensureClubRoom } from './chatModel';

// Club of Clubs (CoC) assignment (CL-707, PRD 6.10 + 5.3).
//
// A CoC group is itself a `clubs` row (kind: 'coc') so it gets chat/sessions/projects/
// attendance "for free" by just being a club. A Curiosity Club (kind: 'curiosity') points at
// its assigned CoC group via `cocGroupId`; the assignment is made once, at launch, and is
// permanent for v1 (a Guide can still leave the CoC through the normal leave-club path —
// that's an accepted v1 gap, see clubs.ts leaveClub).
//
// v1 matching is timezone-only. PRD 6.10.2 also calls for "diversity of origin" — that's out
// of scope here (CL-736 will do richer group modeling) and deliberately not implemented.

const COC_GROUP_CAPACITY = 10;
const COC_TIMEZONE_TOLERANCE_HOURS = 3;
const HOURS_PER_TIMEZONE_SLICE = 15;

// Approximate UTC offset (in whole hours) from longitude: each 15 degrees of longitude is
// roughly one timezone hour. Clubs without coordinates (no location set, or an application
// that skipped it) get offset 0 rather than blocking assignment.
export const approximateTimezoneOffsetFromLongitude = (
	longitude: number | undefined
): number => {
	if (longitude === undefined) {
		return 0;
	}
	return Math.round(longitude / HOURS_PER_TIMEZONE_SLICE);
};

const countMemberClubs = async (ctx: MutationCtx, cocGroupId: Id<'clubs'>) => {
	const memberClubs = await ctx.db
		.query('clubs')
		.withIndex('by_coc_group', (q) => q.eq('cocGroupId', cocGroupId))
		.collect();
	return memberClubs.length;
};

const findCompatibleCocGroup = async (
	ctx: MutationCtx,
	timezoneOffset: number
): Promise<Doc<'clubs'> | null> => {
	const cocClubs = await ctx.db
		.query('clubs')
		.withIndex('by_kind', (q) => q.eq('kind', 'coc'))
		.collect();

	const timezoneCompatible = cocClubs.filter((cocClub) => {
		if (cocClub.abandonedAt) return false;
		if (cocClub.timezoneOffset === undefined) return false;
		return Math.abs(cocClub.timezoneOffset - timezoneOffset) <= COC_TIMEZONE_TOLERANCE_HOURS;
	});

	// Capacity counts are independent per candidate — batch them instead of counting (and
	// early-exiting) one at a time. The original selection order/first-match semantics are
	// preserved by scanning `timezoneCompatible` afterward in the same order.
	const memberCounts = await Promise.all(
		timezoneCompatible.map((cocClub) => countMemberClubs(ctx, cocClub._id))
	);

	for (let index = 0; index < timezoneCompatible.length; index += 1) {
		if (memberCounts[index] < COC_GROUP_CAPACITY) {
			return timezoneCompatible[index];
		}
	}

	return null;
};

const nextCocGroupNumber = async (ctx: MutationCtx) => {
	const cocClubs = await ctx.db
		.query('clubs')
		.withIndex('by_kind', (q) => q.eq('kind', 'coc'))
		.collect();
	return cocClubs.length + 1;
};

const createCocGroup = async (
	ctx: MutationCtx,
	timezoneOffset: number,
	createdByProfileId: Id<'profiles'>
) => {
	const now = Date.now();
	const groupNumber = await nextCocGroupNumber(ctx);
	const cocGroupId = await ctx.db.insert('clubs', {
		name: `Club of Clubs — Group ${groupNumber}`,
		description:
			'A peer support group for Guides: chat, share sessions/projects, and support each other in running your Curiosity Clubs.',
		// CoC groups are never on the public map/club page and never join-by-code discoverable
		// (PRD 6.10): they're an internal Guide support structure, not something learners find.
		discoverable: false,
		kind: 'coc',
		timezoneOffset,
		createdByProfileId,
		createdAt: now,
		updatedAt: now
	});
	await ensureClubRoom(ctx, cocGroupId);
	const created = await ctx.db.get(cocGroupId);
	if (!created) {
		throw new Error('Failed to create Club of Clubs group');
	}
	return created;
};

// Adds every active Guide of `club` as a guide-role member of `cocGroup`, if not already a
// member. Used both at launch (assignClubToCocGroup) and idempotently is safe to call again.
const addClubGuidesToCocGroup = async (
	ctx: MutationCtx,
	club: Doc<'clubs'>,
	cocGroup: Doc<'clubs'>
) => {
	const guideRole = await getClubRoleByKey(ctx, 'guide');
	if (!guideRole) {
		throw new Error('Default role guide is not configured');
	}

	const members = await ctx.db
		.query('clubMembers')
		.withIndex('by_club', (q) => q.eq('clubId', club._id))
		.collect();
	const activeGuideMemberships = members.filter(
		(member) => !member.leftAt && member.roleId === guideRole._id
	);

	if (!activeGuideMemberships.length) {
		return;
	}

	await ensureClubRoom(ctx, cocGroup._id);
	const now = Date.now();

	for (const membership of activeGuideMemberships) {
		await addGuideToCocGroup(ctx, cocGroup._id, membership.profileId, guideRole._id, now);
	}
};

// Adds a single profile as a guide-role member of a CoC group, if not already an active member.
// Shared by launch-time assignment and later guide-addition paths (promote, guide-code join).
export const addGuideToCocGroup = async (
	ctx: MutationCtx,
	cocGroupId: Id<'clubs'>,
	profileId: Id<'profiles'>,
	guideRoleId: Id<'clubRoles'>,
	now: number = Date.now()
) => {
	const existingMembership = await getMembershipByProfileId(ctx, cocGroupId, profileId);
	if (existingMembership) {
		return;
	}

	const profile = await ctx.db.get(profileId);
	await ensureClubRoom(ctx, cocGroupId);
	await ctx.db.insert('clubMembers', {
		clubId: cocGroupId,
		profileId,
		roleId: guideRoleId,
		firstName: profile?.firstName,
		lastName: profile?.lastName,
		username: profile?.username,
		coverPhotoUrl: profile?.coverPhotoUrl,
		createdAt: now
	});
};

// Called once, at club launch (createClub / createClubFromApplication). Finds a compatible CoC
// group (same-ish timezone, under capacity) or creates a new one, links the new club to it via
// `cocGroupId`, and adds all of the new club's Guides (normally just the creator at this point)
// as guide members of the CoC group.
export const assignClubToCocGroup = async (
	ctx: MutationCtx,
	club: Doc<'clubs'>,
	createdByProfileId: Id<'profiles'>
) => {
	const timezoneOffset = approximateTimezoneOffsetFromLongitude(club.locationLongitude);

	let cocGroup = await findCompatibleCocGroup(ctx, timezoneOffset);
	if (!cocGroup) {
		cocGroup = await createCocGroup(ctx, timezoneOffset, createdByProfileId);
	}

	await ctx.db.patch(club._id, { cocGroupId: cocGroup._id, updatedAt: Date.now() });
	const patchedClub = await ctx.db.get(club._id);
	if (!patchedClub) {
		throw new Error('Club not found after CoC assignment');
	}

	await addClubGuidesToCocGroup(ctx, patchedClub, cocGroup);

	return cocGroup;
};

// Called when someone becomes a Guide of an already-launched curiosity club (invite-code join,
// promote). If the club has a CoC group assigned, adds them as a guide member of it too (no-op
// if they're already a member).
export const addNewGuideToClubsCocGroup = async (
	ctx: MutationCtx,
	club: Doc<'clubs'>,
	profileId: Id<'profiles'>
) => {
	if (!club.cocGroupId) {
		return;
	}
	const cocGroup = await ctx.db.get(club.cocGroupId);
	if (!cocGroup || cocGroup.abandonedAt) {
		return;
	}

	const guideRole = await getClubRoleByKey(ctx, 'guide');
	if (!guideRole) {
		throw new Error('Default role guide is not configured');
	}

	await addGuideToCocGroup(ctx, cocGroup._id, profileId, guideRole._id);
};
