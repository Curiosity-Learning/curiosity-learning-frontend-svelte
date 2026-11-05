import type { EmailContent } from './templates';
import { CHILD_EMAIL_DOMAIN } from '../childAccounts';
import { reportConvexError } from '../monitoring';

export type TransactionalEmailType =
	| 'parent-consent'
	| 'password-reset'
	| 'magic-link'
	| 'verification-otp'
	| 'notification'
	| 'child-email-verification'
	| 'admin-invite'
	| 'club-leader-invite';

export type SendEmailResult = { providerMessageId: string | null };

// Resolves once Resend has ACCEPTED the email (HTTP 2xx) — delivery to the inbox is
// asynchronous and only surfaces via the Resend webhook. Throws on any failure after reporting
// it, so callers that track "was this sent?" (chat.sendChatEmail) can tell the two apart.
export const sendEmail = async (
	args: EmailContent & { to: string; type: TransactionalEmailType }
): Promise<SendEmailResult> => {
	try {
		// Child accounts sign in with a synthetic auth email (childAccounts.ts) that is not an
		// inbox: sending to it only bounces and hurts sender reputation (review edge case 16).
		// Callers route child email elsewhere (notifications.resolveEmailRecipient); this is the
		// backstop, and it fails like any other send.
		if (args.to.trim().toLowerCase().endsWith(`@${CHILD_EMAIL_DOMAIN}`)) {
			throw new Error(`Refusing to email a synthetic child address (@${CHILD_EMAIL_DOMAIN}).`);
		}
		const apiKey = process.env.RESEND_API_KEY;
		if (!apiKey) {
			throw new Error('RESEND_API_KEY is not set (Convex environment variable).');
		}

		const from = process.env.RESEND_FROM ?? 'Curiosity Learning <onboarding@resend.dev>';

		const response = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${apiKey}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				from,
				to: args.to,
				subject: args.subject,
				html: args.html,
				text: args.text,
				tags: [{ name: 'email_type', value: args.type }]
			})
		});

		if (!response.ok) {
			throw new Error(`Resend send failed: ${response.status} ${response.statusText}`);
		}
		const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
		return { providerMessageId: typeof body?.id === 'string' ? body.id : null };
	} catch (error) {
		await reportConvexError(error, {
			area: 'email',
			operation: 'resend:send',
			identifiers: {
				emailType: args.type,
				provider: 'resend'
			}
		});
		throw error;
	}
};
