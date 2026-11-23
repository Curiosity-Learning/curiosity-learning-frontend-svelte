import { describe, expect, it } from 'vitest';
import { normalizeAuthRedirectTarget } from './redirect-target';

describe('normalizeAuthRedirectTarget', () => {
	it('keeps same-site paths, query included', () => {
		expect(normalizeAuthRedirectTarget('/child/abc?room=xyz')).toBe('/child/abc?room=xyz');
		expect(normalizeAuthRedirectTarget('/feed/my-clubs')).toBe('/feed/my-clubs');
	});

	it('falls back to home for missing or non-path values', () => {
		expect(normalizeAuthRedirectTarget(null)).toBe('/');
		expect(normalizeAuthRedirectTarget('')).toBe('/');
		expect(normalizeAuthRedirectTarget('https://evil.com')).toBe('/');
		expect(normalizeAuthRedirectTarget('evil.com')).toBe('/');
	});

	it('refuses paths that resolve to another origin (open redirect)', () => {
		expect(normalizeAuthRedirectTarget('//evil.com')).toBe('/');
		expect(normalizeAuthRedirectTarget('//evil.com/path')).toBe('/');
		expect(normalizeAuthRedirectTarget('/\\evil.com')).toBe('/');
		expect(normalizeAuthRedirectTarget('/\\/evil.com')).toBe('/');
		expect(normalizeAuthRedirectTarget('/%5Cevil.com')).toBe('/%5Cevil.com');
		expect(normalizeAuthRedirectTarget('/\tevil')).toBe('/');
		expect(normalizeAuthRedirectTarget('/\n/evil.com')).toBe('/');
	});

	it('never sends a signed-in visitor back to an auth page or get-started', () => {
		expect(normalizeAuthRedirectTarget('/auth/sign-in')).toBe('/');
		expect(normalizeAuthRedirectTarget('/onboarding/get-started')).toBe('/');
	});
});
