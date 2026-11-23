import { expect, test } from '@playwright/test';

// CL-818: the website sends a report-only CSP. These checks fail if it ever starts enforcing by
// accident, if SSR pages stop rendering with it, or if a public page violates the policy.
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4173';

const PUBLIC_PAGES = [
	'/onboarding/get-started',
	'/auth/sign-in',
	'/auth/sign-up',
	'/privacy',
	'/terms'
];

for (const route of PUBLIC_PAGES) {
	test(`report-only CSP on ${route}`, async ({ page }) => {
		const violations: string[] = [];
		page.on('console', (message) => {
			if (/content security policy/i.test(message.text())) violations.push(message.text());
		});
		await page.exposeFunction('__cspViolation', (text: string) => violations.push(text));
		await page.addInitScript(() => {
			document.addEventListener('securitypolicyviolation', (event) => {
				const report = (window as unknown as { __cspViolation: (text: string) => void })
					.__cspViolation;
				report(`${event.violatedDirective} ${event.blockedURI}`);
			});
		});

		const response = await page.goto(`${BASE_URL}${route}`);
		expect(response?.status()).toBe(200);

		const headers = response?.headers() ?? {};
		const policy = headers['content-security-policy-report-only'] ?? '';
		expect(headers['content-security-policy']).toBeUndefined();
		expect(policy).toMatch(/script-src 'self' 'nonce-[^']+'/);
		expect(policy).toContain("object-src 'none'");
		expect(policy).toContain("frame-ancestors 'none'");
		expect(policy).toContain("base-uri 'self'");
		expect(policy).toContain('report-to csp-endpoint');

		await page.waitForLoadState('networkidle');
		expect(violations).toEqual([]);
	});
}

test('each response gets a fresh nonce', async ({ request }) => {
	const nonceOf = async () => {
		const response = await request.get(`${BASE_URL}/auth/sign-in`);
		return /'nonce-([^']+)'/.exec(
			response.headers()['content-security-policy-report-only'] ?? ''
		)?.[1];
	};
	const [first, second] = [await nonceOf(), await nonceOf()];
	expect(first).toBeTruthy();
	expect(first).not.toBe(second);
});

// Browsers post CSP reports (with the page URL and referrer) straight to Sentry, past the SDK's
// redaction, so pages with a secret in the URL must never get a report endpoint.
for (const route of [
	'/auth/reset-password?token=secret123',
	'/onboarding/parent-consent/secret123',
	'/email/unsubscribe?t=secret123'
]) {
	test(`no CSP report endpoint on ${route}`, async ({ request }) => {
		const response = await request.get(`${BASE_URL}${route}`, { maxRedirects: 0 });
		expect(response.status()).toBe(200);
		const headers = response.headers();
		const policy = headers['content-security-policy-report-only'] ?? '';
		expect(policy).toMatch(/script-src 'self' 'nonce-[^']+'/);
		expect(policy).not.toContain('report-uri');
		expect(headers['reporting-endpoints']).toBeUndefined();
		expect(headers['referrer-policy']).toBe('strict-origin');
	});
}
