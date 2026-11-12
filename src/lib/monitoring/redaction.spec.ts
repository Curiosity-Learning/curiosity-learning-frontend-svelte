import { describe, expect, it } from 'vitest';
import {
	redactSentryEvent,
	redactSentryLog,
	redactSentryTransaction,
	redactText,
	redactUnknown
} from './redaction';

describe('monitoring redaction', () => {
	it('removes email addresses, sensitive path tokens, and URL query strings', () => {
		const value =
			'Contact parent@example.com at https://app.example.com/onboarding/parent-consent/secret-token?signature=secret';

		expect(redactText(value)).toBe(
			'Contact [Redacted email] at https://app.example.com/onboarding/parent-consent/[Redacted]'
		);
	});

	it('redacts child email confirmation and sign-in link tokens in paths and fragments', () => {
		expect(redactText('GET /verify-email/abcDEFtoken')).toBe('GET /verify-email/[Redacted]');
		expect(redactText('https://app.example.com/verify-email/abcDEFtoken')).toBe(
			'https://app.example.com/verify-email/[Redacted]'
		);
		expect(redactText('/auth/link#t=abcDEF&next=%2Fchild%2Fx&as=p')).toBe(
			'/auth/link#t=[Redacted]&next=%2Fchild%2Fx&as=p'
		);
		expect(redactText('https://app.example.com/auth/link#t=abcDEF&next=%2F')).toBe(
			'https://app.example.com/auth/link'
		);
		expect(redactText('GET /api/auth/magic-link/verify?token=abcDEF&callbackURL=%2F')).toBe(
			'GET /api/auth/magic-link/verify?token=[Redacted]&callbackURL=%2F'
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

	it('removes request data and user context from transaction events', () => {
		const transaction = redactSentryTransaction({
			type: 'transaction',
			transaction: 'GET /private',
			user: { id: 'user-123', email: 'person@example.com' },
			request: {
				url: 'https://app.example.com/private?token=secret',
				query_string: 'token=secret',
				headers: { cookie: 'session=secret' }
			}
		});

		expect(transaction.user).toBeUndefined();
		expect(transaction.request).toEqual({
			url: 'https://app.example.com/private',
			headers: { cookie: '[Redacted]' }
		});
	});

	it('redacts emails and query strings inside structured logs', () => {
		const log = redactSentryLog({
			level: 'info',
			message: 'contacted person@example.com via https://app.example.com/x?token=secret',
			attributes: { email: 'person@example.com', assetId: 'asset-123' }
		});

		expect(log.message).toBe('contacted [Redacted email] via https://app.example.com/x');
		expect(log.attributes).toEqual({ email: '[Redacted]', assetId: 'asset-123' });
	});
});
