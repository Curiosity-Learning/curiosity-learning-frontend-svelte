import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { requireGlobalAdmin } from './permissions';

// CL-790: the admin portal's writer for seasonal feedback forms (PRD 6.11). forms.ts owns the
// member-facing side (outstanding forms, submission, enforcement, reminders); this file is the
// admin-only surface on top of the same `forms` table. Every export calls requireGlobalAdmin
// first.
//
// Rules, chosen so that answers Guides already gave keep their meaning:
// - One form per season and audience. Every form of a season is due for everyone in that
//   audience, so a second one would double the obligation (and the CL-733 block) by accident.
// - Season and audience are fixed once the form exists (delete and recreate while it has no
//   answers).
// - No new forms for a season whose feedback deadline has passed: the form would be overdue the
//   moment it is saved, and 15 days past the deadline it blocks every Guide (CL-733).
// - Questions: the text and "required" can always change, and questions can be added or
//   reordered. A question somebody has answered cannot be removed or change its type, because
//   the stored answers would then point at nothing or hold the wrong kind of value.
// - A form can only be deleted while nobody has submitted it.

const questionKind = v.union(v.literal('scale_1_10'), v.literal('text'), v.literal('yes_no'));
const audience = v.union(v.literal('guide'), v.literal('learner'));

const questionInput = v.object({
	// Present for a question that is already on the form, absent for a new one.
	id: v.optional(v.string()),
	label: v.string(),
	kind: questionKind,
	required: v.boolean()
});

type QuestionInput = {
	id?: string;
	label: string;
	kind: Doc<'forms'>['questions'][number]['kind'];
	required: boolean;
};

const MAX_TITLE_LENGTH = 200;
const MAX_LABEL_LENGTH = 500;
const MAX_QUESTIONS = 50;

const cleanTitle = (title: string) => {
	const trimmed = title.trim();
	if (!trimmed) throw new ConvexError('Give the form a title');
	if (trimmed.length > MAX_TITLE_LENGTH) {
		throw new ConvexError(`The title can be at most ${MAX_TITLE_LENGTH} characters`);
	}
	return trimmed;
};

const cleanLabel = (label: string, position: number) => {
	const trimmed = label.trim();
	if (!trimmed) throw new ConvexError(`Question ${position} needs a text`);
	if (trimmed.length > MAX_LABEL_LENGTH) {
		throw new ConvexError(`Question ${position} can be at most ${MAX_LABEL_LENGTH} characters`);
	}
	return trimmed;
};

const checkQuestionCount = (count: number) => {
	if (count === 0) throw new ConvexError('A form needs at least one question');
	if (count > MAX_QUESTIONS) {
		throw new ConvexError(`A form can have at most ${MAX_QUESTIONS} questions`);
	}
};

// Short ids that are unique within the form. Ids never change once given, because responses
// store answers by question id.
const newQuestionId = (taken: Set<string>) => {
	let n = taken.size + 1;
	while (taken.has(`q${n}`)) n += 1;
	const id = `q${n}`;
	taken.add(id);
	return id;
};

const listResponses = (ctx: QueryCtx, formId: Id<'forms'>) =>
	ctx.db
		.query('formResponses')
		.withIndex('by_form_profile_club', (q) => q.eq('formId', formId))
		.collect();

// questionId -> how many responses answered it.
const countAnswers = (responses: Doc<'formResponses'>[]) => {
	const counts = new Map<string, number>();
	for (const response of responses) {
		for (const answer of response.answers) {
			counts.set(answer.questionId, (counts.get(answer.questionId) ?? 0) + 1);
		}
	}
	return counts;
};

const requireForm = async (ctx: QueryCtx, formId: Id<'forms'>) => {
	const form = await ctx.db.get(formId);
	if (!form) throw new ConvexError('Form not found');
	return form;
};

const assertNoOtherFormForAudience = async (
	ctx: MutationCtx,
	seasonId: Id<'seasons'>,
	formAudience: 'guide' | 'learner'
) => {
	const existing = await ctx.db
		.query('forms')
		.withIndex('by_season_and_audience', (q) =>
			q.eq('seasonId', seasonId).eq('audience', formAudience)
		)
		.first();
	if (existing) {
		throw new ConvexError(
			`This season already has a ${formAudience === 'guide' ? 'Guide' : 'Learner'} form. Edit that one instead.`
		);
	}
};

const formSummary = v.object({
	_id: v.id('forms'),
	title: v.string(),
	audience,
	seasonId: v.id('seasons'),
	seasonName: v.string(),
	seasonEndDate: v.union(v.number(), v.null()),
	feedbackDeadline: v.union(v.number(), v.null()),
	questionCount: v.number(),
	responseCount: v.number(),
	createdAt: v.number(),
	updatedAt: v.number()
});

export const adminListForms = query({
	args: {},
	returns: v.array(formSummary),
	handler: async (ctx) => {
		await requireGlobalAdmin(ctx);
		const forms = await ctx.db.query('forms').collect();
		const seasons = new Map<Id<'seasons'>, Doc<'seasons'> | null>();
		const rows = [];
		for (const form of forms) {
			if (!seasons.has(form.seasonId)) seasons.set(form.seasonId, await ctx.db.get(form.seasonId));
			const season = seasons.get(form.seasonId) ?? null;
			const responses = await listResponses(ctx, form._id);
			rows.push({
				_id: form._id,
				title: form.title,
				audience: form.audience,
				seasonId: form.seasonId,
				seasonName: season?.name ?? 'Unknown season',
				seasonEndDate: season?.endDate ?? null,
				feedbackDeadline: season?.feedbackDeadline ?? null,
				questionCount: form.questions.length,
				responseCount: responses.length,
				createdAt: form.createdAt,
				updatedAt: form.updatedAt
			});
		}
		// Newest season first, Guide form before Learner form.
		rows.sort(
			(a, b) =>
				(b.seasonEndDate ?? 0) - (a.seasonEndDate ?? 0) || a.audience.localeCompare(b.audience)
		);
		return rows;
	}
});

export const adminGetForm = query({
	args: { formId: v.id('forms') },
	returns: v.object({
		_id: v.id('forms'),
		title: v.string(),
		audience,
		seasonId: v.id('seasons'),
		seasonName: v.string(),
		responseCount: v.number(),
		questions: v.array(
			v.object({
				id: v.string(),
				label: v.string(),
				kind: questionKind,
				required: v.boolean(),
				answerCount: v.number()
			})
		)
	}),
	handler: async (ctx, args) => {
		await requireGlobalAdmin(ctx);
		const form = await requireForm(ctx, args.formId);
		const season = await ctx.db.get(form.seasonId);
		const responses = await listResponses(ctx, form._id);
		const answers = countAnswers(responses);
		return {
			_id: form._id,
			title: form.title,
			audience: form.audience,
			seasonId: form.seasonId,
			seasonName: season?.name ?? 'Unknown season',
			responseCount: responses.length,
			questions: form.questions.map((question) => ({
				...question,
				answerCount: answers.get(question.id) ?? 0
			}))
		};
	}
});

export const adminCreateForm = mutation({
	args: {
		seasonId: v.id('seasons'),
		audience,
		title: v.string(),
		questions: v.array(questionInput)
	},
	returns: v.id('forms'),
	handler: async (ctx, args) => {
		await requireGlobalAdmin(ctx);
		const season = await ctx.db.get(args.seasonId);
		if (!season) throw new ConvexError('Season not found');
		if (season.feedbackDeadline <= Date.now()) {
			throw new ConvexError(
				'The feedback deadline of this season has passed. A form now would be overdue at once.'
			);
		}
		await assertNoOtherFormForAudience(ctx, args.seasonId, args.audience);

		const title = cleanTitle(args.title);
		checkQuestionCount(args.questions.length);
		const taken = new Set<string>();
		const questions = args.questions.map((question: QuestionInput, index) => ({
			id: newQuestionId(taken),
			label: cleanLabel(question.label, index + 1),
			kind: question.kind,
			required: question.required
		}));

		const now = Date.now();
		return await ctx.db.insert('forms', {
			title,
			audience: args.audience,
			seasonId: args.seasonId,
			questions,
			createdAt: now,
			updatedAt: now
		});
	}
});

// Replaces the form's title and question list. Questions keep their id; new ones (no id) get one.
export const adminUpdateForm = mutation({
	args: {
		formId: v.id('forms'),
		title: v.string(),
		questions: v.array(questionInput)
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireGlobalAdmin(ctx);
		const form = await requireForm(ctx, args.formId);
		const title = cleanTitle(args.title);
		checkQuestionCount(args.questions.length);

		const existingById = new Map(form.questions.map((question) => [question.id, question]));
		const answers = countAnswers(await listResponses(ctx, form._id));

		const seen = new Set<string>();
		for (const question of args.questions) {
			if (question.id === undefined) continue;
			if (!existingById.has(question.id)) throw new ConvexError('Unknown question');
			if (seen.has(question.id)) throw new ConvexError('A question is listed twice');
			seen.add(question.id);
		}

		for (const existing of form.questions) {
			if ((answers.get(existing.id) ?? 0) === 0) continue;
			if (!seen.has(existing.id)) {
				throw new ConvexError(
					`"${existing.label}" has answers already, so it can't be removed. Change its text instead.`
				);
			}
		}

		// Ids of removed questions stay taken, so a new question never inherits old answers.
		const taken = new Set(form.questions.map((question) => question.id));
		const questions = args.questions.map((question: QuestionInput, index) => {
			const label = cleanLabel(question.label, index + 1);
			if (question.id === undefined) {
				return {
					id: newQuestionId(taken),
					label,
					kind: question.kind,
					required: question.required
				};
			}
			const existing = existingById.get(question.id)!;
			if (existing.kind !== question.kind && (answers.get(existing.id) ?? 0) > 0) {
				throw new ConvexError(`"${existing.label}" has answers already, so its type can't change.`);
			}
			return { id: existing.id, label, kind: question.kind, required: question.required };
		});

		await ctx.db.patch(form._id, { title, questions, updatedAt: Date.now() });
		return null;
	}
});

export const adminDeleteForm = mutation({
	args: { formId: v.id('forms') },
	returns: v.null(),
	handler: async (ctx, args) => {
		await requireGlobalAdmin(ctx);
		const form = await requireForm(ctx, args.formId);
		const response = await ctx.db
			.query('formResponses')
			.withIndex('by_form_profile_club', (q) => q.eq('formId', form._id))
			.first();
		if (response) {
			throw new ConvexError('This form has answers already, so it can’t be deleted.');
		}
		await ctx.db.delete(form._id);
		return null;
	}
});
