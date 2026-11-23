import { expect, test } from '@playwright/test';
import { authFile, ids } from './accounts';
import * as flows from './flows';
import { expectImagesLoaded, main } from './helpers';

// cl_e2e_kid_applied: a child with no club, a pending join request to Munich and a pending
// start-club application.
test.use({ storageState: authFile('clubLess') });

test('the no-club landing lists the pending application', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/new-club$/);
	await expect(main(page).getByText('Pick your next Curiosity Club')).toBeVisible();
	await expect(main(page).getByText('TEST kid applied Curiosity Club (delete me)')).toBeVisible();
	await expectImagesLoaded(page);
});

test('club pages send a club-less user to the no-club landing', async ({ page }) => {
	for (const path of [
		'/feed',
		`/club/${ids.amsterdamClub}`,
		`/session/${ids.amsterdamSession}/activities`
	]) {
		await page.goto(path);
		await expect(page, `${path} should redirect`).toHaveURL(/\/new-club$/);
	}
});

test('account pages stay open to a club-less user', async ({ page }) => {
	await flows.visitOwnProfile(page);
	await flows.visitSettings(page);
});
