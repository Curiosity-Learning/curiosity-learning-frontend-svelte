import { expect, test } from '@playwright/test';
import { authFile, ids } from './accounts';
import * as flows from './flows';
import { main } from './helpers';

// cl_e2e_kid_club: a child account (username sign-in), Learner in the Amsterdam club.
test.use({ storageState: authFile('child') });

test('club pages render for a child', async ({ page }) => {
	await flows.visitClubHome(page, ids.amsterdamClub, { minSigned: 1 });
	await expect(main(page).getByRole('button', { name: 'Plan next session' })).toHaveCount(0);
	await flows.visitMembers(page, ids.amsterdamClub, { minSigned: 1 });
	await flows.visitSessions(page, ids.amsterdamClub, { hasSessions: true });
	await expect(main(page).getByRole('button', { name: 'Create session' })).toBeDisabled();
	await flows.visitProjects(page, ids.amsterdamClub);
});

test('a session and a project render for a child', async ({ page }) => {
	await flows.openFirstSession(page, ids.amsterdamClub);
	await expect(main(page).getByRole('button', { name: 'New activity' })).toHaveCount(0);
	await flows.visitProjects(page, ids.amsterdamClub);
	await flows.openFirstProjectLink(page);
});

test('feeds and profiles render for a child', async ({ page }) => {
	await flows.visitFeeds(page);
	await flows.visitOwnProfile(page);
	await flows.visitOtherProfile(page, ids.adult2Profile, 'cl e2e adult2');
	await flows.visitSettings(page);
});

test('a child cannot open a club they are not in', async ({ page }) => {
	await flows.expectClubNotFound(page, ids.lisbonClub);
});

test('a child cannot open an application they were not assigned to review', async ({ page }) => {
	await page.goto(`/applications/review/${ids.reviewedApplication}`);
	await expect(main(page).getByText("You don't have access to this application.")).toBeVisible();
	await expect(main(page).getByText('Your review')).toHaveCount(0);
});
