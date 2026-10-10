import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from './_generated/server';
import { internalAction, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { getAuthUserEmail } from './authEmail';
import { CHILD_EMAIL_DOMAIN } from './childAccounts';
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

// Who a notification email really goes to. Adult accounts: their Better Auth email, read as
// themselves. Child accounts (synthetic @children.curiosity.local auth email, never emailed):
// - critical notices always go to the approved parent (parentChildConsents.parentEmail) — the
//   parent is the accountable adult for account actions and review conversations;
// - everything else goes to the child's own `notificationEmail` when the linked parent has set
//   one (parentAccounts.setChildNotificationEmail), read by the child as themselves;
// - with no such address, `parentFallback` decides: chat emails ask for it (the parent has a
//   read-only view of the child's chats and parent-facing copy exists), other high-tier kinds
//   do not (their links lead to pages a parent cannot open) and resolve to no email. A parent
//   the child has unlinked (consent `unlinkedAt`) gets no parentFallback email.
// `audience` tells the caller whether to word the email for the recipient themselves or for a
// parent reading about their child.
export type EmailRecipient = { to: string; audience: 'self' | 'parent' };

export const resolveEmailRecipient = async (
	ctx: QueryCtx | MutationCtx,
	args: { profile: Doc<'profiles'>; critical: boolean; parentFallback?: boolean }
): Promise<EmailRecipient | null> => {
	const email = await getAuthUserEmail(ctx, args.profile.authUserId);
	if (!email) return null;
	if (!email.toLowerCase().endsWith(`@${CHILD_EMAIL_DOMAIN}`)) {
		return { to: email, audience: 'self' };
	}

	// Child account: never email the synthetic address.
	if (!args.critical && args.profile.notificationEmail) {
		return { to: args.profile.notificationEmail, audience: 'self' };
	}
	if (!args.critical && !args.parentFallback) return null;
	const consent = await ctx.db
		.query('parentChildConsents')
		.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', args.profile._id))
		.order('desc')
		.collect();
	// Once a 16+ child has unlinked this parent (parentAccounts.unlinkParent sets unlinkedAt),
	// non-critical chat no longer goes to them: it describes chats the parent can no longer
	// read. Critical notices still go to the parent who gave consent.
	const approved = consent.find(
		(row) => row.status === 'approved' && (args.critical || row.unlinkedAt === undefined)
	);
	return approved?.parentEmail ? { to: approved.parentEmail, audience: 'parent' } : null;
};

export const resolveNotificationEmailRecipient = internalQuery({
	args: {
		recipientProfileId: v.id('profiles'),
		critical: v.boolean()
	},
	returns: v.union(v.string(), v.null()),
	handler: async (ctx, args) => {
		const profile = await ctx.db.get(args.recipientProfileId);
		if (!profile) return null;
		const recipient = await resolveEmailRecipient(ctx, { profile, critical: args.critical });
		return recipient?.to ?? null;
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
	// Pre-resolved address: the caller already ran resolveEmailRecipient (chat does, because the
	// wording depends on the audience) and the result must not be re-derived differently here.
	to?: string;
	note?: NotificationEmailNote;
};

export type NotificationEmailResult =
	| { status: 'skipped' }
	| { status: 'sent'; to: string; providerMessageId: string | null }
	| { status: 'failed'; to: string; error: string };

// The email channel shared by dispatched notifications and chat emails: resolves the deliverable
// address (none for a child account on a non-critical kind → 'skipped'), renders the template and
// hands it to Resend. Never throws — a provider failure is already reported to monitoring inside
// sendEmail and comes back as 'failed' so the caller can record it (and, for chat, NOT mark the
// batch as covered). Only the recipient address is resolved here on purpose: the caller owns the
// wording and the link, because those depend on who the email is really going to (a parent
// reading about their child's chat gets different copy and a different page).
export const deliverNotificationEmail = async (
	ctx: ActionCtx,
	args: NotificationEmailArgs
): Promise<NotificationEmailResult> => {
	const to =
		args.to ??
		(await ctx.runQuery(internal.notifications.resolveNotificationEmailRecipient, {
			recipientProfileId: args.recipientProfileId,
			critical: args.critical
		}));
	if (!to) return { status: 'skipped' };

	const baseUrl = process.env.BETTER_AUTH_URL ?? process.env.PUBLIC_CONVEX_SITE_URL;
	// Relative app paths only become links when a base url is configured.
	const toAbsoluteUrl = (url: string | undefined) =>
		url
			? url.startsWith('/')
				? baseUrl
					? `${baseUrl.replace(/\/+$/, '')}${url}`
					: undefined
				: url
			: baseUrl;
	const ctaUrl = toAbsoluteUrl(args.url);
	const note = args.note
		? { ...args.note, url: args.note.url ? toAbsoluteUrl(args.note.url) : undefined }
		: undefined;

	try {
		const { providerMessageId } = await sendEmail({
			to,
			type: 'notification',
			...notificationEmail({ title: args.title, message: args.message, ctaUrl, note })
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
		createdAt: Date.now()
	});
};

export const logEmailDelivery = internalMutation({
	args: {
		recipientProfileId: v.id('profiles'),
		kind: v.string(),
		subject: v.string(),
		result: emailDeliveryResultValidator
	},
	handler: async (ctx, args) => {
		await recordEmailDelivery(ctx, args);
		return null;
	}
});

// Sends the email channel of a dispatched notification (scheduled by dispatchNotification
// in notificationsModel.ts for critical/high tiers). Failures are already reported to
// monitoring inside sendEmail and recorded on emailDeliveries; they never surface as a
// scheduler error loop.
export const sendNotificationEmail = internalAction({
	args: {
		recipientProfileId: v.id('profiles'),
		critical: v.boolean(),
		kind: v.optional(v.string()),
		title: v.string(),
		message: v.string(),
		url: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const kind = args.kind ?? 'notification';
		const result = await deliverNotificationEmail(ctx, { ...args, kind });
		await ctx.runMutation(internal.notifications.logEmailDelivery, {
			recipientProfileId: args.recipientProfileId,
			kind,
			subject: args.title,
			result
		});
	}
});
