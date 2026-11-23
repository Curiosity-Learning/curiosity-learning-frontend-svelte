import { expect, test } from '@playwright/test';
import { authFile, ids } from './accounts';
import * as flows from './flows';
import { content, expectImagesLoaded, main } from './helpers';

// cl-e2e-parent1: Guide of a Lisbon club with one review assignment. parent1 and adult2 are
// both assigned applications in dev data, but none of those applications carries a
// `reviewSeasonId`, so the current season's queue is empty for both of them. The queue's empty
// state is therefore what this account should see; the assigned application's own review page
// is checked directly.
test.use({ storageState: authFile('reviewer') });

test('the review queue and the review guide render', async ({ page }) => {
	await page.goto('/applications/review');
	await expect(
		main(page).getByRole('heading', { name: 'Application reviews', level: 1 })
	).toBeVisible();
	await expect(main(page).getByText('How to review')).toBeVisible();
	await expect(main(page).getByText('No applications assigned')).toBeVisible();
	await expect(
		main(page).getByText('Nothing is assigned to you for review this season.')
	).toBeVisible();
	await expectImagesLoaded(page);

	await main(page).getByRole('link', { name: 'Read the review guide' }).click();
	await expect(page).toHaveURL(/\/applications\/review\/guide$/);
	await expect(
		main(page).getByRole('heading', { name: 'Review guide', level: 1 }).last()
	).toBeVisible();
	await expectImagesLoaded(page);
});

test('an assigned application opens for its reviewer', async ({ page }) => {
	await page.goto(`/applications/review/${ids.reviewedApplication}`);
	await expect(
		content(page)
			.getByText('TEST banner walkthrough Curiosity Club (delete me)', { exact: true })
			.first()
	).toBeVisible();
	await expect(main(page).getByText('Why they want to start a club')).toBeVisible();
	await expect(main(page).getByText('Your review')).toBeVisible();
	await expectImagesLoaded(page);
});

test('club pages render for a reviewing guide', async ({ page }) => {
	await flows.visitClubHome(page, ids.parent1LisbonClub);
	await flows.visitMembers(page, ids.parent1LisbonClub);
	await flows.visitSettings(page);
});
