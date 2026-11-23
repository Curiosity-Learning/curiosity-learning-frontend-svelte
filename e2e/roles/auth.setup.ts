import fs from 'node:fs';
import path from 'node:path';
import { expect, test as setup } from '@playwright/test';
import { accounts, authFile, roleKeys } from './accounts';
import { primeVercelBypass, signInWithPassword } from './helpers';

// Playwright's documented auth pattern (https://playwright.dev/docs/auth): sign in once per role,
// save the session cookies to playwright/.auth/<role>.json (gitignored), and let the role
// projects start from that state.

setup.beforeAll(() => {
	fs.mkdirSync(path.dirname(authFile('learner')), { recursive: true });
});

// Signed-out state that only carries the Vercel bypass cookie (empty locally), for tests that
// sign in themselves.
setup('anonymous visitor', async ({ context }) => {
	await primeVercelBypass(context);
	await context.storageState({
		path: path.join(path.dirname(authFile('learner')), 'anonymous.json')
	});
});

for (const role of roleKeys) {
	const account = accounts[role];
	setup(`sign in as ${role} (${account.identifier})`, async ({ context, page }) => {
		await primeVercelBypass(context);
		await signInWithPassword(page, account);
		await expect(page).toHaveURL(account.landingPath);
		await context.storageState({ path: authFile(role) });
	});
}
