import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { resolveMediaAssetFileUrl } from './mediaStorage';
import { getRelatedProfile, hasPermissionForProfile } from './permissions';
import { isProjectArchived, listAttributedClubIds } from './projectsModel';

type Ctx = QueryCtx | MutationCtx;
export type SendBlockedReason = 'archived' | 'not_participant' | null;
export type RoomAccess = {
	canRead: boolean;
	canSend: boolean;
	sendBlockedReason: SendBlockedReason;
};
// CL-695/725 CEO review: a chat's actionable state for the chat-list badge (item E).
// 'action_needed' means the CURRENT viewer specifically has something to decide/do (e.g. a Guide
// deciding a pending join request, or an applicant with an incomplete application to resume).
// 'open' means the chat can still be sent in but there's nothing pending on the viewer. 'closed'
// means sending is no longer possible (decided/archived/removed).
export type RoomActionState = 'open' | 'action_needed' | 'closed';

// Shared by the chat member-overview affordance (CL-695 CEO review item A) and inbound message
// sender attribution (item B). Kept local to chat surfaces rather than reusing profiles.ts's
// private resolveProfileImageUrl, mirroring the existing convention where each file that needs a
// display name/avatar keeps its own small copy (see joinRequests.ts, clubApplications.ts,
// moderation.ts, reports.ts).
export const profileDisplayName = (profile: {
	firstName?: string;
	lastName?: string;
	username?: string;
}) => {
	const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
	return fullName || profile.username || 'Someone';
};

export const resolveProfileAvatarUrl = async (
	ctx: Ctx,
	profile: { profileImageMediaAssetId?: Id<'mediaAssets'> }
): Promise<string | null> => {
	if (!profile.profileImageMediaAssetId) {
		return null;
	}
	const asset = await ctx.db.get(profile.profileImageMediaAssetId);
	if (!asset || asset.status !== 'ready' || asset.mediaKind === 'video') {
		return null;
	}
	return resolveMediaAssetFileUrl(asset) ?? null;
};

export type ChatParticipantSummary = {
	profileId: Id<'profiles'>;
	name: string;
	avatarUrl: string | null;
	roleLabel: string;
};

export const summarizeProfileForChat = async (
	ctx: Ctx,
	profile: Doc<'profiles'>,
	roleLabel: string
): Promise<ChatParticipantSummary> => ({
	profileId: profile._id,
	name: profileDisplayName(profile),
	avatarUrl: await resolveProfileAvatarUrl(ctx, profile),
	roleLabel
});

// ---------------------------------------------------------------------------------------------
// Room access rules (PRD 6.9-6.11 chat surfaces). Shared by `chat.ts` (evaluated for whichever
// profile is calling, with a full read+send answer) and `parentAccounts.ts`'s read-only "View as
// Child" chat surface (evaluated for the CHILD's profile id, using only `canRead` — a parent can
// never send as their child, so `canSend`/`sendBlockedReason` are simply ignored there).
// ---------------------------------------------------------------------------------------------

export const getClubAccess = async (
	ctx: Ctx,
	clubId: Id<'clubs'>,
	profileId: Id<'profiles'>
): Promise<RoomAccess> => {
	const memberships = await ctx.db
		.query('clubMembers')
		.withIndex('by_club_and_profile', (q) => q.eq('clubId', clubId).eq('profileId', profileId))
		.collect();
	const canRead = memberships.length > 0;
	const canSend = memberships.some((membership) => !membership.leftAt);
	return {
		canRead,
		canSend,
		sendBlockedReason: !canSend && canRead ? 'not_participant' : null
	};
};

const getProjectObserverAccess = async (
	ctx: Ctx,
	projectId: Id<'projects'>,
	profileId: Id<'profiles'>
): Promise<{ canRead: boolean; canSend: boolean }> => {
	const access = { canRead: false, canSend: false };
	const attributedClubIds = await listAttributedClubIds(ctx, projectId);

	for (const clubId of attributedClubIds) {
		const memberships = await ctx.db
			.query('clubMembers')
			.withIndex('by_club_and_profile', (q) => q.eq('clubId', clubId).eq('profileId', profileId))
			.collect();
		for (const membership of memberships) {
			const role = await ctx.db.get(membership.roleId);
			if (!role?.permissions.includes('project:read')) {
				continue;
			}
			access.canRead = true;
			if (!membership.leftAt) {
				access.canSend = true;
			}
		}
	}

	return access;
};

export const getProjectAccess = async (
	ctx: Ctx,
	projectId: Id<'projects'>,
	profileId: Id<'profiles'>
): Promise<RoomAccess> => {
	const memberships = await ctx.db
		.query('projectMembers')
		.withIndex('by_project_and_profile', (q) =>
			q.eq('projectId', projectId).eq('profileId', profileId)
		)
		.collect();
	const observerAccess = await getProjectObserverAccess(ctx, projectId, profileId);
	const canRead = memberships.length > 0 || observerAccess.canRead;
	const archived = await isProjectArchived(ctx, projectId);
	const canSend =
		!archived && (memberships.some((membership) => !membership.leftAt) || observerAccess.canSend);

	let sendBlockedReason: SendBlockedReason = null;
	if (!canSend && canRead) {
		sendBlockedReason = archived ? 'archived' : 'not_participant';
	}

	return { canRead, canSend, sendBlockedReason };
};

// CL-710 CEO review item 4: the chat stays open (sendable) even after the application is decided
// — accepted or rejected — so the applicant can still reach out to the interviewer for support
// later. Nothing about a clubApplication room ever blocks sending; only membership (applicant vs.
// a Guide who reviewed it, vs. staff) gates `canRead`.
//
// Staff (profiles.globalRole === 'admin') get the same read+send access as a reviewer: until
// peer review is staffed, applications are accepted/declined from the admin portal, and the
// staff↔applicant conversation happens in this same room — the applicant keeps seeing it in the
// member app's chat while admins use the portal's UI over the identical rooms/messages data.
// This deliberately does NOT surface these rooms in the member app's chat list for admins:
// chat.listRoomSummaries enumerates rooms from the viewer's own memberships/reviews/applications,
// which an admin qua admin has none of.
export const getClubApplicationAccess = async (
	ctx: Ctx,
	clubApplicationId: Id<'clubApplications'>,
	profileId: Id<'profiles'>
): Promise<RoomAccess> => {
	const application = await ctx.db.get(clubApplicationId);
	if (!application) {
		return { canRead: false, canSend: false, sendBlockedReason: null };
	}
	if (application.applicantProfileId === profileId) {
		return { canRead: true, canSend: true, sendBlockedReason: null };
	}

	const profile = await ctx.db.get(profileId);
	if (profile?.globalRole === 'admin') {
		return { canRead: true, canSend: true, sendBlockedReason: null };
	}

	const review = await ctx.db
		.query('applicationReviews')
		.withIndex('by_application_id_and_reviewer_profile_id', (q) =>
			q.eq('applicationId', clubApplicationId).eq('reviewerProfileId', profileId)
		)
		.first();
	if (review) {
		return { canRead: true, canSend: true, sendBlockedReason: null };
	}

	// PRD 6.11 chat membership: club_application participants are "Applicant + assigned
	// interviewers" — an applicationReviewAssignments row IS the assignment, so assigned
	// reviewers can chat (e.g. to schedule the interview) even before submitting scores. Also
	// how staff attach an interviewer to an admin-invited leader's application (which has no
	// auto-assigned reviewers): admin.adminAssignReviewer.
	const assignment = await ctx.db
		.query('applicationReviewAssignments')
		.withIndex('by_application_id_and_reviewer_profile_id', (q) =>
			q.eq('applicationId', clubApplicationId).eq('reviewerProfileId', profileId)
		)
		.first();
	const canRead = Boolean(assignment);
	return { canRead, canSend: canRead, sendBlockedReason: null };
};

export const getJoinRequestAccess = async (
	ctx: Ctx,
	joinRequestId: Id<'joinRequests'>,
	profileId: Id<'profiles'>
): Promise<RoomAccess> => {
	const joinRequest = await ctx.db.get(joinRequestId);
	if (!joinRequest) {
		return { canRead: false, canSend: false, sendBlockedReason: null };
	}

	const canSend = joinRequest.status === 'pending';
	if (joinRequest.requesterProfileId === profileId) {
		return { canRead: true, canSend, sendBlockedReason: null };
	}

	// Any current Guide of the club can read/send, mirroring how any reviewer can act on a
	// club application chat. Access is derived (no participants table), same pattern as
	// `getClubApplicationAccess`.
	const allowed = await hasPermissionForProfile(
		ctx,
		joinRequest.clubId,
		profileId,
		'club_join_request:decide'
	);
	return { canRead: allowed, canSend: allowed && canSend, sendBlockedReason: null };
};

export const getRoomAccess = async (
	ctx: Ctx,
	room: Doc<'rooms'>,
	profileId: Id<'profiles'>
): Promise<RoomAccess> => {
	switch (room.contextType) {
		case 'club':
			return await getClubAccess(ctx, room.clubId, profileId);
		case 'project':
			return await getProjectAccess(ctx, room.projectId, profileId);
		case 'clubApplication':
			return await getClubApplicationAccess(ctx, room.clubApplicationId, profileId);
		case 'joinRequest':
			return await getJoinRequestAccess(ctx, room.joinRequestId, profileId);
	}
};

// Earliest createdAt across rows, 0 when there are none ("no derivable association").
const earliestCreatedAt = (rows: Array<{ createdAt: number }>) =>
	rows.reduce((earliest, row) => (!earliest || row.createdAt < earliest ? row.createdAt : earliest), 0);

// Last-read feature: when a viewer became associated with a room's context. Used by
// chat.listRoomSummaries as the unread floor for viewers with no roomReadMarkers row yet — a new
// member of an old club shouldn't find its entire history badged as unread; counting starts at
// the same association the access rules above derive room visibility from. Returns 0
// ("everything unread") when no association time is derivable.
export const getRoomJoinedAt = async (
	ctx: Ctx,
	room: Doc<'rooms'>,
	profileId: Id<'profiles'>
): Promise<number> => {
	switch (room.contextType) {
		case 'club': {
			const memberships = await ctx.db
				.query('clubMembers')
				.withIndex('by_club_and_profile', (q) =>
					q.eq('clubId', room.clubId).eq('profileId', profileId)
				)
				.collect();
			return earliestCreatedAt(memberships);
		}
		case 'project': {
			const memberships = await ctx.db
				.query('projectMembers')
				.withIndex('by_project_and_profile', (q) =>
					q.eq('projectId', room.projectId).eq('profileId', profileId)
				)
				.collect();
			const memberJoinedAt = earliestCreatedAt(memberships);
			if (memberJoinedAt) return memberJoinedAt;

			// Guide observers (getProjectObserverAccess): associated through their qualifying club
			// membership, so their unread floor is when they joined the attributed club.
			let observerJoinedAt = 0;
			const attributedClubIds = await listAttributedClubIds(ctx, room.projectId);
			for (const clubId of attributedClubIds) {
				const clubMemberships = await ctx.db
					.query('clubMembers')
					.withIndex('by_club_and_profile', (q) =>
						q.eq('clubId', clubId).eq('profileId', profileId)
					)
					.collect();
				for (const membership of clubMemberships) {
					const role = await ctx.db.get(membership.roleId);
					if (!role?.permissions.includes('project:read')) continue;
					if (!observerJoinedAt || membership.createdAt < observerJoinedAt) {
						observerJoinedAt = membership.createdAt;
					}
				}
			}
			return observerJoinedAt;
		}
		case 'clubApplication': {
			const application = await ctx.db.get(room.clubApplicationId);
			if (!application) return 0;
			// The room exists FOR the applicant: everything in it is addressed to them.
			if (application.applicantProfileId === profileId) return application.createdAt;

			// Reviewers: the assignment is the earliest association (it precedes the review row);
			// the review-row fallback covers legacy reviews from before windowed assignment.
			const assignment = await ctx.db
				.query('applicationReviewAssignments')
				.withIndex('by_application_id_and_reviewer_profile_id', (q) =>
					q.eq('applicationId', room.clubApplicationId).eq('reviewerProfileId', profileId)
				)
				.first();
			if (assignment) return assignment.assignedAt;
			const review = await ctx.db
				.query('applicationReviews')
				.withIndex('by_application_id_and_reviewer_profile_id', (q) =>
					q.eq('applicationId', room.clubApplicationId).eq('reviewerProfileId', profileId)
				)
				.first();
			if (review) return review.createdAt;

			// Staff (globalRole admin): no membership/assignment row ever ties them to the room —
			// like listRoomSummaries' message-derived listing, their association starts with the
			// first message they wrote in it.
			const firstOwnMessage = await ctx.db
				.query('messages')
				.withIndex('by_room', (q) => q.eq('roomId', room._id))
				.filter((q) => q.eq(q.field('profileId'), profileId))
				.first();
			return firstOwnMessage?._creationTime ?? 0;
		}
		case 'joinRequest': {
			const joinRequest = await ctx.db.get(room.joinRequestId);
			if (!joinRequest) return 0;
			// The room exists FOR the requester: everything in it is addressed to them.
			if (joinRequest.requesterProfileId === profileId) return joinRequest.createdAt;

			// Deciding Guides: associated through their club membership (getJoinRequestAccess).
			const memberships = await ctx.db
				.query('clubMembers')
				.withIndex('by_club_and_profile', (q) =>
					q.eq('clubId', joinRequest.clubId).eq('profileId', profileId)
				)
				.collect();
			return earliestCreatedAt(memberships);
		}
	}
};

// CL-695/725 CEO review item E: lets the chat list show whether a chat is still open, closed, or
// specifically waiting on THIS viewer to act. Deliberately separate from `getRoomAccess` (which
// only answers read/send) since a chat can be sendable but not "actionable" (e.g. a requester
// waiting on a Guide's decision can still send follow-up messages, but nothing is pending on them).
export const getRoomActionState = async (
	ctx: Ctx,
	room: Doc<'rooms'>,
	profileId: Id<'profiles'>,
	access: RoomAccess
): Promise<RoomActionState> => {
	switch (room.contextType) {
		case 'club':
		case 'project':
			return access.canSend ? 'open' : 'closed';
		case 'joinRequest': {
			const joinRequest = await ctx.db.get(room.joinRequestId);
			if (!joinRequest || joinRequest.status !== 'pending') {
				return 'closed';
			}
			if (joinRequest.requesterProfileId === profileId) {
				return 'open';
			}
			const canDecide = await hasPermissionForProfile(
				ctx,
				joinRequest.clubId,
				profileId,
				'club_join_request:decide'
			);
			return canDecide ? 'action_needed' : 'open';
		}
		case 'clubApplication': {
			const application = await ctx.db.get(room.clubApplicationId);
			if (!application) {
				return 'closed';
			}
			// CL-710 CEO review item 4: a decided application (accepted or rejected) keeps its chat
			// open — nothing is closed, and nothing is pending on either side anymore.
			if (application.applicantProfileId === profileId) {
				return application.status === 'incomplete' ? 'action_needed' : 'open';
			}
			const review = await ctx.db
				.query('applicationReviews')
				.withIndex('by_application_id_and_reviewer_profile_id', (q) =>
					q.eq('applicationId', application._id).eq('reviewerProfileId', profileId)
				)
				.first();
			if (!review) {
				return 'open';
			}
			const decided = application.status === 'accepted' || application.status === 'rejected';
			return decided ? 'open' : 'action_needed';
		}
	}
};

export const getRoomName = async (ctx: Ctx, room: Doc<'rooms'>) => {
	switch (room.contextType) {
		case 'club':
			return (await ctx.db.get(room.clubId))?.name ?? 'Club chat';
		case 'project':
			return (await ctx.db.get(room.projectId))?.name ?? 'Project chat';
		case 'clubApplication':
			return (await ctx.db.get(room.clubApplicationId))?.name ?? 'Club application chat';
		case 'joinRequest': {
			const joinRequest = await ctx.db.get(room.joinRequestId);
			const club = joinRequest ? await ctx.db.get(joinRequest.clubId) : null;
			return club ? `${club.name} join request` : 'Join request chat';
		}
	}
};

// CEO review (CL-695 round 3, item 1): shared "1:1 counterpart" resolution for the room types that
// have a clear "other party" from a given viewer's perspective — a join request's requester (seen
// from a Guide's side) or a club application's applicant (seen from a reviewer's side). Returns
// null for club/project rooms (no single counterpart) and for the counterpart's OWN view of their
// own join-request/application room (nothing to highlight — they ARE that party). This is the one
// source of truth for "does this room have a counterpart to highlight, and who" — used both by the
// chat header (`getRoomParticipants`'s primaryProfileId) and the chat list's title/subtitle
// (`listRoomSummaries`), so the two stay in sync by construction rather than by convention.
export const getRoomCounterpart = async (
	ctx: Ctx,
	room: Doc<'rooms'>,
	profileId: Id<'profiles'>
): Promise<ChatParticipantSummary | null> => {
	switch (room.contextType) {
		case 'joinRequest': {
			const joinRequest = await ctx.db.get(room.joinRequestId);
			if (!joinRequest || joinRequest.requesterProfileId === profileId) return null;
			const requesterProfile = await getRelatedProfile(ctx, joinRequest.requesterProfileId);
			if (!requesterProfile) return null;
			return await summarizeProfileForChat(ctx, requesterProfile, 'Requester');
		}
		case 'clubApplication': {
			const application = await ctx.db.get(room.clubApplicationId);
			if (!application || application.applicantProfileId === profileId) return null;
			const applicantProfile = await getRelatedProfile(ctx, application.applicantProfileId);
			if (!applicantProfile) return null;
			return await summarizeProfileForChat(ctx, applicantProfile, 'Applicant');
		}
		default:
			return null;
	}
};

// Chat email notifications (CL-764): who should be told about new messages in a room. Mirrors
// the participant model of chat.getRoomParticipants (PRD 6.8.1) but returns bare profile ids —
// the email path needs no names/avatars. Left members are excluded on purpose: they keep READ
// access to history, but a conversation continuing without them is not theirs to be nudged
// about. The message-derived rule for 1:1-style rooms matches getRoomParticipants: staff who
// have written in an application/join-request room are participants even though no membership
// row ties them to it.
export const listRoomRecipientProfileIds = async (
	ctx: Ctx,
	room: Doc<'rooms'>
): Promise<Set<Id<'profiles'>>> => {
	const recipients = new Set<Id<'profiles'>>();
	switch (room.contextType) {
		case 'club': {
			const members = await ctx.db
				.query('clubMembers')
				.withIndex('by_club', (q) => q.eq('clubId', room.clubId))
				.collect();
			for (const member of members) {
				if (!member.leftAt) recipients.add(member.profileId);
			}
			break;
		}
		case 'project': {
			const memberships = await ctx.db
				.query('projectMembers')
				.withIndex('by_project', (q) => q.eq('projectId', room.projectId))
				.collect();
			for (const membership of memberships) {
				if (!membership.leftAt) recipients.add(membership.profileId);
			}
			// Attributed clubs' Guides observe the project chat (getProjectObserverAccess), so new
			// messages are addressed to them too.
			const attributedClubIds = await listAttributedClubIds(ctx, room.projectId);
			for (const clubId of attributedClubIds) {
				const clubMembers = await ctx.db
					.query('clubMembers')
					.withIndex('by_club', (q) => q.eq('clubId', clubId))
					.collect();
				for (const member of clubMembers) {
					if (member.leftAt || recipients.has(member.profileId)) continue;
					const role = await ctx.db.get(member.roleId);
					if (role?.key !== 'guide') continue;
					recipients.add(member.profileId);
				}
			}
			break;
		}
		case 'joinRequest': {
			const joinRequest = await ctx.db.get(room.joinRequestId);
			if (!joinRequest) break;
			recipients.add(joinRequest.requesterProfileId);
			const clubMembers = await ctx.db
				.query('clubMembers')
				.withIndex('by_club', (q) => q.eq('clubId', joinRequest.clubId))
				.collect();
			for (const member of clubMembers) {
				if (member.leftAt) continue;
				const role = await ctx.db.get(member.roleId);
				if (role?.key === 'guide') recipients.add(member.profileId);
			}
			break;
		}
		case 'clubApplication': {
			const application = await ctx.db.get(room.clubApplicationId);
			if (!application) break;
			recipients.add(application.applicantProfileId);
			const reviews = await ctx.db
				.query('applicationReviews')
				.withIndex('by_application_id', (q) => q.eq('applicationId', room.clubApplicationId))
				.collect();
			for (const review of reviews) recipients.add(review.reviewerProfileId);
			const assignments = await ctx.db
				.query('applicationReviewAssignments')
				.withIndex('by_application_id', (q) => q.eq('applicationId', room.clubApplicationId))
				.collect();
			for (const assignment of assignments) recipients.add(assignment.reviewerProfileId);
			break;
		}
	}

	if (room.contextType === 'clubApplication' || room.contextType === 'joinRequest') {
		const roomMessages = await ctx.db
			.query('messages')
			.withIndex('by_room', (q) => q.eq('roomId', room._id))
			.collect();
		for (const message of roomMessages) {
			if (message.profileId) recipients.add(message.profileId);
		}
	}

	return recipients;
};

export const ensureClubRoom = async (ctx: MutationCtx, clubId: Id<'clubs'>) => {
	const existing = await ctx.db
		.query('rooms')
		.withIndex('by_club_id', (q) => q.eq('clubId', clubId))
		.first();
	if (existing) {
		return existing._id;
	}

	return await ctx.db.insert('rooms', {
		contextType: 'club',
		clubId
	});
};

export const ensureProjectRoom = async (ctx: MutationCtx, projectId: Id<'projects'>) => {
	const existing = await ctx.db
		.query('rooms')
		.withIndex('by_project_id', (q) => q.eq('projectId', projectId))
		.first();
	if (existing) {
		return existing._id;
	}

	return await ctx.db.insert('rooms', {
		contextType: 'project',
		projectId
	});
};

export const ensureClubApplicationRoom = async (
	ctx: MutationCtx,
	clubApplicationId: Id<'clubApplications'>
) => {
	const existing = await ctx.db
		.query('rooms')
		.withIndex('by_club_application_id', (q) => q.eq('clubApplicationId', clubApplicationId))
		.first();
	if (existing) {
		return existing._id;
	}

	return await ctx.db.insert('rooms', {
		contextType: 'clubApplication',
		clubApplicationId
	});
};

export const ensureJoinRequestRoom = async (
	ctx: MutationCtx,
	joinRequestId: Id<'joinRequests'>
) => {
	const existing = await ctx.db
		.query('rooms')
		.withIndex('by_join_request_id', (q) => q.eq('joinRequestId', joinRequestId))
		.first();
	if (existing) {
		return existing._id;
	}

	return await ctx.db.insert('rooms', {
		contextType: 'joinRequest',
		joinRequestId
	});
};
