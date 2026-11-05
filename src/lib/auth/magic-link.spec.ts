import { describe, expect, it } from 'vitest';
import {
	buildMagicLinkErrorPath,
	buildMagicLinkInterstitialFragment,
	buildMagicLinkVerifyPath,
	maskEmail,
	parseMagicLinkInterstitialFragment,
	isMagicLinkCallbackPath,
	isMagicLinkFailure,
	isPasswordlessSignInAccount,
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

describe('maskEmail', () => {
	it('keeps the first letter and the domain', () => {
		expect(maskEmail('parent@example.com')).toBe('p…@example.com');
		expect(maskEmail(' P@x.nl ')).toBe('P…@x.nl');
		expect(maskEmail('not-an-email')).toBe('…');
	});
});

// The /auth/link interstitial (review S1): token and destination travel in the fragment.
describe('interstitial fragment', () => {
	it('round-trips token, next (query included) and the masked address', () => {
		const fragment = buildMagicLinkInterstitialFragment({
			token: 'abcDEF',
			next: '/child/abc?room=xyz&via=link',
			as: 'p…@example.com'
		});
		expect(parseMagicLinkInterstitialFragment(`#${fragment}`)).toEqual({
			token: 'abcDEF',
			next: '/child/abc?room=xyz&via=link',
			as: 'p…@example.com'
		});
	});

	it('rejects a missing or malformed token, and sends an untrusted next home', () => {
		expect(parseMagicLinkInterstitialFragment('')).toBeNull();
		expect(parseMagicLinkInterstitialFragment('#next=%2Fchild%2Fabc')).toBeNull();
		expect(parseMagicLinkInterstitialFragment('#t=a%20b')).toBeNull();
		expect(
			parseMagicLinkInterstitialFragment('#t=abc&next=https%3A%2F%2Fevil.example.com')?.next
		).toBe('/');
		expect(parseMagicLinkInterstitialFragment('#t=abc')?.next).toBe('/');
	});

	it('drops an `as` that is not a masked address (no free text on our origin)', () => {
		const as = (value: string) =>
			parseMagicLinkInterstitialFragment(`#t=abc&as=${encodeURIComponent(value)}`)?.as;
		expect(as(maskEmail('parent@example.com'))).toBe('p…@example.com');
		expect(as('Your bank account is locked. Call 555-0100')).toBe('');
		expect(as('parent@example.com')).toBe('');
		expect(as('p…@exa mple.com')).toBe('');
		expect(as('')).toBe('');
	});

	it('builds the verify path the plugin expects, with the expired-link fallback', () => {
		const url = new URL(
			buildMagicLinkVerifyPath({ token: 'abcDEF', next: '/child/abc?room=xyz' }),
			'https://app.example.com'
		);
		expect(url.pathname).toBe('/api/auth/magic-link/verify');
		expect(url.searchParams.get('token')).toBe('abcDEF');
		// The landing page gets the via=link marker; the expired-link fallback continues to the
		// unmarked page.
		expect(decodeURIComponent(url.searchParams.get('callbackURL')!)).toBe(
			'/child/abc?room=xyz&via=link'
		);
		expect(decodeURIComponent(url.searchParams.get('errorCallbackURL')!)).toBe(
			buildMagicLinkErrorPath('/child/abc?room=xyz')
		);
		const bare = new URL(
			buildMagicLinkVerifyPath({ token: 'abcDEF', next: '/child/abc' }),
			'https://app.example.com'
		);
		expect(decodeURIComponent(bare.searchParams.get('callbackURL')!)).toBe('/child/abc?via=link');
		expect(isMagicLinkCallbackPath('/child/abc?room=xyz&via=link')).toBe(true);
	});
});

describe('isPasswordlessSignInAccount (review S9)', () => {
	it('is true only for an existing account with neither a password nor Google', () => {
		expect(
			isPasswordlessSignInAccount({ exists: true, hasPassword: false, hasGoogle: false })
		).toBe(true);
		expect(isPasswordlessSignInAccount({ exists: true, hasPassword: true, hasGoogle: false })).toBe(
			false
		);
		expect(isPasswordlessSignInAccount({ exists: true, hasPassword: false, hasGoogle: true })).toBe(
			false
		);
		expect(
			isPasswordlessSignInAccount({ exists: false, hasPassword: false, hasGoogle: false })
		).toBe(false);
	});
});
