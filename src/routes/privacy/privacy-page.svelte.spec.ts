import { page as browserPage } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { PRIVACY_POLICY_VERSION, privacyPolicyContent } from '$convex/legalContent';
import PrivacyPage from './+page.svelte';

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/privacy') } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const bundledPolicy = {
	documentKey: 'privacy_policy',
	version: PRIVACY_POLICY_VERSION,
	content: privacyPolicyContent,
	updatedAt: new Date('2026-11-23T12:00:00Z').getTime()
};

describe('/privacy', () => {
	it('shows the bundled policy, which lists Sentry as the error-monitoring processor', async () => {
		render(PrivacyPage, {
			// Only the fields the page reads; the rest of PageProps is unused here.
			props: { data: { document: bundledPolicy } } as never
		});

		await expect
			.element(browserPage.getByRole('heading', { name: 'Privacy Policy' }))
			.toBeVisible();
		await expect
			.element(
				browserPage.getByText(/Sentry, in its European Union data region, for error monitoring/)
			)
			.toBeVisible();
		await expect.element(browserPage.getByText(/an error report is sent to Sentry/)).toBeVisible();
	});

	it('shows the empty message when no policy is published', async () => {
		render(PrivacyPage, { props: { data: { document: null } } as never });

		await expect
			.element(browserPage.getByText('No privacy policy content is configured yet.'))
			.toBeVisible();
		await expect.element(browserPage.getByText(/Sentry/)).not.toBeInTheDocument();
	});
});
