import { expect, test } from '@playwright/test';
import { authFile, ids } from './accounts';
import * as flows from './flows';
import { expectImagesLoaded, main } from './helpers';

// cl-e2e-parent2: no club of their own, linked to cl_e2e_kid_club.
test.use({ storageState: authFile('parent') });

const childPage = new RegExp(`/child/${ids.kidClubProfile}$`);

test("the parent's home is their child's read-only page", async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(childPage);
	await expect(main(page).getByText('Viewing as cl_e2e_kid_club — read-only')).toBeVisible();
	await expect(main(page).getByRole('tab', { name: 'Overview' })).toBeVisible();
	await expect(main(page).getByRole('tab', { name: 'Chats' })).toBeVisible();
	await expectImagesLoaded(page);
});

test('club pages send a club-less parent to their child', async ({ page }) => {
	for (const path of [
		'/feed',
		`/club/${ids.amsterdamClub}`,
		`/club/${ids.amsterdamClub}/sessions`
	]) {
		await page.goto(path);
		await expect(page, `${path} should redirect`).toHaveURL(childPage);
	}
});

test('account pages stay open to a club-less parent', async ({ page }) => {
	await flows.visitOwnProfile(page);
	await flows.visitSettings(page);
});
