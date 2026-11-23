import { expect, type Page } from '@playwright/test';
import { expectImagesLoaded, expectLoaded, main } from './helpers';

// Page visits shared by the role specs. Each one opens a page, checks that its main content
// rendered (not just the shell) and that every visible image, signed media included, loaded.

type MediaExpectation = { minSigned?: number };

export const visitClubHome = async (page: Page, clubId: string, media: MediaExpectation = {}) => {
	await page.goto(`/club/${clubId}`);
	await expect(page).toHaveURL(new RegExp(`/club/${clubId}$`));
	for (const section of ['Sessions', 'Projects', 'Members']) {
		await expect(main(page).getByRole('heading', { name: section, exact: true })).toBeVisible();
	}
	await expectLoaded(page);
	await expectImagesLoaded(page, media);
};

export const visitMembers = async (page: Page, clubId: string, media: MediaExpectation = {}) => {
	await page.goto(`/club/${clubId}/members`);
	await expect(main(page).getByRole('heading', { name: 'Guides', exact: true })).toBeVisible();
	await expect(main(page).getByRole('heading', { name: 'Learners', exact: true })).toBeVisible();
	await expect(main(page).locator('a[href^="/profile/"]').first()).toBeVisible();
	await expectImagesLoaded(page, media);
};

const sessionCards = (page: Page) => main(page).locator('[data-slot="card"][role="link"]');

export const visitSessions = async (
	page: Page,
	clubId: string,
	{ hasSessions }: { hasSessions: boolean }
) => {
	await page.goto(`/club/${clubId}/sessions`);
	await expectLoaded(page);
	if (hasSessions) {
		await expect(sessionCards(page).first()).toBeVisible();
	} else {
		await expect(main(page).getByText('No sessions yet.')).toBeVisible();
	}
	await expectImagesLoaded(page);
};

/** Opens the newest session from the club's sessions list. */
export const openFirstSession = async (page: Page, clubId: string) => {
	await visitSessions(page, clubId, { hasSessions: true });
	await sessionCards(page).first().click();
	await expect(page).toHaveURL(/\/session\/[a-z0-9]+\/activities$/);
	await expectSessionPage(page);
};

export const expectSessionPage = async (page: Page) => {
	await expect(main(page).getByRole('tab', { name: 'Activities' })).toBeVisible();
	await expect(main(page).getByRole('tab', { name: 'Attendees' })).toBeVisible();
	await expectLoaded(page);
	await expectImagesLoaded(page);
};

export const visitProjects = async (page: Page, clubId: string) => {
	await page.goto(`/club/${clubId}/projects`);
	await expect(page).toHaveURL(new RegExp(`/club/${clubId}/projects/current$`));
	await expect(main(page).getByRole('tab', { name: 'Current', exact: true })).toBeVisible();
	await expect(main(page).getByRole('tab', { name: 'Completed', exact: true })).toBeVisible();
	await expectLoaded(page);
	await expectImagesLoaded(page);
};

/** Opens the first project linked from the current page. */
export const openFirstProjectLink = async (page: Page, media: MediaExpectation = {}) => {
	const link = main(page).locator('a[href^="/project/"]').first();
	await expect(link).toBeVisible();
	await link.click();
	await expect(page).toHaveURL(/\/project\/[a-z0-9]+\/overview$/);
	await expect(main(page).getByRole('tab', { name: 'Overview', exact: true })).toBeVisible();
	await expect(main(page).getByRole('tab', { name: 'Members', exact: true })).toBeVisible();
	await expect(main(page).getByText('Updates', { exact: true })).toBeVisible();
	await expectLoaded(page);
	await expectImagesLoaded(page, media);
};

export const visitFeeds = async (page: Page, media: { global?: MediaExpectation } = {}) => {
	await page.goto('/feed/my-clubs');
	await expect(main(page).getByRole('heading', { name: 'Feed', level: 1 })).toBeVisible();
	await expectLoaded(page);
	await expectImagesLoaded(page);

	await main(page).getByRole('tab', { name: 'Global', exact: true }).click();
	await expect(page).toHaveURL(/\/feed\/global$/);
	await expect(main(page).getByRole('heading', { name: 'Feed', level: 1 })).toBeVisible();
	await expectLoaded(page);
	await expectImagesLoaded(page, media.global);
};

export const visitOwnProfile = async (page: Page) => {
	await page.goto('/profile');
	await expect(main(page).getByRole('heading', { name: 'My profile', level: 1 })).toBeVisible();
	await expectImagesLoaded(page);
};

export const visitOtherProfile = async (page: Page, profileId: string, name: string) => {
	await page.goto(`/profile/${profileId}`);
	await expect(main(page).getByRole('heading', { name, level: 1 })).toBeVisible();
	await expectImagesLoaded(page);
};

export const visitSettings = async (page: Page) => {
	await page.goto('/settings');
	await expect(main(page).getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
	await expect(main(page).getByRole('button', { name: 'Save profile' })).toBeVisible();
	await expectImagesLoaded(page);
};

export const expectClubNotFound = async (page: Page, clubId: string) => {
	await page.goto(`/club/${clubId}`);
	await expect(main(page).getByText('Club not found')).toBeVisible();
};
