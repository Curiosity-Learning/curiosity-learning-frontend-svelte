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

describe('forms: getMyEnforcementState', () => {
	it('returns none when no outstanding form has a passed deadline', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'guide-user');
		const clubId = await seedClub(t, 'Club', profileId);
		await seedMembership(t, clubId, profileId, guideRoleId);

		const season = await seedSeason(t, { feedbackDeadline: Date.now() + 30 * DAY });
		await seedForm(t, season, 'guide', 'Guide Form');

		const state = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.forms.getMyEnforcementState, {});
		expect(state.phase).toBe('none');
	});

	it('returns none when there is no outstanding form at all', async () => {
		const t = convexTest(schema, modules);
		await seedRoles(t);
		const profileId = await seedProfile(t, 'lone-user');
		await seedClub(t, 'Club', profileId);

		const state = await t
			.withIdentity({ subject: 'lone-user' })
			.query(api.forms.getMyEnforcementState, {});
		expect(state.phase).toBe('none');
		expect(state.oldestDeadline).toBeNull();
	});

	it('is "reminder" the day after the deadline (day 1)', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'guide-user');
		const clubId = await seedClub(t, 'Club', profileId);
		await seedMembership(t, clubId, profileId, guideRoleId);

		const season = await seedSeason(t, { feedbackDeadline: Date.now() - 1 * DAY - 1000 });
		await seedForm(t, season, 'guide', 'Guide Form');

		const state = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.forms.getMyEnforcementState, {});
		expect(state.phase).toBe('reminder');
	});

	it('is still "reminder" on day 7, and "escalation" on day 8 (the boundary)', async () => {
		const seedAtDaysPast = async (daysPast: number) => {
			const t = convexTest(schema, modules);
			const { guideRoleId } = await seedRoles(t);
			const profileId = await seedProfile(t, 'guide-user');
			const clubId = await seedClub(t, 'Club', profileId);
			await seedMembership(t, clubId, profileId, guideRoleId);

			const season = await seedSeason(t, {
				feedbackDeadline: Date.now() - daysPast * DAY - 1000
			});
			await seedForm(t, season, 'guide', 'Guide Form');

			return await t
				.withIdentity({ subject: 'guide-user' })
				.query(api.forms.getMyEnforcementState, {});
		};

		expect((await seedAtDaysPast(7)).phase).toBe('reminder');
		expect((await seedAtDaysPast(8)).phase).toBe('escalation');
	});

	it('is still "escalation" on day 14, and "blocked" on day 15 (the boundary)', async () => {
		const seedAtDaysPast = async (daysPast: number) => {
			const t = convexTest(schema, modules);
			const { guideRoleId } = await seedRoles(t);
			const profileId = await seedProfile(t, 'guide-user');
			const clubId = await seedClub(t, 'Club', profileId);
			await seedMembership(t, clubId, profileId, guideRoleId);

			const now = Date.now();
			const season = await seedSeason(t, {
				endDate: now - (daysPast + 30) * DAY,
				feedbackDeadline: now - daysPast * DAY - 1000
			});
			await seedForm(t, season, 'guide', 'Guide Form');

			return await t
				.withIdentity({ subject: 'guide-user' })
				.query(api.forms.getMyEnforcementState, {});
		};

		expect((await seedAtDaysPast(14)).phase).toBe('escalation');
		expect((await seedAtDaysPast(15)).phase).toBe('blocked');
	});

	it('keys the phase to the OLDEST overdue obligation across multiple outstanding forms', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId, learnerRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'dual-user');
		const clubA = await seedClub(t, 'Club A', profileId);
		const clubB = await seedClub(t, 'Club B', profileId);
		await seedMembership(t, clubA, profileId, guideRoleId);
		await seedMembership(t, clubB, profileId, learnerRoleId);

		const now = Date.now();
		// Club A's season deadline passed 20 days ago (would be "blocked" alone).
		const seasonA = await seedSeason(t, {
			name: 'Season A',
			endDate: now - 40 * DAY,
			feedbackDeadline: now - 20 * DAY
		});
		// Club B's season deadline passed only 2 days ago (would be "reminder" alone) — but since
		// it's not the oldest, it shouldn't determine the overall phase.
		const seasonB = await seedSeason(t, {
			name: 'Season B',
			endDate: now - 20 * DAY,
			feedbackDeadline: now - 2 * DAY
		});
		await seedForm(t, seasonA, 'guide', 'Guide Form A');
		await seedForm(t, seasonB, 'learner', 'Learner Form B');

		const state = await t
			.withIdentity({ subject: 'dual-user' })
			.query(api.forms.getMyEnforcementState, {});
		expect(state.phase).toBe('blocked');
		expect(state.clubName).toBe('Club A');
	});

	it('drops out of enforcement once the oldest overdue form is submitted', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'guide-user');
		const clubId = await seedClub(t, 'Club', profileId);
		await seedMembership(t, clubId, profileId, guideRoleId);

		const season = await seedSeason(t, {
			endDate: Date.now() - 50 * DAY,
			feedbackDeadline: Date.now() - 20 * DAY
		});
		const formId = await seedForm(t, season, 'guide', 'Guide Form');

		const asUser = t.withIdentity({ subject: 'guide-user' });
		expect((await asUser.query(api.forms.getMyEnforcementState, {})).phase).toBe('blocked');

		await asUser.mutation(api.forms.submitResponse, {
			formId,
			clubId,
			answers: [
				{ questionId: 'overall_score', value: 9 },
				{ questionId: 'would_return', value: true }
			]
		});

		expect((await asUser.query(api.forms.getMyEnforcementState, {})).phase).toBe('none');
	});
});

describe('forms: quality flags (PRD 6.11.4)', () => {
	it('creates an open qualityFlags row when the club+season average drops below 7', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'guide-user');
		const clubId = await seedClub(t, 'Club', profileId);
		await seedMembership(t, clubId, profileId, guideRoleId);
		const season = await seedSeason(t);
		const formId = await seedForm(t, season, 'guide', 'Guide Form');

		await t.withIdentity({ subject: 'guide-user' }).mutation(api.forms.submitResponse, {
			formId,
			clubId,
			answers: [
				{ questionId: 'overall_score', value: 5 },
				{ questionId: 'would_return', value: true }
			]
		});

		const flags = await t.run(async (ctx) => await ctx.db.query('qualityFlags').collect());
		expect(flags).toHaveLength(1);
		expect(flags[0].avgScore).toBe(5);
		expect(flags[0].status).toBe('open');
	});

	it('does not create a flag when the average is >= 7', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'guide-user');
		const clubId = await seedClub(t, 'Club', profileId);
		await seedMembership(t, clubId, profileId, guideRoleId);
		const season = await seedSeason(t);
		const formId = await seedForm(t, season, 'guide', 'Guide Form');

		await t.withIdentity({ subject: 'guide-user' }).mutation(api.forms.submitResponse, {
			formId,
			clubId,
			answers: [
				{ questionId: 'overall_score', value: 7 },
				{ questionId: 'would_return', value: true }
			]
		});

		const flags = await t.run(async (ctx) => await ctx.db.query('qualityFlags').collect());
		expect(flags).toHaveLength(0);
	});

	it('updates avgScore across multiple responses and resolves (deletes) the flag once avg >= 7', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const clubOwnerId = await seedProfile(t, 'club-owner');
		const clubId = await seedClub(t, 'Club', clubOwnerId);
		const season = await seedSeason(t);
		const formId = await seedForm(t, season, 'guide', 'Guide Form');

		const guideOneId = await seedProfile(t, 'guide-one');
		const guideTwoId = await seedProfile(t, 'guide-two');
		await seedMembership(t, clubId, guideOneId, guideRoleId);
		await seedMembership(t, clubId, guideTwoId, guideRoleId);

		await t.withIdentity({ subject: 'guide-one' }).mutation(api.forms.submitResponse, {
			formId,
			clubId,
			answers: [
				{ questionId: 'overall_score', value: 4 },
				{ questionId: 'would_return', value: true }
			]
		});

		let flags = await t.run(async (ctx) => await ctx.db.query('qualityFlags').collect());
		expect(flags).toHaveLength(1);
		expect(flags[0].avgScore).toBe(4);

		// Second response brings the average up to (4 + 10) / 2 = 7, which should resolve the flag.
		await t.withIdentity({ subject: 'guide-two' }).mutation(api.forms.submitResponse, {
			formId,
			clubId,
			answers: [
				{ questionId: 'overall_score', value: 10 },
				{ questionId: 'would_return', value: true }
			]
		});

		flags = await t.run(async (ctx) => await ctx.db.query('qualityFlags').collect());
		expect(flags).toHaveLength(0);
	});

	it('notifies the CoC group Guides when a flag is first created', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const cocGuideId = await seedProfile(t, 'coc-guide');
		const cocGroupId = await seedClub(t, 'CoC Group', cocGuideId, 'coc');
		await seedMembership(t, cocGroupId, cocGuideId, guideRoleId);

		const clubGuideId = await seedProfile(t, 'club-guide');
		const clubId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert('clubs', {
				name: 'Club',
				discoverable: false,
				kind: 'curiosity',
				cocGroupId,
				createdByProfileId: clubGuideId,
				createdAt: now,
				updatedAt: now
			});
		});
		await seedMembership(t, clubId, clubGuideId, guideRoleId);

		const season = await seedSeason(t);
		const formId = await seedForm(t, season, 'guide', 'Guide Form');

		await t.withIdentity({ subject: 'club-guide' }).mutation(api.forms.submitResponse, {
			formId,
			clubId,
			answers: [
				{ questionId: 'overall_score', value: 3 },
				{ questionId: 'would_return', value: true }
			]
		});

		const notifications = await t.run(async (ctx) => {
			return await ctx.db
				.query('notifications')
				.withIndex('by_profile', (q) => q.eq('profileId', cocGuideId))
				.collect();
		});
		expect(notifications).toHaveLength(1);
		expect(notifications[0].title).toBe('Quality flag raised');
	});
});

describe('forms: sendFeedbackDeadlineReminders dedupe', () => {
	it('sends the 7-day-before reminder once and does not resend it on a later run', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'guide-user');
		const clubId = await seedClub(t, 'Club', profileId);
		await seedMembership(t, clubId, profileId, guideRoleId);

		const season = await seedSeason(t, {
			endDate: Date.now() - 1 * DAY,
			feedbackDeadline: Date.now() + 7 * DAY
		});
		await seedForm(t, season, 'guide', 'Guide Form');

		const first = await t.mutation(internal.forms.sendFeedbackDeadlineReminders, {});
		expect(first.remindersSent).toBe(1);

		const second = await t.mutation(internal.forms.sendFeedbackDeadlineReminders, {});
		expect(second.remindersSent).toBe(0);

		const reminders = await t.run(async (ctx) => await ctx.db.query('feedbackReminders').collect());
		expect(reminders).toHaveLength(1);
		expect(reminders[0].stage).toBe('7d');
	});

	it('does not send a reminder once the form has already been submitted', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'guide-user');
		const clubId = await seedClub(t, 'Club', profileId);
		await seedMembership(t, clubId, profileId, guideRoleId);

		const season = await seedSeason(t, {
			endDate: Date.now() - 1 * DAY,
			feedbackDeadline: Date.now() + 7 * DAY
		});
		const formId = await seedForm(t, season, 'guide', 'Guide Form');

		await t.withIdentity({ subject: 'guide-user' }).mutation(api.forms.submitResponse, {
			formId,
			clubId,
			answers: [
				{ questionId: 'overall_score', value: 9 },
				{ questionId: 'would_return', value: true }
			]
		});

		const result = await t.mutation(internal.forms.sendFeedbackDeadlineReminders, {});
		expect(result.remindersSent).toBe(0);
	});

	it('does not send reminders once the deadline has already passed (post-deadline is a UI concern)', async () => {
		const t = convexTest(schema, modules);
		const { guideRoleId } = await seedRoles(t);
		const profileId = await seedProfile(t, 'guide-user');
		const clubId = await seedClub(t, 'Club', profileId);
		await seedMembership(t, clubId, profileId, guideRoleId);

		const season = await seedSeason(t, {
			endDate: Date.now() - 20 * DAY,
			feedbackDeadline: Date.now() - 1 * DAY
		});
		await seedForm(t, season, 'guide', 'Guide Form');

		const result = await t.mutation(internal.forms.sendFeedbackDeadlineReminders, {});
		expect(result.remindersSent).toBe(0);
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
