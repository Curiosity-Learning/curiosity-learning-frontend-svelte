import { expect, test } from '@playwright/test';
import { authFile, ids } from './accounts';
import * as flows from './flows';
import { expectImagesLoaded, main } from './helpers';

// cl-e2e-parent1: Guide of a Lisbon club, with application reviews assigned in past seasons.
test.use({ storageState: authFile('reviewer') });

test('the review queue and the review guide render', async ({ page }) => {
	await page.goto('/applications/review');
	await expect(
		main(page).getByRole('heading', { name: 'Application reviews', level: 1 })
	).toBeVisible();
	await expect(main(page).getByText('How to review')).toBeVisible();
	await expectImagesLoaded(page);

	await main(page).getByRole('link', { name: 'Read the review guide' }).click();
	await expect(page).toHaveURL(/\/applications\/review\/guide$/);
	await expect(
		main(page).getByRole('heading', { name: 'Review guide', level: 1 }).last()
	).toBeVisible();
	await expectImagesLoaded(page);
});

test('club pages render for a reviewing guide', async ({ page }) => {
	await flows.visitClubHome(page, ids.parent1LisbonClub);
	await flows.visitMembers(page, ids.parent1LisbonClub);
	await flows.visitSettings(page);
});
