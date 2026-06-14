import { describe, expect, it } from 'vitest';
import { redactSentryEvent, redactText, redactUnknown } from './redaction';

describe('monitoring redaction', () => {
	it('removes email addresses, sensitive path tokens, and URL query strings', () => {
		const value =
			'Contact parent@example.com at https://app.example.com/onboarding/parent-consent/secret-token?signature=secret';

		expect(redactText(value)).toBe(
			'Contact [Redacted email] at https://app.example.com/onboarding/parent-consent/[Redacted]'
		);
	});

	it('redacts values stored under sensitive keys', () => {
		expect(
			redactUnknown({
				authorization: 'Bearer secret',
				nested: { email: 'person@example.com', assetId: 'asset-123' }
			})
		).toEqual({
			authorization: '[Redacted]',
			nested: { email: '[Redacted]', assetId: 'asset-123' }
		});
	});

	it('removes request data and user context from Sentry events', () => {
		const event = redactSentryEvent({
			type: undefined,
			user: { id: 'user-123', email: 'person@example.com' },
			request: {
				url: 'https://app.example.com/private?token=secret',
				cookies: { session: 'secret' },
				data: { password: 'secret' },
				query_string: 'token=secret',
				headers: { authorization: 'Bearer secret' }
			}
		});

		expect(event.user).toBeUndefined();
		expect(event.request).toEqual({
			url: 'https://app.example.com/private',
			headers: { authorization: '[Redacted]' }
		});
	});
});
