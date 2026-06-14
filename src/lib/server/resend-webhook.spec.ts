import { describe, expect, it } from 'vitest';
import { Webhook } from 'svix';
import { classifyResendWebhook, verifyResendWebhook } from './resend-webhook';

describe('Resend webhook classification', () => {
	it('reports delivery failures without recipient data', () => {
		expect(
			classifyResendWebhook({
				type: 'email.failed',
				data: {
					to: ['parent@example.com'],
					tags: [{ name: 'email_type', value: 'parent-consent' }]
				}
			})
		).toEqual({
			eventType: 'email.failed',
			emailType: 'parent-consent',
			level: 'error'
		});
	});

	it('reports delayed delivery as a warning', () => {
		expect(classifyResendWebhook({ type: 'email.delivery_delayed', data: {} })).toEqual({
			eventType: 'email.delivery_delayed',
			emailType: undefined,
			level: 'warning'
		});
	});

	it('ignores routine delivery events', () => {
		expect(classifyResendWebhook({ type: 'email.delivered', data: {} })).toBeNull();
	});

	it('verifies signed webhook payloads and rejects invalid signatures', () => {
		const secret = `whsec_${Buffer.from('test-secret-key').toString('base64')}`;
		const body = JSON.stringify({ type: 'email.failed', data: {} });
		const messageId = 'msg_test';
		const timestamp = new Date();
		const signature = new Webhook(secret).sign(messageId, timestamp, body);
		const headers = {
			'svix-id': messageId,
			'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
			'svix-signature': signature
		};

		expect(verifyResendWebhook(body, headers, secret)).toEqual({
			type: 'email.failed',
			data: {}
		});
		expect(() =>
			verifyResendWebhook(body, { ...headers, 'svix-signature': 'invalid' }, secret)
		).toThrow();
	});
});
