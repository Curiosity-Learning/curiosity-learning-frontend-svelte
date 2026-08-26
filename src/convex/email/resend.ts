import type { EmailContent } from './templates';
import { reportConvexError } from '../monitoring';

export type TransactionalEmailType =
	| 'parent-consent'
	| 'password-reset'
	| 'verification-otp'
	| 'notification'
	| 'admin-invite'
	| 'club-leader-invite';

export const sendEmail = async (
	args: EmailContent & { to: string; type: TransactionalEmailType }
) => {
	try {
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
