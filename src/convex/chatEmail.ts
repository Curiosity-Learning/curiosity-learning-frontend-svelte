// Chat email notifications (CL-764): the model side of "tell absent members about new messages".
// chat.ts hosts the Convex functions (the delayed delivery check, the send action and its result
// callback); this file owns the invariant they all share:
//
//   An email is owed to a recipient when a room holds a message from someone else that is
//   newer than BOTH their read watermark (roomReadMarkers.lastReadAt) and the newest message
//   the last successfully sent email covered (roomEmailMarkers.coveredThroughAt), and that
//   message has been unseen for CHAT_EMAIL_DELAY_MS.
//
// Everything else is a bound on that rule: a recipient who still hasn't read the batch they were
// last emailed about is not nagged again for CHAT_EMAIL_REPEAT_AFTER_MS (after which NEW activity
// re-emails — one missed email must not mean permanent silence), and an in-flight send is not
// duplicated. Coverage advances only when Resend accepts the email, so a failed send leaves the
// batch owed and the next message retries.
//
// Every message insert goes through postRoomMessage so no code path can add a message without
// deciding, explicitly, whether it notifies.

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { getChatEmailKind, getRoomJoinedAt, listRoomRecipientProfileIds } from './chatModel';
import { isKindMuted, notificationKindConfig } from './notificationsModel';

type Ctx = QueryCtx | MutationCtx;

// Grace window between the first unseen message of a batch and the email about it. Long enough
// that someone active in the app reads the message in-app first (no email at all), short enough
// that an absent member hears about a conversation while it is still happening — deliberately
// NOT a debounce on room activity, which a long-running conversation would postpone forever.
export const CHAT_EMAIL_DELAY_MS = 10 * 60 * 1000;
// Anti-nag cap: a recipient who hasn't read the batch they were last emailed about is not
// emailed again until this much time has passed since that email. Reading the room (which moves
// lastReadAt past coveredThroughAt) lifts the cap immediately. Message-driven on purpose: a room
// that goes quiet never re-emails, and even a constantly active unopened room is bounded to one
// email per window.
export const CHAT_EMAIL_REPEAT_AFTER_MS = 12 * 60 * 60 * 1000;
// How long a delivery check trusts a `sendingSince` hand-off before treating it as a crashed send.
export const CHAT_EMAIL_SEND_TIMEOUT_MS = 10 * 60 * 1000;

export const getReadMarker = async (ctx: Ctx, profileId: Id<'profiles'>, roomId: Id<'rooms'>) =>
	await ctx.db
		.query('roomReadMarkers')
		.withIndex('by_profile_and_room', (q) => q.eq('profileId', profileId).eq('roomId', roomId))
		.first();

export const getEmailMarker = async (ctx: Ctx, profileId: Id<'profiles'>, roomId: Id<'rooms'>) =>
	await ctx.db
		.query('roomEmailMarkers')
		.withIndex('by_profile_and_room', (q) => q.eq('profileId', profileId).eq('roomId', roomId))
		.first();

// The unread floor for a viewer with no read marker yet is their context-join time, mirroring
// chat.listRoomSummaries — shared with the email path so "has unread" means the same thing for
// badges and emails.
export const getUnreadFloor = async (ctx: Ctx, room: Doc<'rooms'>, profileId: Id<'profiles'>) => {
	const readMarker = await getReadMarker(ctx, profileId, room._id);
	return readMarker?.lastReadAt ?? (await getRoomJoinedAt(ctx, room, profileId));
};

// The newest message the last successful email covered. Rows written before coveredThroughAt
// existed only have lastEmailedAt; the send time is later than every message it covered, so it
// is a valid (if slightly over-inclusive) watermark until the next successful email replaces it.
export const getCoveredThroughAt = (marker: Doc<'roomEmailMarkers'> | null) =>
	marker?.coveredThroughAt ?? marker?.lastEmailedAt;

// True when the recipient still hasn't read the batch they were last emailed about AND that
// email is younger than the repeat window: the one case where new activity does not email.
export const isWithinRepeatCap = (
	marker: Doc<'roomEmailMarkers'> | null,
	unreadFloor: number,
	now: number
) => {
	const coveredThroughAt = getCoveredThroughAt(marker);
	if (coveredThroughAt === undefined || !marker?.lastEmailedAt) return false;
	const emailedBatchStillUnread = unreadFloor < coveredThroughAt;
	return emailedBatchStillUnread && now - marker.lastEmailedAt < CHAT_EMAIL_REPEAT_AFTER_MS;
};

// Called on every notifying message. For each recipient this is at most one marker read; only
// the FIRST message of an unread batch schedules a delivery check (later sends see
// `scheduledFor` in the future, or the repeat cap, and skip), so a busy room does no repeated
// scheduling work. A `scheduledFor` in the past means a delivery job was lost — reschedule
// rather than treat it as pending.
export const scheduleChatEmailNotifications = async (
	ctx: MutationCtx,
	room: Doc<'rooms'>,
	senderProfileId: Id<'profiles'> | undefined
) => {
	const recipients = await listRoomRecipientProfileIds(ctx, room);
	const kindConfig = notificationKindConfig[getChatEmailKind(room)];
	const now = Date.now();
	for (const profileId of recipients) {
		if (profileId === senderProfileId) continue;
		const emailMarker = await getEmailMarker(ctx, profileId, room._id);
		if (emailMarker?.scheduledFor && emailMarker.scheduledFor > now) continue;
		const unreadFloor = await getUnreadFloor(ctx, room, profileId);
		if (isWithinRepeatCap(emailMarker, unreadFloor, now)) continue;
		// Muted recipients never get a job scheduled; the delivery re-checks in case someone
		// mutes during the grace window. Critical chat kinds (review_chat_activity) have no
		// preference key and cannot be muted.
		if (kindConfig.preferenceKey && (await isKindMuted(ctx, profileId, kindConfig.preferenceKey)))
			continue;
		const scheduledFor = now + CHAT_EMAIL_DELAY_MS;
		if (emailMarker) {
			await ctx.db.patch(emailMarker._id, { scheduledFor });
		} else {
			await ctx.db.insert('roomEmailMarkers', { roomId: room._id, profileId, scheduledFor });
		}
		await ctx.scheduler.runAfter(CHAT_EMAIL_DELAY_MS, internal.chat.deliverChatEmailNotification, {
			roomId: room._id,
			profileId
		});
	}
};

// The ONLY way a message enters a room. `notify` is mandatory so every caller states whether the
// message is a conversation turn that absent members should be emailed about (chat.sendMessage)
// or a system/decision notice that is already announced through its own notification
// (application decisions dispatch 'application_status'; emailing the room on top would double
// up). A message with no profileId is a system message.
export const postRoomMessage = async (
	ctx: MutationCtx,
	args: {
		room: Doc<'rooms'>;
		profileId?: Id<'profiles'>;
		content: string;
		notify: boolean;
	}
) => {
	const messageId = await ctx.db.insert('messages', {
		roomId: args.room._id,
		profileId: args.profileId,
		content: args.content
	});
	if (args.notify) {
		await scheduleChatEmailNotifications(ctx, args.room, args.profileId);
	}
	return messageId;
};
