import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4173';
const screenshotDir = path.join(process.cwd(), 'docs', 'screenshots');

const capture = async (page: Page, route: string, name: string) => {
	await page.goto(`${BASE_URL}${route}`);
	await page.waitForLoadState('networkidle');
	await page.screenshot({
		path: path.join(screenshotDir, name),
		fullPage: true
	});
};

test.beforeAll(() => {
	fs.mkdirSync(screenshotDir, { recursive: true });
});

test('public routing smoke checks', async ({ page }) => {
	await page.goto(`${BASE_URL}/`);
	await expect(page).toHaveURL(/\/onboarding\/get-started$/);
	await expect(page.getByText('Welcome to Curiosity Learning')).toBeVisible();

	await page.goto(`${BASE_URL}/auth/sign-in`);
	await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

	await page.goto(`${BASE_URL}/feed`);
	await expect(page).toHaveURL(/\/auth\/sign-in/);
});

test('capture smoke screenshots', async ({ page }) => {
	await capture(page, '/auth/sign-in', 'auth-sign-in.png');
	await capture(page, '/auth/sign-up', 'auth-sign-up.png');
	await capture(page, '/onboarding/get-started', 'onboarding-get-started.png');
	await capture(page, '/onboarding/join-club', 'onboarding-join-club.png');
	await capture(page, '/onboarding/start-club', 'onboarding-start-club.png');
	await capture(page, '/privacy', 'privacy.png');
	await capture(page, '/terms', 'terms.png');
	await capture(page, '/feed', 'app-feed-auth-gate.png');
	await capture(page, '/chat', 'app-chat-auth-gate.png');
	await capture(page, '/profile', 'app-profile-auth-gate.png');
	await capture(page, '/settings', 'app-settings-auth-gate.png');
	await capture(page, '/club/demo-club', 'app-home-auth-gate.png');
	await capture(page, '/club/demo-club/sessions', 'app-sessions-auth-gate.png');
	await capture(page, '/club/demo-club/projects', 'app-projects-auth-gate.png');
});
