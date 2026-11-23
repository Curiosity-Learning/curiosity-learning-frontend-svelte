import path from 'node:path';
import { expect, test } from '@playwright/test';
import { accounts, authFile, ids } from './accounts';
import { main, signInWithPassword } from './helpers';

// Signed out (only the Vercel bypass cookie, if any): a protected page sends the visitor to
// sign-in with `next`, and signing in returns them to that page.
test.use({ storageState: path.join(path.dirname(authFile('learner')), 'anonymous.json') });

test('signing in with email returns to the page that asked for it', async ({ page }) => {
	const target = `/club/${ids.lisbonClub}/members`;
	await page.goto(target);
	await expect(page).toHaveURL(`/auth/sign-in?next=${encodeURIComponent(target)}`);
	await signInWithPassword(page, accounts.learner, target);
	await expect(page).toHaveURL(target);
	await expect(main(page).getByRole('heading', { name: 'Learners' })).toBeVisible();
});

test('signing in with a child username returns to the page that asked for it', async ({ page }) => {
	const target = '/feed/global';
	await page.goto(target);
	await expect(page).toHaveURL(`/auth/sign-in?next=${encodeURIComponent(target)}`);
	await signInWithPassword(page, accounts.child, target);
	await expect(page).toHaveURL(target);
	await expect(main(page).getByRole('heading', { name: 'Feed', level: 1 })).toBeVisible();
});

test('a wrong password is refused and stays on sign-in', async ({ page }) => {
	await page.goto('/auth/sign-in');
	await page.locator('#email').fill(accounts.learner.identifier);
	await page.locator('#password').fill('definitely-not-the-password');
	await page.getByRole('button', { name: 'Log in', exact: true }).click();
	await expect(page.getByText('Invalid username, email, or password.')).toBeVisible();
	await expect(page).toHaveURL(/\/auth\/sign-in/);
});
