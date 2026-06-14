import * as Sentry from '@sentry/sveltekit';
import { json } from '@sveltejs/kit';
import { captureOperationalError } from '$lib/monitoring/capture';
import { classifyResendWebhook, verifyResendWebhook } from '$lib/server/resend-webhook';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const secret = process.env.RESEND_WEBHOOK_SECRET;
	if (!secret) {
		return json({ error: 'Resend webhook is not configured.' }, { status: 503 });
	}

	const headers = {
		'svix-id': request.headers.get('svix-id') ?? '',
		'svix-timestamp': request.headers.get('svix-timestamp') ?? '',
		'svix-signature': request.headers.get('svix-signature') ?? ''
	};

	let event: unknown;
	try {
		event = verifyResendWebhook(await request.text(), headers, secret);
	} catch {
		return json({ error: 'Invalid webhook signature.' }, { status: 401 });
	}

	const classification = classifyResendWebhook(event);
	if (!classification) {
		return new Response(null, { status: 204 });
	}

	captureOperationalError(new Error(`Resend reported ${classification.eventType}`), {
		area: 'email',
		operation: 'resend:delivery-webhook',
		level: classification.level,
		identifiers: {
			emailType: classification.emailType,
			provider: 'resend',
			status: classification.eventType
		}
	});
	await Sentry.flush(1500);
	return new Response(null, { status: 202 });
};
