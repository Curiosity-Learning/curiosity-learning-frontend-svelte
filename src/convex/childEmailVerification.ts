import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import {
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	query
} from './_generated/server';
import { profileDisplayName } from './chatModel';
import { sendEmail } from './email/resend';
import {
	childEmailVerificationEmail,
	childRoutingChangedEmail,
	parentUnlinkedEmail,
	type ChildRoutingChange
} from './email/templates';
import { generateMagicLinkToken, hashMagicLinkToken } from './magicLinks';
import type { NotificationEmailResult } from './notifications';
import { requireIdentity, requireProfile } from './permissions';
import { maskEmail } from '../lib/auth/magic-link';
import { VERIFY_EMAIL_PATH_PREFIX } from '../lib/domain/child-notification-email';

// Child notification email confirmation (CL-768, review B2/B3).
//
// A parent enters an address for their child on the child's page (parentAccounts
// .setChildNotificationEmail) or on the consent screen (childSignup.approveConsent, same issue
// path below); a child aged 16+ can enter their own from Settings (parentAccounts
// .setMyNotificationEmail, CL-769 review D4 / edge case 13, same pending flow). Until the CHILD
// confirms it, the address is pending and nothing is routed to it
// (notificationRouting.resolveEmailRecipients): the only email it ever gets is the generic confirmation
// email below. Confirming requires the child's own session, not just the link: clicking a link
// proves control of an inbox, not that the inbox is the child's — a typo, a classmate or another
// adult would otherwise end up receiving a minor's club activity and session times, and the
// parent's own copies would silently stop.
//
// Flow:
// 1. setChildNotificationEmail (mutation) stores the pending address and calls
//    issueChildEmailVerification: it deletes the child's unconsumed rows and inserts a row
//    WITHOUT a token, then schedules sendChildEmailVerification with only the row id.
// 2. sendChildEmailVerification (action, OS randomness — see magicLinks.ts on mutation RNG)
//    generates the token, stores only its hash on the row (setVerificationTokenHash), and emails
//    `${BETTER_AUTH_URL}/verify-email/{token}`. The plaintext token never sits in scheduler args.
// 3. /verify-email/[token] (inside the (app) group: signing in is required) shows
//    getChildEmailVerification for the CALLER and confirms with confirmChildEmail, which checks
//    the token AND that the caller is the child it was issued for.
//
// Every routing change (pending, confirmed, removed) also emails the parent a plain notice
// (review S5): the change may have been made by someone else on a signed-in device.
//
// No public mutation here takes a childProfileId (see the structural test in
// parentAccounts.spec.ts): the child is always derived from the token, and the internal
// mutations are keyed by the verification row.

// How long a confirmation link stays usable (review B2: 48-72 h). A child may only check that
// inbox now and then; an expired link costs the parent one "Resend".
export const CHILD_EMAIL_VERIFICATION_TTL_MS = 72 * 60 * 60 * 1000;

// At most 3 confirmation emails per child per 24 h (set, change and resend all count): each one
// goes to an address nobody has confirmed, so the cap keeps the app from being used to send mail
// to someone else's inbox.
export const CHILD_EMAIL_VERIFICATION_RATE_LIMIT = {
	maxAttempts: 3,
	windowMs: 24 * 60 * 60 * 1000
};
export const childEmailVerificationRateLimitKey = (childProfileId: Id<'profiles'>) =>
	`childEmailVerification:${childProfileId}`;

const getAppBaseUrl = () => process.env.BETTER_AUTH_URL?.trim().replace(/\/+$/, '') || null;

const sendResult = async (
	send: () => Promise<{ providerMessageId: string | null }>,
	to: string
): Promise<NotificationEmailResult> => {
	try {
		const { providerMessageId } = await send();
		return { status: 'sent', to, providerMessageId };
	} catch (error) {
		return { status: 'failed', to, error: error instanceof Error ? error.message : String(error) };
	}
};

// ---------------------------------------------------------------------------------------------
// Issuing (called from parentAccounts.setChildNotificationEmail)
// ---------------------------------------------------------------------------------------------

/** Deletes every unconsumed confirmation row for the child, so older links stop working. */
export const invalidateChildEmailVerifications = async (
	ctx: MutationCtx,
	childProfileId: Id<'profiles'>
) => {
	const rows = await ctx.db
		.query('childEmailVerifications')
		.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', childProfileId))
		.collect();
	for (const row of rows) {
		if (row.consumedAt === undefined) await ctx.db.delete(row._id);
	}
};

/**
 * Records a confirmation request for the child's (already stored) pending address and schedules
 * the email. Older unconsumed links stop working. Rate limiting is the caller's job.
 */
export const issueChildEmailVerification = async (
	ctx: MutationCtx,
	args: { childProfileId: Id<'profiles'>; email: string; requestedByProfileId: Id<'profiles'> }
) => {
	await invalidateChildEmailVerifications(ctx, args.childProfileId);
	const now = Date.now();
	const verificationId = await ctx.db.insert('childEmailVerifications', {
		childProfileId: args.childProfileId,
		email: args.email,
		expiresAt: now + CHILD_EMAIL_VERIFICATION_TTL_MS,
		createdAt: now,
		requestedByProfileId: args.requestedByProfileId
	});
	await ctx.scheduler.runAfter(0, internal.childEmailVerification.sendChildEmailVerification, {
		verificationId
	});
};

/** Emails the parent that the child's routing changed (review S5). */
export const scheduleRoutingChangedNotice = async (
	ctx: MutationCtx,
	args: { childProfileId: Id<'profiles'>; change: ChildRoutingChange; email?: string }
) => {
	await ctx.scheduler.runAfter(0, internal.childEmailVerification.sendRoutingChangedNotice, {
		childProfileId: args.childProfileId,
		change: args.change,
		maskedEmail: args.email ? maskEmail(args.email) : undefined
	});
};

// ---------------------------------------------------------------------------------------------
// Sending the confirmation email
// ---------------------------------------------------------------------------------------------

export const getVerificationForSend = internalQuery({
	args: { verificationId: v.id('childEmailVerifications') },
	returns: v.union(
		v.object({
			childProfileId: v.id('profiles'),
			email: v.string(),
			username: v.string(),
			addedBySelf: v.boolean()
		}),
		v.null()
	),
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.verificationId);
		if (!row || row.tokenHash !== undefined || row.consumedAt !== undefined) return null;
		const child = await ctx.db.get(row.childProfileId);
		if (!child?.username || child.notificationEmail !== row.email) return null;
		return {
			childProfileId: row.childProfileId,
			email: row.email,
			username: child.username,
			addedBySelf: row.requestedByProfileId === row.childProfileId
		};
	}
});

// Keyed by the row, not the child. Returns false when the request was superseded in the meantime
// (a newer one deleted this row, or the address was changed or removed): then nothing is sent.
export const setVerificationTokenHash = internalMutation({
	args: { verificationId: v.id('childEmailVerifications'), tokenHash: v.string() },
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.verificationId);
		if (!row || row.tokenHash !== undefined || row.consumedAt !== undefined) return false;
		const child = await ctx.db.get(row.childProfileId);
		if (!child || child.notificationEmail !== row.email || child.notificationEmailVerifiedAt) {
			return false;
		}
		await ctx.db.patch(row._id, { tokenHash: args.tokenHash });
		return true;
	}
});

export const sendChildEmailVerification = internalAction({
	args: { verificationId: v.id('childEmailVerifications') },
	returns: v.null(),
	handler: async (ctx, args) => {
		const request = await ctx.runQuery(internal.childEmailVerification.getVerificationForSend, {
			verificationId: args.verificationId
		});
		if (!request) return null;
		const subject = 'Confirm your email for Curiosity Learning';
		const baseUrl = getAppBaseUrl();
		let result: NotificationEmailResult;
		if (!baseUrl) {
			// Without the app URL the button would lead nowhere; record it rather than send a dud.
			result = { status: 'failed', to: request.email, error: 'BETTER_AUTH_URL is not set' };
		} else {
			// Same token shape and hash as sign-in links (magicLinks.ts): 32 letters, sha-256.
			const token = generateMagicLinkToken();
			const stored = await ctx.runMutation(
				internal.childEmailVerification.setVerificationTokenHash,
				{ verificationId: args.verificationId, tokenHash: await hashMagicLinkToken(token) }
			);
			if (!stored) return null;
			result = await sendResult(
				() =>
					sendEmail({
						to: request.email,
						type: 'child-email-verification',
						...childEmailVerificationEmail({
							username: request.username,
							url: `${baseUrl}${VERIFY_EMAIL_PATH_PREFIX}${token}`,
							addedBySelf: request.addedBySelf
						})
					}),
				request.email
			);
		}
		await ctx.runMutation(internal.notifications.logEmailDelivery, {
			recipientProfileId: request.childProfileId,
			kind: 'child_email_verification',
			subject,
			result
		});
		return null;
	}
});

// ---------------------------------------------------------------------------------------------
// Parent notice on routing changes
// ---------------------------------------------------------------------------------------------

// The approved consent address (not the caller's sign-in email, which may differ — review S9):
// that inbox is the one the parent proved they own.
export const getRoutingNoticeRecipient = internalQuery({
	args: { childProfileId: v.id('profiles') },
	returns: v.union(v.object({ to: v.string(), childName: v.string() }), v.null()),
	handler: async (ctx, args) => {
		const child = await ctx.db.get(args.childProfileId);
		if (!child) return null;
		const consents = await ctx.db
			.query('parentChildConsents')
			.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', args.childProfileId))
			.order('desc')
			.collect();
		const approved = consents.find(
			(row) => row.status === 'approved' && row.unlinkedAt === undefined
		);
		return approved ? { to: approved.parentEmail, childName: profileDisplayName(child) } : null;
	}
});

export const sendRoutingChangedNotice = internalAction({
	args: {
		childProfileId: v.id('profiles'),
		change: v.union(v.literal('pending'), v.literal('confirmed'), v.literal('removed')),
		maskedEmail: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const recipient = await ctx.runQuery(
			internal.childEmailVerification.getRoutingNoticeRecipient,
			{ childProfileId: args.childProfileId }
		);
		if (!recipient) return null;
		const baseUrl = getAppBaseUrl();
		const content = childRoutingChangedEmail({
			childName: recipient.childName,
			change: args.change,
			maskedEmail: args.maskedEmail,
			// A plain link: no sign-in link in this email, ever (see the template).
			childPageUrl: baseUrl ? `${baseUrl}/child/${args.childProfileId}` : undefined
		});
		const result = await sendResult(
			() => sendEmail({ to: recipient.to, type: 'notification', ...content }),
			recipient.to
		);
		await ctx.runMutation(internal.notifications.logEmailDelivery, {
			recipientProfileId: args.childProfileId,
			kind: 'child_routing_changed',
			subject: content.subject,
			result
		});
		return null;
	}
});

// ---------------------------------------------------------------------------------------------
// Final notice to a parent the child unlinked (CL-769, review S7/D4)
// ---------------------------------------------------------------------------------------------

// Keyed by the consent rows parentAccounts.unlinkParent just stamped `unlinkedAt` on: their
// `parentEmail` is the inbox the parent proved they own. Returns each distinct address once.
export const getParentUnlinkedNoticeRecipients = internalQuery({
	args: { childProfileId: v.id('profiles'), consentIds: v.array(v.id('parentChildConsents')) },
	returns: v.object({ to: v.array(v.string()), childName: v.string() }),
	handler: async (ctx, args) => {
		const child = await ctx.db.get(args.childProfileId);
		const to = new Set<string>();
		for (const consentId of args.consentIds) {
			const consent = await ctx.db.get(consentId);
			if (consent?.childProfileId !== args.childProfileId || consent.unlinkedAt === undefined) {
				continue;
			}
			to.add(consent.parentEmail.trim().toLowerCase());
		}
		return { to: [...to], childName: child ? profileDisplayName(child) : 'Your child' };
	}
});

// Scheduled once per unlink, only when the call actually unlinked a consent, so a repeated
// unlink never sends a second notice. Plain text, no link (see the template).
export const sendParentUnlinkedNotice = internalAction({
	args: { childProfileId: v.id('profiles'), consentIds: v.array(v.id('parentChildConsents')) },
	returns: v.null(),
	handler: async (ctx, args) => {
		const { to, childName } = await ctx.runQuery(
			internal.childEmailVerification.getParentUnlinkedNoticeRecipients,
			args
		);
		const content = parentUnlinkedEmail({ childName });
		for (const address of to) {
			const result = await sendResult(
				() => sendEmail({ to: address, type: 'notification', ...content }),
				address
			);
			await ctx.runMutation(internal.notifications.logEmailDelivery, {
				recipientProfileId: args.childProfileId,
				kind: 'parent_unlinked',
				subject: content.subject,
				result,
				audience: 'parent'
			});
		}
		return null;
	}
});

// ---------------------------------------------------------------------------------------------
// The child confirms (/verify-email/[token])
// ---------------------------------------------------------------------------------------------

type VerificationStatus = 'valid' | 'expired' | 'used' | 'notFound' | 'wrongAccount';

// The state of a confirmation link FOR THE CALLER. Order matters: a caller who is not the child
// learns nothing about the link (not whether it expired, not whose it is — review B2), so
// 'wrongAccount' comes before every other check except existence.
const resolveVerification = async (
	ctx: Parameters<typeof requireProfile>[0],
	token: string,
	callerProfileId: Id<'profiles'>
): Promise<{
	status: VerificationStatus;
	row?: Doc<'childEmailVerifications'>;
	child?: Doc<'profiles'>;
}> => {
	if (!/^[a-zA-Z]{1,128}$/.test(token)) return { status: 'notFound' };
	const tokenHash = await hashMagicLinkToken(token);
	const row = await ctx.db
		.query('childEmailVerifications')
		.withIndex('by_token_hash', (q) => q.eq('tokenHash', tokenHash))
		.unique();
	if (!row) return { status: 'notFound' };
	if (row.childProfileId !== callerProfileId) return { status: 'wrongAccount' };
	if (row.consumedAt !== undefined) return { status: 'used', row };
	const child = await ctx.db.get(row.childProfileId);
	// Superseded: the parent changed or removed the address since this link was sent.
	if (!child || child.notificationEmail !== row.email) return { status: 'notFound' };
	if (row.expiresAt <= Date.now()) return { status: 'expired', row, child };
	return { status: 'valid', row, child };
};

export const getChildEmailVerification = query({
	args: { token: v.string() },
	returns: v.object({
		status: v.union(
			v.literal('valid'),
			v.literal('expired'),
			v.literal('used'),
			v.literal('notFound'),
			v.literal('wrongAccount')
		),
		username: v.optional(v.string()),
		emailMasked: v.optional(v.string()),
		// The child added the address themselves (16+, Settings) rather than their parent: only
		// changes the wording. Only ever returned to the child the link is for.
		addedBySelf: v.optional(v.boolean())
	}),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const { status, row, child } = await resolveVerification(ctx, args.token, profile._id);
		const addedBySelf = row ? row.requestedByProfileId === row.childProfileId : undefined;
		if (status === 'expired') return { status, addedBySelf };
		if (status !== 'valid' || !row || !child) return { status };
		return {
			status,
			username: child.username ?? undefined,
			emailMasked: maskEmail(row.email),
			addedBySelf
		};
	}
});

export const confirmChildEmail = mutation({
	args: { token: v.string() },
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const { status, row, child } = await resolveVerification(ctx, args.token, profile._id);
		// Throwing rolls everything back: a wrong account never consumes the link.
		if (status === 'wrongAccount') {
			throw new ConvexError('This link is for a different account.');
		}
		if (status === 'used') throw new ConvexError('This link was already used.');
		if (status === 'expired') throw new ConvexError('This link has expired.');
		if (status !== 'valid' || !row || !child) {
			throw new ConvexError('This link is not valid anymore.');
		}
		const now = Date.now();
		await ctx.db.patch(row._id, { consumedAt: now });
		await ctx.db.patch(child._id, { notificationEmailVerifiedAt: now, updatedAt: now });
		await scheduleRoutingChangedNotice(ctx, {
			childProfileId: child._id,
			change: 'confirmed',
			email: row.email
		});
		return { success: true };
	}
});

// ---------------------------------------------------------------------------------------------
// Cleanup (crons.runDailyMaintenance)
// ---------------------------------------------------------------------------------------------

const EXPIRED_PAGE_SIZE = 200;

export const deleteExpiredChildEmailVerifications = internalMutation({
	args: {},
	returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
	handler: async (ctx) => {
		const expired = await ctx.db
			.query('childEmailVerifications')
			.withIndex('by_expires_at', (q) => q.lt('expiresAt', Date.now()))
			.take(EXPIRED_PAGE_SIZE + 1);
		const page = expired.slice(0, EXPIRED_PAGE_SIZE);
		for (const row of page) await ctx.db.delete(row._id);
		return { deleted: page.length, hasMore: expired.length > EXPIRED_PAGE_SIZE };
	}
});
