import { describe, expect, it, vi } from 'vitest';
import {
	REDACTED,
	checkRevocation,
	createLinkDeduper,
	describeStorageError,
	redactPath,
	redactUrl
} from './diagnostics';

describe('redactUrl (CL-819)', () => {
	it('hides the sign-in link token and address in the fragment', () => {
		const shown = redactUrl(
			'https://app.example.com/auth/link#t=SECRETtoken123&next=%2Fdashboard&as=parent%40example.com'
		);
		expect(shown).not.toContain('SECRETtoken123');
		expect(shown).not.toContain('parent');
		expect(shown).toBe(
			`https://app.example.com/auth/link#t=${REDACTED}&next=%2Fdashboard&as=${REDACTED}`
		);
	});

	it('hides one-time tokens and OAuth parameters in the query', () => {
		const shown = redactUrl(
			'https://app.example.com/app/auth-callback?ott=OTTsecretvalue&code=4%2F0Abc&state=xyz&keep=1'
		);
		expect(shown).toBe(
			`https://app.example.com/app/auth-callback?ott=${REDACTED}&code=${REDACTED}&state=${REDACTED}&keep=1`
		);
	});

	it('matches keys case-insensitively and leaves clean URLs untouched', () => {
		expect(redactUrl('https://a.example/x?ID_TOKEN=abc')).toBe(
			`https://a.example/x?ID_TOKEN=${REDACTED}`
		);
		expect(redactUrl('https://a.example/x?page=2#top')).toBe('https://a.example/x?page=2#top');
	});

	it('hides anything that is not a URL', () => {
		expect(redactUrl('not a url with token=abc')).toBe(REDACTED);
	});

	it('redacts app-relative paths too', () => {
		expect(redactPath('/child/abc?room=xyz&token=s3cret')).toBe(
			`/child/abc?room=xyz&token=${REDACTED}`
		);
	});
});

describe('createLinkDeduper (CL-819)', () => {
	it('claims each URL once (appUrlOpen + getLaunchUrl on the same cold start)', () => {
		const links = createLinkDeduper();
		const url = 'https://app.example.com/auth/link#t=abc';
		expect(links.claim(url)).toBe(true);
		expect(links.claim(url)).toBe(false);
		expect(links.claim('https://app.example.com/auth/link#t=other')).toBe(true);
	});
});

const COOKIE = '__Secure-better-auth.session_token=abc.def';
const respond = (status: number, body: string) =>
	vi.fn(
		async () => new Response(body, { status, headers: { 'content-type': 'application/json' } })
	);

describe('checkRevocation (CL-819)', () => {
	it('passes only on HTTP 200 with a null session', async () => {
		const fetchImpl = respond(200, 'null');
		const result = await checkRevocation('https://site.example', COOKIE, fetchImpl);
		expect(result.status).toBe('revoked');
		expect(fetchImpl).toHaveBeenCalledWith('https://site.example/api/auth/get-session', {
			credentials: 'omit',
			headers: { 'Better-Auth-Cookie': COOKIE }
		});
	});

	it('fails when the old cookie still returns a session', async () => {
		const result = await checkRevocation(
			'https://site.example',
			COOKIE,
			respond(200, '{"session":{"id":"s"},"user":{"id":"u"}}')
		);
		expect(result.status).toBe('still-live');
	});

	it.each([
		['a network failure', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))],
		['HTTP 500', respond(500, 'null')],
		['HTTP 403', respond(403, '{"message":"forbidden"}')],
		['a non-JSON body', respond(200, '<html>')],
		['an unexpected 200 body', respond(200, '{"ok":true}')]
	])('reports %s as an error, never a pass', async (_label, fetchImpl) => {
		const result = await checkRevocation('https://site.example', COOKIE, fetchImpl as typeof fetch);
		expect(result.status).toBe('error');
	});

	it('is an error when there was no session cookie to replay', async () => {
		const fetchImpl = respond(200, 'null');
		const result = await checkRevocation(
			'https://site.example',
			'__Secure-better-auth.session_token=',
			fetchImpl
		);
		expect(result.status).toBe('error');
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

describe('describeStorageError (CL-819)', () => {
	it('names the failure, or nothing when there is none', () => {
		expect(describeStorageError(null)).toBeNull();
		expect(describeStorageError(new Error('errSecInteractionNotAllowed'))).toBe(
			'secure storage error: errSecInteractionNotAllowed'
		);
	});
});
