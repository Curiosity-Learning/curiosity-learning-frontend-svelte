import type { EmailContent } from './templates';

export const sendEmail = async (args: EmailContent & { to: string }) => {
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
			text: args.text
		})
	});

	if (!response.ok) {
		let details = '';
		try {
			details = JSON.stringify(await response.json());
		} catch {
			details = await response.text().catch(() => '');
		}
		throw new Error(`Resend send failed: ${response.status} ${response.statusText} ${details}`);
	}
};
