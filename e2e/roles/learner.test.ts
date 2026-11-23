import { expect, test } from '@playwright/test';
import { authFile, ids } from './accounts';
import * as flows from './flows';
import { main } from './helpers';

// cl-e2e-adult1: a Learner in the Lisbon club, which has no sessions.
test.use({ storageState: authFile('learner') });

test('club pages render for a learner', async ({ page }) => {
	await flows.visitClubHome(page, ids.lisbonClub);
	// Planning sessions is for Guides.
	await expect(main(page).getByRole('button', { name: 'Plan next session' })).toHaveCount(0);
	await flows.visitMembers(page, ids.lisbonClub, { minSigned: 1 });
	await flows.visitSessions(page, ids.lisbonClub, { hasSessions: false });
	await expect(main(page).getByRole('button', { name: 'Create session' })).toBeDisabled();
	await flows.visitProjects(page, ids.lisbonClub);
});

test('feeds, a project and profiles render for a learner', async ({ page }) => {
	await flows.visitFeeds(page, { global: { minSigned: 1 } });
	await flows.openFirstProjectLink(page, { minSigned: 1 });
	await flows.visitOwnProfile(page);
	await flows.visitOtherProfile(page, ids.adult2Profile, 'cl e2e adult2');
	await flows.visitSettings(page);
});

test('a learner cannot open a club they are not in, or its sessions', async ({ page }) => {
	await flows.expectClubNotFound(page, ids.amsterdamClub);
	await page.goto(`/session/${ids.amsterdamSession}/activities`);
	await expect(main(page).getByText('Session not found')).toBeVisible();
	// The session tab bar is part of the route's header and shows either way; the session's own
	// content must not.
	await expect(main(page).getByRole('button', { name: 'New activity' })).toHaveCount(0);
});
