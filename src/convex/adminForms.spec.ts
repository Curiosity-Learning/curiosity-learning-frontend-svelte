/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const DAY = 24 * 60 * 60 * 1000;

const setup = async () => {
	const t = convexTest(schema, modules);
	const now = Date.now();
	const ids = await t.run(async (ctx) => {
		const adminProfileId = await ctx.db.insert('profiles', {
			authUserId: 'admin-user',
			isVerified: true,
			firstLoginCompleted: true,
			globalRole: 'admin',
			updatedAt: now
		});
		const guideProfileId = await ctx.db.insert('profiles', {
			authUserId: 'guide-user',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const guideRoleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: ['club:read'],
			order: 10,
			createdAt: now
		});
		const clubId = await ctx.db.insert('clubs', {
			name: 'Test Club',
			discoverable: false,
			kind: 'curiosity',
			createdByProfileId: guideProfileId,
			createdAt: now,
			updatedAt: now
		});
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: guideProfileId,
			roleId: guideRoleId,
			createdAt: now
		});
		return { adminProfileId, guideProfileId, clubId };
	});
	// Ended season whose feedback deadline is still ahead: forms are open for submission.
	const seasonId = await t.mutation(internal.seasons.createSeason, {
		name: 'Autumn 2026',
		startDate: now - 60 * DAY,
		endDate: now - DAY,
		reviewWindowOpen: now - 90 * DAY,
		reviewWindowClose: now - 70 * DAY,
		feedbackDeadline: now + 14 * DAY
	});
	return { t, now, seasonId, ...ids };
};

const asAdmin = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: 'admin-user' });
const asGuide = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: 'guide-user' });

const questions = [
	{ label: 'How was the season?', kind: 'scale_1_10' as const, required: true },
	{ label: 'What went well?', kind: 'text' as const, required: false }
];

const createGuideForm = (t: ReturnType<typeof convexTest>, seasonId: Id<'seasons'>) =>
	asAdmin(t).mutation(api.adminForms.adminCreateForm, {
		seasonId,
		audience: 'guide',
		title: '  Guide feedback  ',
		questions
	});

describe('adminForms', () => {
	it('rejects non-admins', async () => {
		const { t, seasonId } = await setup();
		await expect(t.query(api.adminForms.adminListForms, {})).rejects.toThrow();
		await expect(asGuide(t).query(api.adminForms.adminListForms, {})).rejects.toThrow(
			'Not authorized'
		);
		await expect(
			asGuide(t).mutation(api.adminForms.adminCreateForm, {
				seasonId,
				audience: 'guide',
				title: 'x',
				questions
			})
		).rejects.toThrow('Not authorized');
	});

	it('creates a form that Guides then see as outstanding', async () => {
		const { t, seasonId, clubId } = await setup();
		const formId = await createGuideForm(t, seasonId);

		const list = await asAdmin(t).query(api.adminForms.adminListForms, {});
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({
			_id: formId,
			title: 'Guide feedback',
			seasonName: 'Autumn 2026',
			questionCount: 2,
			responseCount: 0
		});

		const form = await asAdmin(t).query(api.adminForms.adminGetForm, { formId });
		expect(form.questions.map((q) => q.id)).toEqual(['q1', 'q2']);

		const outstanding = await asGuide(t).query(api.forms.listMyOutstandingForms, {});
		expect(outstanding).toEqual([expect.objectContaining({ formId, clubId })]);
	});

	it('allows one form per season and audience', async () => {
		const { t, seasonId } = await setup();
		await createGuideForm(t, seasonId);
		await expect(createGuideForm(t, seasonId)).rejects.toThrow('already has a Guide form');
		await asAdmin(t).mutation(api.adminForms.adminCreateForm, {
			seasonId,
			audience: 'learner',
			title: 'Learner feedback',
			questions
		});
	});

	it('refuses a form for a season whose feedback deadline has passed', async () => {
		const { t, now } = await setup();
		const pastSeasonId = await t.mutation(internal.seasons.createSeason, {
			name: 'Old',
			startDate: now - 200 * DAY,
			endDate: now - 100 * DAY,
			reviewWindowOpen: now - 300 * DAY,
			reviewWindowClose: now - 250 * DAY,
			feedbackDeadline: now - 80 * DAY
		});
		await expect(createGuideForm(t, pastSeasonId)).rejects.toThrow('deadline');
	});

	it('validates title and questions', async () => {
		const { t, seasonId } = await setup();
		const create = (title: string, qs: typeof questions) =>
			asAdmin(t).mutation(api.adminForms.adminCreateForm, {
				seasonId,
				audience: 'guide',
				title,
				questions: qs
			});
		await expect(create('  ', questions)).rejects.toThrow('title');
		await expect(create('Form', [])).rejects.toThrow('at least one question');
		await expect(create('Form', [{ ...questions[0], label: ' ' }])).rejects.toThrow(
			'Question 1 needs a text'
		);
	});

	it('protects answered questions but lets their text change', async () => {
		const { t, seasonId, clubId } = await setup();
		const formId = await createGuideForm(t, seasonId);
		await asGuide(t).mutation(api.forms.submitResponse, {
			formId,
			clubId,
			answers: [{ questionId: 'q1', value: 8 }]
		});

		const before = await asAdmin(t).query(api.adminForms.adminGetForm, { formId });
		expect(before.responseCount).toBe(1);
		expect(before.questions.map((q) => q.answerCount)).toEqual([1, 0]);

		const update = (
			qs: Array<{
				id?: string;
				label: string;
				kind: 'scale_1_10' | 'text' | 'yes_no';
				required: boolean;
			}>
		) =>
			asAdmin(t).mutation(api.adminForms.adminUpdateForm, {
				formId,
				title: 'Guide feedback',
				questions: qs
			});

		// Removing or retyping the answered question fails.
		await expect(update([{ id: 'q2', ...questions[1] }])).rejects.toThrow("can't be removed");
		await expect(
			update([
				{ id: 'q1', label: 'How was the season?', kind: 'text', required: true },
				{ id: 'q2', ...questions[1] }
			])
		).rejects.toThrow("type can't change");

		// Rewording it, removing/retyping the unanswered one, and adding a new one all work.
		await update([
			{ id: 'q1', label: 'How was this season overall?', kind: 'scale_1_10', required: true },
			{ label: 'Would you guide again?', kind: 'yes_no', required: true }
		]);
		const after = await asAdmin(t).query(api.adminForms.adminGetForm, { formId });
		expect(after.questions.map((q) => [q.id, q.label, q.kind])).toEqual([
			['q1', 'How was this season overall?', 'scale_1_10'],
			// q2 was removed; its id is not reused.
			['q3', 'Would you guide again?', 'yes_no']
		]);

		await expect(update([{ id: 'nope', ...questions[0] }])).rejects.toThrow('Unknown question');
	});

	it('deletes a form only while nobody has answered it', async () => {
		const { t, seasonId, clubId } = await setup();
		const formId = await createGuideForm(t, seasonId);
		await asGuide(t).mutation(api.forms.submitResponse, {
			formId,
			clubId,
			answers: [{ questionId: 'q1', value: 9 }]
		});
		await expect(asAdmin(t).mutation(api.adminForms.adminDeleteForm, { formId })).rejects.toThrow(
			'has answers'
		);

		const learnerFormId = await asAdmin(t).mutation(api.adminForms.adminCreateForm, {
			seasonId,
			audience: 'learner',
			title: 'Learner feedback',
			questions
		});
		await asAdmin(t).mutation(api.adminForms.adminDeleteForm, { formId: learnerFormId });
		const list = await asAdmin(t).query(api.adminForms.adminListForms, {});
		expect(list.map((row) => row._id)).toEqual([formId]);
	});
});
