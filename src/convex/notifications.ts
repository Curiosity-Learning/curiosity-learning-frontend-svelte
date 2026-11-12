import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { ActionCtx, MutationCtx } from './_generated/server';
import {
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	query
} from './_generated/server';
import { mintMagicLink } from './magicLinks';
import { EMAIL_MAGIC_LINK_SECONDS } from '../lib/auth/magic-link';
import { resolveEmailRecipients, type EmailAudience } from './notificationRouting';
import { sendEmail } from './email/resend';
import { notificationEmail } from './email/templates';
import { getProfileByAuthUserId, requireIdentity, requireProfile } from './permissions';

export const list = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		return await ctx.db
			.query('notifications')
			.withIndex('by_profile_and_created', (q) => q.eq('profileId', profile._id))
			.order('desc')
			.take(100);
	}
});

export const markRead = mutation({
	args: {
		notificationId: v.id('notifications')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const notification = await ctx.db.get(args.notificationId);
		if (!notification || notification.profileId !== profile._id) {
			return { success: false };
		}

		await ctx.db.patch(args.notificationId, {
			isRead: true
		});

		return { success: true };
	}
});

export const markAllRead = mutation({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		// Bound the work; the UI currently shows at most 100 notifications.
		const notifications = await ctx.db
			.query('notifications')
			.withIndex('by_profile_and_created', (q) => q.eq('profileId', profile._id))
			.order('desc')
			.take(100);

		for (const notification of notifications) {
			if (notification.isRead) continue;
			await ctx.db.patch(notification._id, { isRead: true });
		}

		return { success: true };
	}
});

export const unreadCount = query({
	args: {},
	handler: async (ctx) => {
		// Deliberately NOT `requireProfile` (see its suspension-bypass warning in permissions.ts —
		// this is one of the two intentional exemptions): an unread-count badge should degrade to
		// 0 rather than throw for an unauthenticated caller or a profile that doesn't exist yet,
		// and there's no reason to hide it from a suspended account either.
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return 0;
		const profile = await getProfileByAuthUserId(ctx, identity.subject);
		if (!profile) return 0;
		// Bounded like `list`/`markAllRead`: the UI shows at most 100 notifications.
		const notifications = await ctx.db
			.query('notifications')
			.withIndex('by_profile_and_created', (q) => q.eq('profileId', profile._id))
			.order('desc')
			.take(100);
		return notifications.filter((notification) => !notification.isRead).length;
	}
});

// Who a notification email really goes to lives in notificationRouting.ts (adults: themselves;
// child accounts: the parent and/or the child's confirmed address, per kind, the parent's
// per-child settings and the child's own mutes — the matrix is documented there). Re-exported
// here because this module is the email channel's public face.
export { resolveEmailRecipients, type EmailAudience };
export type { EmailRecipient } from './notificationRouting';

const emailAudienceValidator = v.union(v.literal('self'), v.literal('parent'));

export const resolveNotificationEmailRecipients = internalQuery({
	args: {
		recipientProfileId: v.id('profiles'),
		critical: v.boolean(),
		// The recipient's own mute for this kind (only ever removes their own copy).
		selfMuted: v.optional(v.boolean())
	},
	returns: v.array(
		v.object({
			to: v.string(),
			audience: emailAudienceValidator,
			// The child's display name, for parent-facing wording.
			childName: v.string()
		})
	),
	handler: async (ctx, args) => {
		const profile = await ctx.db.get(args.recipientProfileId);
		if (!profile) return [];
		return await resolveEmailRecipients(ctx, {
			profile,
			tier: args.critical ? 'critical' : 'high',
			chat: false,
			selfMuted: args.selfMuted ?? false
		});
	}
});

// A secondary, lower-emphasis paragraph under the CTA — used to tell a parent reading about
// their child's chat that they can hand these emails over to the child (see chat.ts).
export type NotificationEmailNote = { text: string; url?: string; linkLabel?: string };

export const notificationEmailNoteValidator = v.object({
	text: v.string(),
	url: v.optional(v.string()),
	linkLabel: v.optional(v.string())
});

export type NotificationEmailArgs = {
	recipientProfileId: Id<'profiles'>;
	critical: boolean;
	kind: string;
	title: string;
	message: string;
	url?: string;
	// Button text override (chat emails to a parent name the child); template default otherwise.
	ctaLabel?: string;
	// The ONE resolved recipient of this email (notificationRouting.resolveEmailRecipients). A
	// notice owed to a parent and a child is two calls, two emails, never one email with both
	// addresses: the parent copy carries a sign-in link.
	to: string;
	audience: EmailAudience;
	// For parent wording of dispatched notices.
	childName?: string;
	// True when the caller already worded the email and chose the link for this audience (chat
	// does: its copy depends on the room). For audience 'parent', `url` is then the app path the
	// sign-in link continues to (the link itself is minted here, see below). False for
	// dispatched notifications, whose child-facing wording is rewritten for a parent here.
	wordedByCaller?: boolean;
	note?: NotificationEmailNote;
};

export type NotificationEmailResult =
	| { status: 'skipped' }
	| { status: 'sent'; to: string; providerMessageId: string | null }
	| { status: 'failed'; to: string; error: string };

// The email channel shared by dispatched notifications and chat emails: renders the template for
// one already-resolved recipient and hands it to Resend. Never throws — a provider failure is
// already reported to monitoring inside sendEmail and comes back as 'failed' so the caller can
// record it (and, for chat, NOT mark the batch as covered).
export const deliverNotificationEmail = async (
	ctx: ActionCtx,
	args: NotificationEmailArgs
): Promise<NotificationEmailResult> => {
	const to = args.to;

	// The ONE place a parent audience becomes a one-time sign-in link (chat and dispatched
	// notifications both come through here). The parent's account was created password-less at
	// consent approval (childSignup.approveConsent), so a plain link would strand them on a
	// sign-in form they cannot complete; the address proved itself by approving consent, and the
	// email goes to that same address. Minted here, in the send action, right before sendEmail —
	// never in a mutation that schedules this — so no plaintext token is stored in scheduler args
	// (review S2). One token per email (S3): any other link in the email is a plain path the
	// button's session covers. Plain path when no link can be minted (no BETTER_AUTH_URL, or the
	// account may not sign in by link, see magicLinks.isMagicLinkRecipient). The child's own copy
	// ('self') is always plain.
	let { url, ctaLabel, message, note: rawNote } = args;
	let ctaSignsIn = false;
	if (args.audience === 'parent') {
		// A dispatched notice about a child account carries the child-facing link — the child's
		// own pages — which the parent cannot open: point it at the parent's read-only view of the
		// child and say who it is about. Callers that worded the email (chat) already chose the
		// parent's page and wording.
		const callbackPath = args.wordedByCaller && url ? url : `/child/${args.recipientProfileId}`;
		if (!args.wordedByCaller) {
			const childName = args.childName ?? 'your child';
			ctaLabel = `Open ${childName}'s account`;
			message = `This is about ${childName}'s Curiosity Learning account. ${args.message}`;
			// A non-critical dispatched notice only reaches a parent as an opted-in copy (the
			// child has a confirmed address of their own, notificationRouting.ts): say why, and
			// where to turn it off.
			if (!args.critical && !rawNote) {
				rawNote = {
					text: `You're getting a copy because you chose to receive ${childName}'s activity emails too. You can turn this off on ${childName}'s page.`
				};
			}
		}
		const signInUrl = await mintMagicLink(ctx, {
			email: to,
			callbackPath,
			expiresInSeconds: EMAIL_MAGIC_LINK_SECONDS
		});
		url = signInUrl ?? callbackPath;
		ctaSignsIn = Boolean(signInUrl);
	}

	const baseUrl = process.env.BETTER_AUTH_URL ?? process.env.PUBLIC_CONVEX_SITE_URL;
	// Relative app paths only become links when a base url is configured. Absolute urls (the
	// magic sign-in links in parent chat emails, see magicLinks.ts) pass through unchanged.
	const toAbsoluteUrl = (url: string | undefined) =>
		url
			? url.startsWith('/')
				? baseUrl
					? `${baseUrl.replace(/\/+$/, '')}${url}`
					: undefined
				: url
			: baseUrl;
	const ctaUrl = toAbsoluteUrl(url);
	const note = rawNote
		? { ...rawNote, url: rawNote.url ? toAbsoluteUrl(rawNote.url) : undefined }
		: undefined;

	try {
		const { providerMessageId } = await sendEmail({
			to,
			type: 'notification',
			...notificationEmail({
				title: args.title,
				message,
				ctaUrl,
				ctaLabel,
				note,
				ctaSignsIn,
				// A parent cannot switch these off in Settings (the default footer's advice), so
				// say why they got it instead (CL-807).
				footer:
					args.audience === 'parent'
						? `You received this email because you are the parent or guardian on ${args.childName ?? 'your child'}'s Curiosity Learning account.`
						: undefined
			})
		});
		return { status: 'sent', to, providerMessageId };
	} catch (error) {
		return { status: 'failed', to, error: error instanceof Error ? error.message : String(error) };
	}
};

export const emailDeliveryResultValidator = v.union(
	v.object({ status: v.literal('skipped') }),
	v.object({
		status: v.literal('sent'),
		to: v.string(),
		providerMessageId: v.union(v.string(), v.null())
	}),
	v.object({ status: v.literal('failed'), to: v.string(), error: v.string() })
);

// Appends the emailDeliveries audit row for a sent/failed email. Skipped deliveries (no
// deliverable address) leave no row: nothing was attempted.
export const recordEmailDelivery = async (
	ctx: MutationCtx,
	args: {
		recipientProfileId: Id<'profiles'>;
		kind: string;
		subject: string;
		result: NotificationEmailResult;
		roomId?: Id<'rooms'>;
		coveredThroughAt?: number;
		audience?: EmailAudience;
	}
) => {
	if (args.result.status === 'skipped') return;
	await ctx.db.insert('emailDeliveries', {
		recipientProfileId: args.recipientProfileId,
		to: args.result.to,
		kind: args.kind,
		subject: args.subject,
		status: args.result.status,
		error: args.result.status === 'failed' ? args.result.error : undefined,
		providerMessageId:
			args.result.status === 'sent' ? (args.result.providerMessageId ?? undefined) : undefined,
		roomId: args.roomId,
		coveredThroughAt: args.coveredThroughAt,
		audience: args.audience,
		createdAt: Date.now()
	});
};

export const logEmailDelivery = internalMutation({
	args: {
		recipientProfileId: v.id('profiles'),
		kind: v.string(),
		subject: v.string(),
		result: emailDeliveryResultValidator,
		audience: v.optional(emailAudienceValidator)
	},
	handler: async (ctx, args) => {
		await recordEmailDelivery(ctx, args);
		return null;
	}
});

// Sends the email channel of a dispatched notification (scheduled by dispatchNotification
// in notificationsModel.ts for critical/high tiers): one separate email per resolved recipient
// (a child account's notice can be owed to the parent AND the child), each with its own
// emailDeliveries row. A failure for one never stops the other. Failures are already reported to
// monitoring inside sendEmail and recorded on emailDeliveries; they never surface as a scheduler
// error loop.
export const sendNotificationEmail = internalAction({
	args: {
		recipientProfileId: v.id('profiles'),
		critical: v.boolean(),
		// Optional: jobs scheduled before CL-768 step 6 had no mute flag (they were only
		// scheduled for unmuted recipients).
		selfMuted: v.optional(v.boolean()),
		kind: v.optional(v.string()),
		title: v.string(),
		message: v.string(),
		url: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const kind = args.kind ?? 'notification';
		const recipients = await ctx.runQuery(
			internal.notifications.resolveNotificationEmailRecipients,
			{
				recipientProfileId: args.recipientProfileId,
				critical: args.critical,
				selfMuted: args.selfMuted
			}
		);
		for (const recipient of recipients) {
			const result = await deliverNotificationEmail(ctx, {
				recipientProfileId: args.recipientProfileId,
				critical: args.critical,
				kind,
				title: args.title,
				message: args.message,
				url: args.url,
				to: recipient.to,
				audience: recipient.audience,
				childName: recipient.childName
			});
			await ctx.runMutation(internal.notifications.logEmailDelivery, {
				recipientProfileId: args.recipientProfileId,
				kind,
				subject: args.title,
				result,
				audience: recipient.audience
			});
		}
	}
});
