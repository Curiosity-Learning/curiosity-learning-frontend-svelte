import { ConvexError } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { getClubRoleByKey, getMembershipByProfileId } from './permissions';
import { ensureClubRoom } from './chatModel';
import { assignClubToCocGroup } from './cocModel';

// Shared "found a club with this person as its Guide" path. Extracted from
// clubApplications.createClubFromApplication so the admin leader-invite flow
// (clubLeaderInvites.claimMyLeaderInvite) creates clubs with exactly the same side effects as an
// accepted application: club row + code, club chat room, Guide membership, the founder's profile
// pointed at the club with onboarding marked complete, and CoC group assignment.

const createInviteCodeCandidate = () => {
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let code = '';
	for (let index = 0; index < 6; index += 1) {
		code += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return code;
};

export const createInviteCode = async (ctx: MutationCtx) => {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const code = createInviteCodeCandidate();
		const existing = await ctx.db
			.query('clubs')
			.withIndex('by_club_code', (q) => q.eq('clubCode', code))
			.first();
		if (!existing) return code;
	}
	throw new ConvexError('Failed to generate unique invite code');
};

export const createClubForFounder = async (
	ctx: MutationCtx,
	args: {
		founderProfileId: Id<'profiles'>;
		name: string;
		description?: string;
		location?: string;
		locationLatitude?: number;
		locationLongitude?: number;
		videoMediaAssetId?: Id<'mediaAssets'>;
	}
): Promise<{ clubId: Id<'clubs'> }> => {
	const founderProfile = await ctx.db.get(args.founderProfileId);
	if (!founderProfile) {
		throw new ConvexError('Founder profile not found');
	}

	const inviteCode = await createInviteCode(ctx);
	const now = Date.now();
	const clubId = await ctx.db.insert('clubs', {
		name: args.name,
		clubCode: inviteCode,
		description: args.description,
		location: args.location,
		locationLatitude: args.locationLatitude,
		locationLongitude: args.locationLongitude,
		videoMediaAssetId: args.videoMediaAssetId,
		// Discoverable by default (CEO decision): new clubs are opted into the public map/preview
		// unless a Guide later opts out via clubs.updateClub.
		discoverable: true,
		kind: 'curiosity',
		createdByProfileId: args.founderProfileId,
		createdAt: now,
		updatedAt: now
	});
	await ensureClubRoom(ctx, clubId);

	const guideRole = await getClubRoleByKey(ctx, 'guide');
	if (!guideRole) {
		throw new ConvexError('Default role guide is not configured');
	}
	const existingMembership = await getMembershipByProfileId(ctx, clubId, args.founderProfileId);
	if (!existingMembership) {
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: args.founderProfileId,
			roleId: guideRole._id,
			firstName: founderProfile.firstName,
			lastName: founderProfile.lastName,
			username: founderProfile.username,
			coverPhotoUrl: founderProfile.coverPhotoUrl,
			createdAt: now
		});
	}

	await ctx.db.patch(args.founderProfileId, {
		activeClubId: clubId,
		firstLoginCompleted: true,
		updatedAt: now
	});

	const createdClub = await ctx.db.get(clubId);
	if (createdClub) {
		// PRD 6.5 step 7 / CL-707: launch auto-assigns the new club to a Club of Clubs group.
		await assignClubToCocGroup(ctx, createdClub, args.founderProfileId);
	}

	return { clubId };
};
