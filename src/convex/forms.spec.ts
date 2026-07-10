/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const DAY = 24 * 60 * 60 * 1000;

const GUIDE_PERMISSIONS = ['club:read', 'club:edit'];
const LEARNER_PERMISSIONS = ['club:read'];

const seedRoles = async (t: ReturnType<typeof convexTest>) => {
	return await t.run(async (ctx) => {
		const guideRoleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: GUIDE_PERMISSIONS,
			order: 10,
			createdAt: Date.now()
		});
		const learnerRoleId = await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: LEARNER_PERMISSIONS,
			order: 100,
			createdAt: Date.now()
		});
		return { guideRoleId, learnerRoleId };
	});
};

const seedProfile = async (t: ReturnType<typeof convexTest>, authUserId: string) => {
	return await t.run(async (ctx) => {
		return await ctx.db.insert('profiles', {
			authUserId,
			isVerified: true,
			firstLoginCompleted: false,
			updatedAt: Date.now()
		});
	});
};

const seedClub = async (
	t: ReturnType<typeof convexTest>,
	name: string,
	createdByProfileId: Id<'profiles'>,
	kind: 'curiosity' | 'coc' = 'curiosity'
) => {
	return await t.run(async (ctx) => {
		const now = Date.now();
		return await ctx.db.insert('clubs', {
			name,
			discoverable: false,
			kind,
			createdByProfileId,
			createdAt: now,
			updatedAt: now
		});
	});
};

const seedMembership = async (
	t: ReturnType<typeof convexTest>,
	clubId: Id<'clubs'>,
	profileId: Id<'profiles'>,
	roleId: Id<'clubRoles'>
) => {
	return await t.run(async (ctx) => {
		return await ctx.db.insert('clubMembers', {
			clubId,
			profileId,
			roleId,
			createdAt: Date.now()
		});
	});
};

const seedSeason = async (
	t: ReturnType<typeof convexTest>,
	overrides: Partial<{
		name: string;
		startDate: number;
		endDate: number;
		reviewWindowOpen: number;
		reviewWindowClose: number;
		feedbackDeadline: number;
	}> = {}
) => {
	const now = Date.now();
	return await t.mutation(internal.seasons.createSeason, {
		name: overrides.name ?? 'Test Season',
		startDate: overrides.startDate ?? now - 60 * DAY,
		endDate: overrides.endDate ?? now - 10 * DAY,
		reviewWindowOpen: overrides.reviewWindowOpen ?? now - 60 * DAY,
		reviewWindowClose: overrides.reviewWindowClose ?? now - 30 * DAY,
		feedbackDeadline: overrides.feedbackDeadline ?? now + 60 * DAY
	});
};

const seedForm = async (
	t: ReturnType<typeof convexTest>,
	seasonId: Id<'seasons'>,
	audience: 'guide' | 'learner',
	title: string
) => {
	return await t.mutation(internal.forms.createForm, {
		title,
		audience,
		seasonId,
		questions: [
			{ id: 'overall_score', label: 'Overall score', kind: 'scale_1_10', required: true },
			{ id: 'went_well', label: 'What went well?', kind: 'text', required: false },
			{ id: 'would_return', label: 'Would you return?', kind: 'yes_no', required: true }
		]
	});
};

describe('forms: listMyOutstandingForms', () => {
	it('returns nothing when the season has not ended yet', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'guide-user');
		const clubId = await seedClub(t, 'Future Club', profileId);
		await seedMembership(t, clubId, profileId, guideRoleId);

		const season = await seedSeason(t, { endDate: Date.now() + 30 * DAY });
		await seedForm(t, season, 'guide', 'Guide Form');

		const outstanding = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.forms.listMyOutstandingForms, {});
		expect(outstanding).toHaveLength(0);
	});

	it('returns the matching form once the season has ended', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'guide-user');
		const clubId = await seedClub(t, 'Ended Club', profileId);
		await seedMembership(t, clubId, profileId, guideRoleId);

		const season = await seedSeason(t);
		await seedForm(t, season, 'guide', 'Guide Form');

		const outstanding = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.forms.listMyOutstandingForms, {});
		expect(outstanding).toHaveLength(1);
		expect(outstanding[0].audience).toBe('guide');
		expect(outstanding[0].clubName).toBe('Ended Club');
	});

	it('gives a user both a guide form for one club and a learner form for another', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId, learnerRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'dual-user');
		const clubA = await seedClub(t, 'Club A', profileId);
		const clubB = await seedClub(t, 'Club B', profileId);
		await seedMembership(t, clubA, profileId, guideRoleId);
		await seedMembership(t, clubB, profileId, learnerRoleId);

		const season = await seedSeason(t);
		await seedForm(t, season, 'guide', 'Guide Form');
		await seedForm(t, season, 'learner', 'Learner Form');

		const outstanding = await t
			.withIdentity({ subject: 'dual-user' })
			.query(api.forms.listMyOutstandingForms, {});
		expect(outstanding).toHaveLength(2);
		const byClub = new Map(outstanding.map((item) => [item.clubId, item]));
		expect(byClub.get(clubA)?.audience).toBe('guide');
		expect(byClub.get(clubB)?.audience).toBe('learner');
	});

	it('excludes Club of Clubs (coc) memberships', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'coc-user');
		const cocClub = await seedClub(t, 'CoC Group', profileId, 'coc');
		await seedMembership(t, cocClub, profileId, guideRoleId);

		const season = await seedSeason(t);
		await seedForm(t, season, 'guide', 'Guide Form');

		const outstanding = await t
			.withIdentity({ subject: 'coc-user' })
			.query(api.forms.listMyOutstandingForms, {});
		expect(outstanding).toHaveLength(0);
	});

	it('excludes forms already submitted', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'guide-user');
		const clubId = await seedClub(t, 'Ended Club', profileId);
		await seedMembership(t, clubId, profileId, guideRoleId);

		const season = await seedSeason(t);
		const formId = await seedForm(t, season, 'guide', 'Guide Form');

		const asUser = t.withIdentity({ subject: 'guide-user' });
		await asUser.mutation(api.forms.submitResponse, {
			formId,
			clubId,
			answers: [
				{ questionId: 'overall_score', value: 8 },
				{ questionId: 'would_return', value: true }
			]
		});

		const outstanding = await asUser.query(api.forms.listMyOutstandingForms, {});
		expect(outstanding).toHaveLength(0);
	});

	it('considers every season with an open collection window, not just "current"', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'guide-user');
		const clubId = await seedClub(t, 'Ended Club', profileId);
		await seedMembership(t, clubId, profileId, guideRoleId);

		const now = Date.now();
		const seasonA = await seedSeason(t, {
			name: 'Old Season',
			startDate: now - 200 * DAY,
			endDate: now - 100 * DAY,
			reviewWindowOpen: now - 200 * DAY,
			reviewWindowClose: now - 150 * DAY,
			feedbackDeadline: now + 100 * DAY
		});
		const seasonB = await seedSeason(t, {
			name: 'Recently Ended Season',
			startDate: now - 60 * DAY,
			endDate: now - 5 * DAY,
			reviewWindowOpen: now - 60 * DAY,
			reviewWindowClose: now - 20 * DAY,
			feedbackDeadline: now + 60 * DAY
		});
		await seedForm(t, seasonA, 'guide', 'Old Season Guide Form');
		await seedForm(t, seasonB, 'guide', 'Recent Season Guide Form');

		const outstanding = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.forms.listMyOutstandingForms, {});
		expect(outstanding).toHaveLength(2);
		const titles = new Set(outstanding.map((item) => item.title));
		expect(titles.has('Old Season Guide Form')).toBe(true);
		expect(titles.has('Recent Season Guide Form')).toBe(true);
	});
});

describe('forms: submitResponse validation', () => {
	it('rejects submission missing a required answer', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'guide-user');
		const clubId = await seedClub(t, 'Club', profileId);
		await seedMembership(t, clubId, profileId, guideRoleId);
		const season = await seedSeason(t);
		const formId = await seedForm(t, season, 'guide', 'Guide Form');

		await expect(
			t.withIdentity({ subject: 'guide-user' }).mutation(api.forms.submitResponse, {
				formId,
				clubId,
				answers: [{ questionId: 'would_return', value: true }]
			})
		).rejects.toThrow();
	});

	it('rejects a scale answer out of 1-10 bounds', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'guide-user');
		const clubId = await seedClub(t, 'Club', profileId);
		await seedMembership(t, clubId, profileId, guideRoleId);
		const season = await seedSeason(t);
		const formId = await seedForm(t, season, 'guide', 'Guide Form');

		await expect(
			t.withIdentity({ subject: 'guide-user' }).mutation(api.forms.submitResponse, {
				formId,
				clubId,
				answers: [
					{ questionId: 'overall_score', value: 11 },
					{ questionId: 'would_return', value: true }
				]
			})
		).rejects.toThrow();

		await expect(
			t.withIdentity({ subject: 'guide-user' }).mutation(api.forms.submitResponse, {
				formId,
				clubId,
				answers: [
					{ questionId: 'overall_score', value: 0 },
					{ questionId: 'would_return', value: true }
				]
			})
		).rejects.toThrow();
	});

	it('rejects a type mismatch (string for a scale question)', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'guide-user');
		const clubId = await seedClub(t, 'Club', profileId);
		await seedMembership(t, clubId, profileId, guideRoleId);
		const season = await seedSeason(t);
		const formId = await seedForm(t, season, 'guide', 'Guide Form');

		await expect(
			t.withIdentity({ subject: 'guide-user' }).mutation(api.forms.submitResponse, {
				formId,
				clubId,
				answers: [
					{ questionId: 'overall_score', value: 'great' as unknown as number },
					{ questionId: 'would_return', value: true }
				]
			})
		).rejects.toThrow();
	});

	it('accepts a valid submission', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'guide-user');
		const clubId = await seedClub(t, 'Club', profileId);
		await seedMembership(t, clubId, profileId, guideRoleId);
		const season = await seedSeason(t);
		const formId = await seedForm(t, season, 'guide', 'Guide Form');

		const responseId = await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.forms.submitResponse, {
				formId,
				clubId,
				answers: [
					{ questionId: 'overall_score', value: 9 },
					{ questionId: 'went_well', value: 'Great sessions' },
					{ questionId: 'would_return', value: true }
				]
			});
		expect(responseId).toBeTruthy();
	});

	it('rejects the wrong role submitting a form (guide form submitted by a learner)', async () => {
		const t = convexTest(schema, modules);
		const { learnerRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'learner-user');
		const clubId = await seedClub(t, 'Club', profileId);
		await seedMembership(t, clubId, profileId, learnerRoleId);
		const season = await seedSeason(t);
		const formId = await seedForm(t, season, 'guide', 'Guide Form');

		await expect(
			t.withIdentity({ subject: 'learner-user' }).mutation(api.forms.submitResponse, {
				formId,
				clubId,
				answers: [
					{ questionId: 'overall_score', value: 9 },
					{ questionId: 'would_return', value: true }
				]
			})
		).rejects.toThrow();
	});
});

describe('forms: duplicate-submission guard and immutability', () => {
	it('rejects a second submission for the same (form, profile, club)', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'guide-user');
		const clubId = await seedClub(t, 'Club', profileId);
		await seedMembership(t, clubId, profileId, guideRoleId);
		const season = await seedSeason(t);
		const formId = await seedForm(t, season, 'guide', 'Guide Form');

		const asUser = t.withIdentity({ subject: 'guide-user' });
		const answers = [
			{ questionId: 'overall_score', value: 7 },
			{ questionId: 'would_return', value: true }
		];
		await asUser.mutation(api.forms.submitResponse, { formId, clubId, answers });

		await expect(
			asUser.mutation(api.forms.submitResponse, { formId, clubId, answers })
		).rejects.toThrow();
	});

	it('has no update/delete mutation exported for formResponses', async () => {
		const formsModule = (await import('./forms')) as Record<string, unknown>;
		expect(formsModule.updateResponse).toBeUndefined();
		expect(formsModule.deleteResponse).toBeUndefined();
	});
});

describe('forms: getFormForSubmission', () => {
	it('returns the form for an eligible member', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'guide-user');
		const clubId = await seedClub(t, 'Club', profileId);
		await seedMembership(t, clubId, profileId, guideRoleId);
		const season = await seedSeason(t);
		const formId = await seedForm(t, season, 'guide', 'Guide Form');

		const result = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.forms.getFormForSubmission, { formId, clubId });
		expect(result.title).toBe('Guide Form');
		expect(result.questions).toHaveLength(3);
	});

	it('rejects a non-member', async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t);
		const ownerProfileId = await seedProfile(t, 'owner-user');
		const clubId = await seedClub(t, 'Club', ownerProfileId);
		const season = await seedSeason(t);
		const formId = await seedForm(t, season, 'guide', 'Guide Form');

		await seedProfile(t, 'outsider-user');
		await expect(
			t
				.withIdentity({ subject: 'outsider-user' })
				.query(api.forms.getFormForSubmission, { formId, clubId })
		).rejects.toThrow();
	});
});
