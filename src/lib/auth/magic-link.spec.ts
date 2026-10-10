import { describe, expect, it } from 'vitest';
import {
	buildMagicLinkErrorPath,
	isMagicLinkCallbackPath,
	isMagicLinkFailure,
	toMagicLinkCallbackParam
} from './magic-link';

// Sign-in page logic for one-time sign-in links. The round trip through Better Auth's real
// endpoints is covered in src/convex/magicLinks.spec.ts.

describe('isMagicLinkFailure', () => {
	it('recognises our expired-link marker', () => {
		expect(isMagicLinkFailure(new URLSearchParams('next=%2Fchild%2Fabc&link=expired'))).toBe(true);
	});

	it("recognises the verify endpoint's own error codes", () => {
		for (const code of ['INVALID_TOKEN', 'EXPIRED_TOKEN', 'new_user_signup_disabled']) {
			expect(isMagicLinkFailure(new URLSearchParams({ error: code }))).toBe(true);
		}
	});

	it('leaves Google OAuth errors and plain visits alone', () => {
		expect(isMagicLinkFailure(new URLSearchParams('error=signup_disabled'))).toBe(false);
		expect(isMagicLinkFailure(new URLSearchParams('error=state_mismatch'))).toBe(false);
		expect(isMagicLinkFailure(new URLSearchParams('next=%2Fchild%2Fabc'))).toBe(false);
	});
});

describe('buildMagicLinkErrorPath', () => {
	it('returns to the sign-in page with the original destination as next', () => {
		const path = buildMagicLinkErrorPath('/child/abc?room=xyz');
		const url = new URL(path, 'https://app.example.com');
		expect(url.pathname).toBe('/auth/sign-in');
		expect(url.searchParams.get('next')).toBe('/child/abc?room=xyz');
		expect(isMagicLinkFailure(url.searchParams)).toBe(true);
	});
});

describe('toMagicLinkCallbackParam', () => {
	it('survives the extra decodeURIComponent the verify endpoint applies', () => {
		const path = buildMagicLinkErrorPath('/child/abc?room=xyz');
		const param = toMagicLinkCallbackParam(path);
		expect(decodeURIComponent(param)).toBe(path);
		// Both the wire form (checked on POST) and the decoded form (checked on verify) must pass
		// Better Auth's relative-callback check.
		expect(isMagicLinkCallbackPath(param)).toBe(true);
		expect(isMagicLinkCallbackPath(decodeURIComponent(param))).toBe(true);
	});

	it('is the identity for paths without escapes', () => {
		expect(toMagicLinkCallbackParam('/child/abc?room=xyz')).toBe('/child/abc?room=xyz');
	});
});

describe('isMagicLinkCallbackPath', () => {
	it('accepts app paths and rejects anything that could leave the app', () => {
		expect(isMagicLinkCallbackPath('/child/abc?room=xyz')).toBe(true);
		expect(isMagicLinkCallbackPath('/')).toBe(true);
		expect(isMagicLinkCallbackPath('//evil.example.com')).toBe(false);
		expect(isMagicLinkCallbackPath('https://evil.example.com')).toBe(false);
		expect(isMagicLinkCallbackPath('/%2fevil.example.com')).toBe(false);
	});
});
