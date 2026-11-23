// Chat email notifications (CL-764): the model side of "tell absent members about new messages".
// chat.ts hosts the Convex functions (the delayed delivery check, the send action and its result
// callback); this file owns the invariant they all share:
//
//   An email is owed to a recipient's AUDIENCE when a room holds a message from someone else
//   that is newer than BOTH the recipient's read watermark (roomReadMarkers.lastReadAt) and the
//   newest message the last successfully sent email TO THAT AUDIENCE covered
//   (roomEmailMarkers.coveredThroughAt for that audience), and that message has been unseen for
//   CHAT_EMAIL_DELAY_MS.
//
// Everything else is a bound on that rule: a recipient who still hasn't read the batch an
// audience was last emailed about is not nagged again for CHAT_EMAIL_REPEAT_AFTER_MS (after
// which NEW activity re-emails — one missed email must not mean permanent silence), and an
// in-flight send is not duplicated. Coverage advances only when Resend accepts the email, so a
// failed send leaves the batch owed and the next message retries.
//
// Audiences (CL-768/CL-769, review edge case 5): adults have one, 'self'. A child account's chat
// email can be owed to 'self' (the child's confirmed notificationEmail) and/or 'parent' (the
// approved parent's copy), per notificationRouting.ts: a critical review chat goes to both once
// the child's address is confirmed; a club/project chat goes to the parent until then, after
// that to the child plus a parent copy only if the parent turned on chatCopies. Each audience is
// its own row, its own grace job and its own email: grace window, repeat cap, `sendingSince` and
// `coveredThroughAt` are all per audience, so a failed parent copy never advances the child's
// coverage (or the other way round), two result callbacks never race on one `sendingSince`, and
// nobody is double-emailed. The two copies are NEVER one email with two recipients — the parent
// copy carries a one-time sign-in link.
//
// What stays per RECIPIENT, not per audience, is the read watermark: only the child reading the
// room counts. A parent viewing as the child (CL-801) never marks anything read (writes are refused)
// (review edge case 7, accepted): the parent copy repeats at most once per 12h window while the
// child leaves the batch unread, like the child's own copy.
//
// Routing flips mid-batch (review edge case 6, accepted): when the child confirms their address
// (or the parent removes it), the new audience's row starts empty, so the next new message is a
// fresh batch for it and the previous audience simply stops being scheduled. Rows written before
// the audience field existed are read as 'self' (getEmailMarker), so right after the deploy a
// child account's old row (which tracked the emails its parent got) becomes the child's 'self'
// coverage, and the parent may get one more email about a batch they had already been told about.
//
// Every message insert goes through postRoomMessage so no code path can add a message without
// deciding, explicitly, whether it notifies.

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { getChatEmailKind, getRoomJoinedAt, listRoomRecipientProfileIds } from './chatModel';
import { hasParentConsent, planEmailAudiences, type EmailAudience } from './notificationRouting';
import { isKindMuted, notificationKindConfig, type NotificationKind } from './notificationsModel';

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

// Legacy rows (no `audience`) are 'self' rows.
export const emailMarkerAudience = (marker: Doc<'roomEmailMarkers'>): EmailAudience =>
	marker.audience ?? 'self';

// One audience's row. 'self' falls back to a legacy row without the field.
export const getEmailMarker = async (
	ctx: Ctx,
	profileId: Id<'profiles'>,
	roomId: Id<'rooms'>,
	audience: EmailAudience
) => {
	const exact = await ctx.db
		.query('roomEmailMarkers')
		.withIndex('by_profile_room_audience', (q) =>
			q.eq('profileId', profileId).eq('roomId', roomId).eq('audience', audience)
		)
		.first();
	if (exact || audience !== 'self') return exact;
	return await ctx.db
		.query('roomEmailMarkers')
		.withIndex('by_profile_room_audience', (q) =>
			q.eq('profileId', profileId).eq('roomId', roomId).eq('audience', undefined)
		)
		.first();
};

// Every audience's row for (recipient, room) in one range read: at most one per audience, plus
// possibly one legacy row.
const listEmailMarkers = async (ctx: Ctx, profileId: Id<'profiles'>, roomId: Id<'rooms'>) => {
	const rows = await ctx.db
		.query('roomEmailMarkers')
		.withIndex('by_profile_and_room', (q) => q.eq('profileId', profileId).eq('roomId', roomId))
		.take(3);
	const byAudience = new Map<EmailAudience, Doc<'roomEmailMarkers'>>();
	for (const row of rows) {
		const audience = emailMarkerAudience(row);
		// An explicit row wins over a legacy one (getEmailMarker reads it the same way).
		if (!byAudience.has(audience) || row.audience !== undefined) byAudience.set(audience, row);
	}
	return byAudience;
};

// The recipient's own chat mute (never consulted for critical chat kinds, which have no
// preference key). Only ever removes the recipient's own copy (notificationRouting.ts, S6).
export const isChatEmailSelfMuted = async (
	ctx: MutationCtx,
	profileId: Id<'profiles'>,
	kind: NotificationKind
) => {
	const { preferenceKey } = notificationKindConfig[kind];
	return preferenceKey !== null && (await isKindMuted(ctx, profileId, preferenceKey));
};

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

// True when the recipient still hasn't read the batch this audience was last emailed about AND
// that email is younger than the repeat window: the one case where new activity does not email.
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

// Called on every notifying message. For each recipient this is one range read of their email
// rows for the room and one consent lookup (adults have none, so they are only ever owed their
// own copy); only the FIRST message of an unread batch schedules a delivery check per audience
// (later sends see `scheduledFor` in the future, or the repeat cap, and skip), so a busy room
// does no repeated scheduling work. A `scheduledFor` in the past means a delivery job was lost —
// reschedule rather than treat it as pending.
export const scheduleChatEmailNotifications = async (
	ctx: MutationCtx,
	room: Doc<'rooms'>,
	senderProfileId: Id<'profiles'> | undefined
) => {
	const recipients = await listRoomRecipientProfileIds(ctx, room);
	const kind = getChatEmailKind(room);
	const { tier } = notificationKindConfig[kind];
	const now = Date.now();
	for (const profileId of recipients) {
		if (profileId === senderProfileId) continue;
		const markers = await listEmailMarkers(ctx, profileId, room._id);
		const candidates: EmailAudience[] = (await hasParentConsent(ctx, profileId))
			? ['self', 'parent']
			: ['self'];
		let open = candidates.filter((audience) => {
			const scheduledFor = markers.get(audience)?.scheduledFor;
			return !(scheduledFor && scheduledFor > now);
		});
		if (open.length === 0) continue;
		const unreadFloor = await getUnreadFloor(ctx, room, profileId);
		open = open.filter(
			(audience) => !isWithinRepeatCap(markers.get(audience) ?? null, unreadFloor, now)
		);
		if (open.length === 0) continue;
		const profile = await ctx.db.get(profileId);
		if (!profile) continue;
		// Muted recipients never get a job scheduled for their own copy; the delivery re-checks in
		// case someone mutes during the grace window. A child's mute never stops the parent's copy.
		// Critical chat kinds (review_chat_activity) cannot be muted.
		const owed = await planEmailAudiences(ctx, {
			profile,
			tier,
			chat: true,
			selfMuted: await isChatEmailSelfMuted(ctx, profileId, kind)
		});
		for (const audience of open) {
			if (!owed.includes(audience)) continue;
			const scheduledFor = now + CHAT_EMAIL_DELAY_MS;
			const marker = markers.get(audience);
			if (marker) {
				// Also heals a legacy row into an explicit 'self' row.
				await ctx.db.patch(marker._id, { scheduledFor, audience });
			} else {
				await ctx.db.insert('roomEmailMarkers', {
					roomId: room._id,
					profileId,
					audience,
					scheduledFor
				});
			}
			await ctx.scheduler.runAfter(
				CHAT_EMAIL_DELAY_MS,
				internal.chat.deliverChatEmailNotification,
				{ roomId: room._id, profileId, audience }
			);
		}
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
