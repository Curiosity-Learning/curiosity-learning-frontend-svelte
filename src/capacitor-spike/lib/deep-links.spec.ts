import { describe, expect, it } from 'vitest';
import { parseIncomingLink } from './deep-links';

const ORIGIN = 'https://app.example.com';

describe('parseIncomingLink (CL-819)', () => {
	it('reads a crossDomain one-time token', () => {
		const link = parseIncomingLink(`${ORIGIN}/app/auth-callback?ott=${'a'.repeat(32)}`, ORIGIN);
		expect(link).toMatchObject({ kind: 'one-time-token', token: 'a'.repeat(32) });
	});

	it('reads the emailed /auth/link interstitial token from the fragment', () => {
		const link = parseIncomingLink(`${ORIGIN}/auth/link#t=abcDEF123&next=%2Fdashboard`, ORIGIN);
		expect(link).toMatchObject({ kind: 'magic-link', token: 'abcDEF123', next: '/dashboard' });
	});

	it('ignores links from any other origin or scheme', () => {
		expect(parseIncomingLink(`https://evil.example/x?ott=${'a'.repeat(32)}`, ORIGIN).kind).toBe(
			'ignored'
		);
		expect(parseIncomingLink(`curiosity://auth?ott=${'a'.repeat(32)}`, ORIGIN).kind).toBe(
			'ignored'
		);
		expect(parseIncomingLink(`${ORIGIN}/x?ott=${'a'.repeat(32)}`, null).kind).toBe('ignored');
	});

	it('ignores malformed tokens and token-less links', () => {
		expect(parseIncomingLink(`${ORIGIN}/x?ott=short`, ORIGIN).kind).toBe('ignored');
		expect(parseIncomingLink(`${ORIGIN}/auth/link#next=%2F`, ORIGIN).kind).toBe('ignored');
		expect(parseIncomingLink('not a url', ORIGIN).kind).toBe('ignored');
	});
});
