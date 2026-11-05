import { describe, expect, it } from 'vitest';
import { clubLessLandingPath, isNoClubAllowedPath } from './no-club-allowlist';

describe('club-less landing (edge case 14)', () => {
	it("sends an account with a linked child to that child's page, everyone else to /new-club", () => {
		expect(clubLessLandingPath('k57abc')).toBe('/child/k57abc');
		expect(clubLessLandingPath(null)).toBe('/new-club');
		expect(clubLessLandingPath(undefined)).toBe('/new-club');
	});

	it('keeps the parent pages reachable without a club', () => {
		for (const path of ['/child/k57abc', '/verify-email/abcDEF', '/settings', '/new-club']) {
			expect(isNoClubAllowedPath(path)).toBe(true);
		}
		expect(isNoClubAllowedPath('/club/k57abc')).toBe(false);
		expect(isNoClubAllowedPath('/childish')).toBe(false);
	});
});
