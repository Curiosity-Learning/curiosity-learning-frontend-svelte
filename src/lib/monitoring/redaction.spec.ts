import { describe, expect, it } from 'vitest';
import {
	redactSentryBreadcrumb,
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

	it('redacts names and usernames that follow a label in free text', () => {
		expect(redactText('Username "ava_b" is already taken')).toBe(
			'Username "[Redacted name]" is already taken'
		);
		expect(redactText("Could not invite child name 'Ava Brown'")).toBe(
			'Could not invite child name "[Redacted name]"'
		);
		expect(redactText('lookup failed for username=ava_b, clubId=club-1')).toBe(
			'lookup failed for username=[Redacted name], clubId=club-1'
		);
		expect(redactText('profile {"displayName":"Ava B","firstName":"Ava","clubId":"c1"}')).toBe(
			'profile {"displayName":"[Redacted name]","firstName":"[Redacted name]","clubId":"c1"}'
		);
		expect(redactText("guardian's name: Sam")).toBe("guardian's name: [Redacted name]");
	});

	it('leaves text without a name label alone', () => {
		const value = 'Username is required; club name must be set; function name listClubs';
		expect(redactText(value)).toBe(value);
	});

	it('redacts values stored under name keys but keeps plain name keys', () => {
		expect(
			redactUnknown({
				username: 'ava_b',
				displayName: 'Ava B',
				first_name: 'Ava',
				childName: 'Ava',
				sdk: { name: 'sentry.javascript.sveltekit' },
				clubName: 'Robotics'
			})
		).toEqual({
			username: '[Redacted]',
			displayName: '[Redacted]',
			first_name: '[Redacted]',
			childName: '[Redacted]',
			sdk: { name: 'sentry.javascript.sveltekit' },
			clubName: 'Robotics'
		});
	});

	it('redacts names in error event messages and breadcrumbs', () => {
		const event = redactSentryEvent({
			type: undefined,
			exception: { values: [{ type: 'ConvexError', value: 'username "ava_b" not found' }] },
			breadcrumbs: [{ category: 'console', message: 'saving displayName: Ava' }]
		});

		expect(event.exception?.values?.[0]?.value).toBe('username "[Redacted name]" not found');
		expect(event.breadcrumbs?.[0]?.message).toBe('saving displayName: [Redacted name]');
	});

	it('redacts element labels in UI breadcrumbs', () => {
		const breadcrumb = redactSentryBreadcrumb({
			category: 'ui.click',
			message: 'div.member-row > button.remove[aria-label="Remove Ava from club"][type="button"]'
		});

		expect(breadcrumb.message).toBe(
			'div.member-row > button.remove[aria-label="[Redacted]"][type="button"]'
		);
	});
});
