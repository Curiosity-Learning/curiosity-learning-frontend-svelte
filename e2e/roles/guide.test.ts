import { expect, test } from '@playwright/test';
import { authFile, ids } from './accounts';
import * as flows from './flows';
import { main } from './helpers';

// cl-e2e-adult2: Guide of the Amsterdam club, Learner in the Lisbon club.
test.use({ storageState: authFile('guide') });

test('club pages render with guide controls', async ({ page }) => {
	await flows.visitClubHome(page, ids.amsterdamClub, { minSigned: 1 });
	await expect(main(page).getByRole('button', { name: 'Plan next session' })).toBeVisible();
	await flows.visitMembers(page, ids.amsterdamClub, { minSigned: 1 });
	await expect(main(page).getByRole('button', { name: 'Invite' })).toBeVisible();
	await flows.visitSessions(page, ids.amsterdamClub, { hasSessions: true });
	await expect(main(page).getByRole('button', { name: 'Create session' })).toBeEnabled();
	await flows.visitProjects(page, ids.amsterdamClub);
});

test('a session and a project render for a guide', async ({ page }) => {
	await flows.openFirstSession(page, ids.amsterdamClub);
	// Guides plan the session's activities.
	await expect(main(page).getByRole('button', { name: 'New activity' })).toBeVisible();
	await flows.visitProjects(page, ids.amsterdamClub);
	await flows.openFirstProjectLink(page);
});

test('feeds and profiles render for a guide', async ({ page }) => {
	await flows.visitFeeds(page, { global: { minSigned: 1 } });
	await flows.visitOwnProfile(page);
	await flows.visitOtherProfile(page, ids.kidClubProfile, 'cl_e2e_kid_club');
	await flows.visitSettings(page);
});

test('guide controls stay off in a club where they are a learner', async ({ page }) => {
	await flows.visitSessions(page, ids.lisbonClub, { hasSessions: false });
	await expect(main(page).getByRole('button', { name: 'Create session' })).toBeDisabled();
});
