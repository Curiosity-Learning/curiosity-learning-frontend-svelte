import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import {
	getRoomAccess,
	getRoomActionState,
	getRoomCounterpart,
	getRoomJoinedAt,
	getRoomName,
	summarizeProfileForChat,
	type ChatParticipantSummary,
	type RoomActionState,
	type SendBlockedReason
} from './chatModel';
import { getRelatedProfile, requireIdentity, requireProfile } from './permissions';
import { listAttributedClubIds } from './projectsModel';

const MAX_MESSAGE_LENGTH = 1_000;
const DEFAULT_MESSAGE_LIMIT = 50;
// Unread counting stops scanning here; the UI renders anything at/over the cap as "99+".
const UNREAD_COUNT_CAP = 100;
type Ctx = QueryCtx | MutationCtx;

const requireRoomAccess = async (
	ctx: Ctx,
	roomId: Id<'rooms'>,
	profileId: Id<'profiles'>,
	accessType: 'read' | 'send'
) => {
	const room = await ctx.db.get(roomId);
	if (!room) {
		throw new ConvexError('Room not found');
	}

	const access = await getRoomAccess(ctx, room, profileId);
	if (!access.canRead) {
		throw new ConvexError('You cannot access this chat');
	}
	if (accessType === 'send' && !access.canSend) {
		throw new ConvexError('You can no longer send messages in this chat');
	}

	return room;
};

const getReadMarker = async (ctx: Ctx, profileId: Id<'profiles'>, roomId: Id<'rooms'>) =>
	await ctx.db
		.query('roomReadMarkers')
		.withIndex('by_profile_and_room', (q) => q.eq('profileId', profileId).eq('roomId', roomId))
		.first();

// Messages the viewer hasn't seen yet: everything after their last-read watermark except their
// own messages (you can't have "unread" messages you wrote yourself — this also keeps a viewer's
// very first message in a room from counting as unread before any marker row exists). System
// messages (no profileId, e.g. decision notices) deliberately DO count. For viewers with no
// marker yet, the caller passes their context-join time (getRoomJoinedAt) as the floor.
const countUnreadMessages = async (
	ctx: Ctx,
	roomId: Id<'rooms'>,
	profileId: Id<'profiles'>,
	lastReadAt: number
) => {
	const unread = await ctx.db
		.query('messages')
		.withIndex('by_room', (q) => q.eq('roomId', roomId).gt('_creationTime', lastReadAt))
		.filter((q) => q.neq(q.field('profileId'), profileId))
		.take(UNREAD_COUNT_CAP);
	return unread.length;
};

const addRoomByClub = async (
	ctx: QueryCtx,
	rooms: Map<Id<'rooms'>, Doc<'rooms'>>,
	clubId: Id<'clubs'>
) => {
	const room = await ctx.db
		.query('rooms')
		.withIndex('by_club_id', (q) => q.eq('clubId', clubId))
		.first();
	if (room) rooms.set(room._id, room);
};

const addRoomByProject = async (
	ctx: QueryCtx,
	rooms: Map<Id<'rooms'>, Doc<'rooms'>>,
	projectId: Id<'projects'>
) => {
	const room = await ctx.db
		.query('rooms')
		.withIndex('by_project_id', (q) => q.eq('projectId', projectId))
		.first();
	if (room) rooms.set(room._id, room);
};

const addRoomByClubApplication = async (
	ctx: QueryCtx,
	rooms: Map<Id<'rooms'>, Doc<'rooms'>>,
	clubApplicationId: Id<'clubApplications'>
) => {
	const room = await ctx.db
		.query('rooms')
		.withIndex('by_club_application_id', (q) => q.eq('clubApplicationId', clubApplicationId))
		.first();
	if (room) rooms.set(room._id, room);
};

const addRoomByJoinRequest = async (
	ctx: QueryCtx,
	rooms: Map<Id<'rooms'>, Doc<'rooms'>>,
	joinRequestId: Id<'joinRequests'>
) => {
	const room = await ctx.db
		.query('rooms')
		.withIndex('by_join_request_id', (q) => q.eq('joinRequestId', joinRequestId))
		.first();
	if (room) rooms.set(room._id, room);
};

export const listRoomSummaries = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const rooms = new Map<Id<'rooms'>, Doc<'rooms'>>();

		const clubMemberships = await ctx.db
			.query('clubMembers')
			.withIndex('by_profile', (q) => q.eq('profileId', profile._id))
			.collect();
		for (const membership of clubMemberships) {
			await addRoomByClub(ctx, rooms, membership.clubId);

			const role = await ctx.db.get(membership.roleId);
			if (role?.permissions.includes('project:read')) {
				const attributionRows = await ctx.db
					.query('projectAttributions')
					.withIndex('by_club', (q) => q.eq('clubId', membership.clubId))
					.collect();
				const projectIds = new Set(attributionRows.map((row) => row.projectId));
				for (const projectId of projectIds) {
					await addRoomByProject(ctx, rooms, projectId);
				}
			}

			// Only current (not-left) Guides surface join-request chats for their club: a Guide
			// who has left shouldn't keep seeing new applicants' rooms, though history for chats
			// they already participated in is preserved by getJoinRequestAccess's own check.
			if (!membership.leftAt && role?.permissions.includes('club_join_request:decide')) {
				const joinRequests = await ctx.db
					.query('joinRequests')
					.withIndex('by_club', (q) => q.eq('clubId', membership.clubId))
					.collect();
				for (const joinRequest of joinRequests) {
					await addRoomByJoinRequest(ctx, rooms, joinRequest._id);
				}
			}
		}

		const projectMemberships = await ctx.db
			.query('projectMembers')
			.withIndex('by_profile', (q) => q.eq('profileId', profile._id))
			.collect();
		for (const membership of projectMemberships) {
			await addRoomByProject(ctx, rooms, membership.projectId);
		}

		const applications = await ctx.db
			.query('clubApplications')
			.withIndex('by_applicant_profile_id', (q) => q.eq('applicantProfileId', profile._id))
			.collect();
		for (const application of applications) {
			await addRoomByClubApplication(ctx, rooms, application._id);
		}

		const reviews = await ctx.db
			.query('applicationReviews')
			.withIndex('by_reviewer_profile_id', (q) => q.eq('reviewerProfileId', profile._id))
			.collect();
		for (const review of reviews) {
			await addRoomByClubApplication(ctx, rooms, review.applicationId);
		}

		// PRD 6.11: assigned interviewers are club_application chat participants, so assignments
		// surface the room even before a review is submitted (reviews above cover the escape-
		// hatch case of a review without an assignment row).
		const assignments = await ctx.db
			.query('applicationReviewAssignments')
			.withIndex('by_reviewer_profile_id', (q) => q.eq('reviewerProfileId', profile._id))
			.collect();
		for (const assignment of assignments) {
			await addRoomByClubApplication(ctx, rooms, assignment.applicationId);
		}

		// Own join requests: surfaced regardless of club membership, so a user with no club
		// membership at all still sees their pending/decided join-request chats (PRD 6.8).
		const ownJoinRequests = await ctx.db
			.query('joinRequests')
			.withIndex('by_requester_profile_id', (q) => q.eq('requesterProfileId', profile._id))
			.collect();
		for (const joinRequest of ownJoinRequests) {
			await addRoomByJoinRequest(ctx, rooms, joinRequest._id);
		}

		// Staff: conversations they've actually written in belong in their personal chat list too.
		// Staff reach application rooms via profiles.globalRole (chatModel), not membership, so the
		// walks above never find those rooms — their sent messages are the only record tying them
		// to the conversation. Message-derived on purpose: merely *being* staff surfaces nothing
		// (getClubApplicationAccess deliberately keeps admin-readable rooms out of this list);
		// having spoken in a room makes it theirs like any other participant's. Admin-only guard:
		// members' rooms are already covered by the membership walks, so they skip the scan.
		if (profile.globalRole === 'admin') {
			const sentMessages = await ctx.db
				.query('messages')
				.withIndex('by_profile', (q) => q.eq('profileId', profile._id))
				.collect();
			for (const message of sentMessages) {
				if (rooms.has(message.roomId)) continue;
				const room = await ctx.db.get(message.roomId);
				if (room) rooms.set(room._id, room);
			}
		}

		const summaries: Array<{
			roomId: Id<'rooms'>;
			roomName: string;
			// CEO review (CL-695 round 3, item 1): fallback subtitle to show while the room has no
			// messages yet, for rooms that have a 1:1 counterpart (the club name, mirroring the
			// header's subtext) — null for club/project rooms and for the counterpart's own view of
			// their own room, where the preview area keeps the plain "no messages yet" copy.
			roomSubtitle: string | null;
			contextType: Doc<'rooms'>['contextType'];
			lastMessagePreview: string | null;
			lastMessageAt: number;
			canSend: boolean;
			sendBlockedReason: SendBlockedReason;
			// CL-695/725 CEO review item E: powers the chat-list open/action-needed/closed badge.
			actionState: RoomActionState;
			// Last-read feature: messages newer than the viewer's roomReadMarkers watermark, capped
			// at UNREAD_COUNT_CAP (rendered as "99+"). Own messages never count.
			unreadCount: number;
		}> = [];

		for (const room of rooms.values()) {
			const access = await getRoomAccess(ctx, room, profile._id);
			if (!access.canRead) continue;

			const latestMessage = await ctx.db
				.query('messages')
				.withIndex('by_room', (q) => q.eq('roomId', room._id))
				.order('desc')
				.first();
			// CEO review (CL-695 round 3, item 1): the chat list's title/subtitle should match the
			// chat header's — for 1:1-like rooms (joinRequest/clubApplication) that's the counterpart's
			// name as the title and the club as the subtext (falling back to the last message once
			// there is one). Club/project rooms have no counterpart, so they keep their plain name.
			const genericName = await getRoomName(ctx, room);
			const counterpart = await getRoomCounterpart(ctx, room, profile._id);
			const readMarker = await getReadMarker(ctx, profile._id, room._id);
			// No marker = the viewer never opened this room: unread counting starts when they
			// became associated with the room's context, not at the beginning of history — a new
			// member of an old club shouldn't meet a 99+ badge of backlog from before they joined.
			const unreadFloor =
				readMarker?.lastReadAt ?? (await getRoomJoinedAt(ctx, room, profile._id));
			const unreadCount = await countUnreadMessages(ctx, room._id, profile._id, unreadFloor);
			summaries.push({
				roomId: room._id,
				roomName: counterpart?.name ?? genericName,
				roomSubtitle: counterpart ? genericName : null,
				contextType: room.contextType,
				lastMessagePreview: latestMessage?.content ?? null,
				lastMessageAt: latestMessage?._creationTime ?? room._creationTime,
				canSend: access.canSend,
				sendBlockedReason: access.sendBlockedReason,
				actionState: await getRoomActionState(ctx, room, profile._id, access),
				unreadCount
			});
		}

		return summaries.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
	}
});

// CL-695/725 CEO review item B: sender attribution for every chat, including 1:1-like ones. The
// caller (chat/+page.svelte) only renders name/avatar for INBOUND messages (its own messages are
// obviously self-attributed), but resolving it here for every distinct sender keeps the frontend
// from needing a second round-trip per message.
const attachSenderSummaries = async (ctx: QueryCtx, records: Doc<'messages'>[]) => {
	const profileIds = [...new Set(records.map((record) => record.profileId).filter(Boolean))] as Id<
		'profiles'
	>[];
	const summaries = new Map<Id<'profiles'>, ChatParticipantSummary>();
	for (const profileId of profileIds) {
		const profile = await getRelatedProfile(ctx, profileId);
		if (!profile) continue;
		summaries.set(profileId, await summarizeProfileForChat(ctx, profile, ''));
	}

	return records.map((record) => {
		const sender = record.profileId ? summaries.get(record.profileId) : undefined;
		return {
			...record,
			senderName: sender?.name ?? null,
			senderAvatarUrl: sender?.avatarUrl ?? null
		};
	});
};

export const listMessages = query({
	args: {
		roomId: v.id('rooms'),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		await requireRoomAccess(ctx, args.roomId, profile._id, 'read');

		const requestedLimit = Math.floor(args.limit ?? DEFAULT_MESSAGE_LIMIT);
		const limit = Math.max(requestedLimit, 1);
		const records = await ctx.db
			.query('messages')
			.withIndex('by_room', (q) => q.eq('roomId', args.roomId))
			.order('desc')
			.take(limit + 1);
		const hasMore = records.length > limit;
		const page = records.slice(0, limit).reverse();
		return {
			// CEO review (CL-695 round 3, item 2): echoed back so the client can tell whether this
			// result actually belongs to the currently selected room before rendering it — see the
			// flicker fix in chat/+page.svelte. `useStableQuery` deliberately keeps the PREVIOUS
			// room's data visible while a new room's subscription is still resolving (desirable for
			// in-room pagination, wrong for a room switch), and neither `isLoading` nor `isStale` from
			// convex-svelte distinguish "args changed because of pagination" from "args changed
			// because the room changed" — so the client compares this roomId against the selected one.
			roomId: args.roomId,
			messages: await attachSenderSummaries(ctx, page),
			hasMore
		};
	}
});

// CL-695/725 CEO review item A: chat member overview. Returns who's in the chat, shaped per
// context type per PRD 6.8.1's participant model (club: all members; project: members + attributed
// Guides; join_request: requester + club Guides; club_application: applicant + reviewers).
// `primaryProfileId` flags the "other party" worth highlighting directly in a 1:1-like chat header
// (e.g. the requester, from a Guide's point of view) — null for group chats or when the viewer IS
// that other party.
export const getRoomParticipants = query({
	args: {
		roomId: v.id('rooms')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const room = await requireRoomAccess(ctx, args.roomId, profile._id, 'read');

		const participants: ChatParticipantSummary[] = [];
		let primaryProfileId: Id<'profiles'> | null = null;

		switch (room.contextType) {
			case 'club': {
				const members = (
					await ctx.db
						.query('clubMembers')
						.withIndex('by_club', (q) => q.eq('clubId', room.clubId))
						.collect()
				).filter((member) => !member.leftAt);
				for (const member of members) {
					const memberProfile = await getRelatedProfile(ctx, member.profileId);
					if (!memberProfile) continue;
					const role = await ctx.db.get(member.roleId);
					participants.push(
						await summarizeProfileForChat(ctx, memberProfile, role?.name ?? 'Member')
					);
				}
				break;
			}
			case 'project': {
				const seenProfileIds = new Set<Id<'profiles'>>();
				const memberships = (
					await ctx.db
						.query('projectMembers')
						.withIndex('by_project', (q) => q.eq('projectId', room.projectId))
						.collect()
				).filter((member) => !member.leftAt);
				for (const membership of memberships) {
					const memberProfile = await getRelatedProfile(ctx, membership.profileId);
					if (!memberProfile) continue;
					seenProfileIds.add(membership.profileId);
					const role = await ctx.db.get(membership.roleId);
					participants.push(
						await summarizeProfileForChat(ctx, memberProfile, role?.name ?? 'Member')
					);
				}

				// PRD 6.8.1: attributed clubs' Guides observe the project chat even without project
				// membership (mirrors chatModel.getProjectObserverAccess).
				const attributedClubIds = await listAttributedClubIds(ctx, room.projectId);
				for (const clubId of attributedClubIds) {
					const guideMembers = (
						await ctx.db
							.query('clubMembers')
							.withIndex('by_club', (q) => q.eq('clubId', clubId))
							.collect()
					).filter((member) => !member.leftAt);
					for (const guideMember of guideMembers) {
						if (seenProfileIds.has(guideMember.profileId)) continue;
						const role = await ctx.db.get(guideMember.roleId);
						if (role?.key !== 'guide') continue;
						const guideProfile = await getRelatedProfile(ctx, guideMember.profileId);
						if (!guideProfile) continue;
						seenProfileIds.add(guideMember.profileId);
						participants.push(await summarizeProfileForChat(ctx, guideProfile, 'Guide (observer)'));
					}
				}
				break;
			}
			case 'joinRequest': {
				const joinRequest = await ctx.db.get(room.joinRequestId);
				if (joinRequest) {
					// Shared with listRoomSummaries's chat-list title/subtitle (chatModel.getRoomCounterpart).
					const counterpart = await getRoomCounterpart(ctx, room, profile._id);
					if (counterpart) {
						participants.push(counterpart);
						primaryProfileId = counterpart.profileId;
					} else {
						const requesterProfile = await getRelatedProfile(ctx, joinRequest.requesterProfileId);
						if (requesterProfile) {
							participants.push(await summarizeProfileForChat(ctx, requesterProfile, 'Requester'));
						}
					}
					const guideMembers = (
						await ctx.db
							.query('clubMembers')
							.withIndex('by_club', (q) => q.eq('clubId', joinRequest.clubId))
							.collect()
					).filter((member) => !member.leftAt);
					for (const guideMember of guideMembers) {
						const role = await ctx.db.get(guideMember.roleId);
						if (role?.key !== 'guide') continue;
						const guideProfile = await getRelatedProfile(ctx, guideMember.profileId);
						if (!guideProfile) continue;
						participants.push(await summarizeProfileForChat(ctx, guideProfile, 'Guide'));
					}
				}
				break;
			}
			case 'clubApplication': {
				const application = await ctx.db.get(room.clubApplicationId);
				if (application) {
					// Shared with listRoomSummaries's chat-list title/subtitle (chatModel.getRoomCounterpart).
					const counterpart = await getRoomCounterpart(ctx, room, profile._id);
					if (counterpart) {
						participants.push(counterpart);
						primaryProfileId = counterpart.profileId;
					} else {
						const applicantProfile = await getRelatedProfile(ctx, application.applicantProfileId);
						if (applicantProfile) {
							participants.push(await summarizeProfileForChat(ctx, applicantProfile, 'Applicant'));
						}
					}
					const reviews = await ctx.db
						.query('applicationReviews')
						.withIndex('by_application_id', (q) => q.eq('applicationId', application._id))
						.collect();
					const reviewerProfileIds = new Set<Id<'profiles'>>();
					for (const review of reviews) {
						const reviewerProfile = await getRelatedProfile(ctx, review.reviewerProfileId);
						if (!reviewerProfile) continue;
						reviewerProfileIds.add(review.reviewerProfileId);
						participants.push(await summarizeProfileForChat(ctx, reviewerProfile, 'Reviewer'));
					}
					// Assigned reviewers are chat participants per PRD 6.11, even before submitting
					// scores (chatModel.getClubApplicationAccess grants them access) — without this
					// they could write in the chat while being invisible in the members dialog.
					const assignments = await ctx.db
						.query('applicationReviewAssignments')
						.withIndex('by_application_id', (q) => q.eq('applicationId', application._id))
						.collect();
					for (const assignment of assignments) {
						if (reviewerProfileIds.has(assignment.reviewerProfileId)) continue;
						const reviewerProfile = await getRelatedProfile(ctx, assignment.reviewerProfileId);
						if (!reviewerProfile) continue;
						reviewerProfileIds.add(assignment.reviewerProfileId);
						participants.push(await summarizeProfileForChat(ctx, reviewerProfile, 'Reviewer'));
					}
				}
				break;
			}
		}

		// Anyone who has actually written in the room is a participant, even without a
		// context-derived role — today that's staff running the application pipeline from the admin
		// portal (chatModel grants them send access via profiles.globalRole, so no membership or
		// review row ever lists them, and they'd otherwise be invisible senders). Derived from the
		// messages themselves rather than a membership table, matching how every other participant
		// list here is derived. Scoped to the 1:1-style contexts staff write in: club/project rooms
		// derive membership fully and can hold thousands of messages, so they skip the scan.
		if (room.contextType === 'clubApplication' || room.contextType === 'joinRequest') {
			const listedProfileIds = new Set(participants.map((participant) => participant.profileId));
			const roomMessages = await ctx.db
				.query('messages')
				.withIndex('by_room', (q) => q.eq('roomId', room._id))
				.collect();
			for (const message of roomMessages) {
				if (!message.profileId || listedProfileIds.has(message.profileId)) continue;
				listedProfileIds.add(message.profileId);
				const senderProfile = await getRelatedProfile(ctx, message.profileId);
				if (!senderProfile) continue;
				participants.push(
					await summarizeProfileForChat(
						ctx,
						senderProfile,
						senderProfile.globalRole === 'admin' ? 'Staff' : 'Member'
					)
				);
			}
		}

		// CEO review (CL-695 round 3, item 2): roomId echoed back for the same staleness check as
		// listMessages above.
		return { roomId: args.roomId, contextType: room.contextType, primaryProfileId, participants };
	}
});

export const sendMessage = mutation({
	args: {
		roomId: v.id('rooms'),
		content: v.string()
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		await requireRoomAccess(ctx, args.roomId, profile._id, 'send');

		const content = args.content.trim();
		if (!content) {
			throw new ConvexError('Message content is required');
		}
		if (content.length > MAX_MESSAGE_LENGTH) {
			throw new ConvexError(`Messages cannot exceed ${MAX_MESSAGE_LENGTH} characters`);
		}

		const messageId = await ctx.db.insert('messages', {
			roomId: args.roomId,
			profileId: profile._id,
			content
		});
		return await ctx.db.get(messageId);
	}
});

// Last-read feature: moves the viewer's watermark for a room up to "now". Called by the chat page
// whenever the viewer has the room open and the summaries subscription reports unread messages.
// Requires only READ access on purpose: closed/archived chats stay readable, and reading them
// should still clear their badge. The parent "View as Child" surfaces (parentAccounts.ts) never
// call this — a parent reading a child's chat must not silently mark it read for the child.
export const markRoomRead = mutation({
	args: {
		roomId: v.id('rooms')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		await requireRoomAccess(ctx, args.roomId, profile._id, 'read');

		// Watermark = the newest message's _creationTime, not Date.now(): "read" means "seen
		// everything currently in the room", and message _creationTime carries sub-millisecond
		// precision that a wall-clock watermark taken in the same millisecond would sort below.
		const latestMessage = await ctx.db
			.query('messages')
			.withIndex('by_room', (q) => q.eq('roomId', args.roomId))
			.order('desc')
			.first();
		const lastReadAt = latestMessage?._creationTime ?? Date.now();
		const marker = await getReadMarker(ctx, profile._id, args.roomId);
		if (marker) {
			// Guard against out-of-order calls (two tabs, retries) regressing the watermark.
			if (marker.lastReadAt < lastReadAt) {
				await ctx.db.patch(marker._id, { lastReadAt });
			}
			return null;
		}
		await ctx.db.insert('roomReadMarkers', {
			roomId: args.roomId,
			profileId: profile._id,
			lastReadAt
		});
		return null;
	}
});
