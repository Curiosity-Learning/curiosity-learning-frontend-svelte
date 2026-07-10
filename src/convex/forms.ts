import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { internalMutation, mutation, query } from './_generated/server';
import {
	getMembershipByProfileId,
	listMembershipsForProfile,
	requireIdentity,
	requireProfile
} from './permissions';

// PRD 6.11.1/6.11.2: quarterly feedback forms + submission flow.
//
// Scope decision: feedback forms apply to Curiosity Clubs only (kind === 'curiosity'). Club of
// Clubs (CoC) groups are a distinct club-of-clubs concept (PRD 6.10) with no Guide/Learner
// feedback relationship to collect, so they're excluded from outstanding-forms computation.
//
// Admin creation UI is CL-701; enforcement/banners/blocks based on submitted scores is CL-733.
// This file is form infrastructure (schema-backed CRUD) + the user-facing submission flow only.

const questionFields = {
	id: v.string(),
	label: v.string(),
	kind: v.union(v.literal('scale_1_10'), v.literal('text'), v.literal('yes_no')),
	required: v.boolean()
};

const answerFields = {
	questionId: v.string(),
	value: v.union(v.string(), v.number(), v.boolean())
};

// Internal-only for now; CL-701 will build an admin-gated mutation/UI on top of this.
export const createForm = internalMutation({
	args: {
		title: v.string(),
		audience: v.union(v.literal('guide'), v.literal('learner')),
		seasonId: v.id('seasons'),
		questions: v.array(v.object(questionFields))
	},
	returns: v.id('forms'),
	handler: async (ctx, args) => {
		const season = await ctx.db.get(args.seasonId);
		if (!season) {
			throw new ConvexError('Season not found');
		}
		if (args.questions.length === 0) {
			throw new ConvexError('A form needs at least one question');
		}
		const ids = new Set(args.questions.map((question) => question.id));
		if (ids.size !== args.questions.length) {
			throw new ConvexError('Question ids must be unique within a form');
		}

		const now = Date.now();
		return await ctx.db.insert('forms', {
			title: args.title,
			audience: args.audience,
			seasonId: args.seasonId,
			questions: args.questions,
			createdAt: now,
			updatedAt: now
		});
	}
});

const roleKeyForAudience = (audience: 'guide' | 'learner') =>
	audience === 'guide' ? 'guide' : 'learner';

// Seasons whose feedback-collection window is currently open: the season has ended (now >=
// endDate). There's no upper bound here — CL-733 owns what happens once feedbackDeadline passes
// (e.g. blocking banners); outstanding forms keep showing until actually submitted.
const listSeasonsWithOpenCollection = async (ctx: QueryCtx, now: number) => {
	const seasons = await ctx.db.query('seasons').withIndex('by_end_date').collect();
	return seasons.filter((season) => season.endDate <= now);
};

type OutstandingForm = {
	formId: Id<'forms'>;
	clubId: Id<'clubs'>;
	clubName: string;
	audience: 'guide' | 'learner';
	title: string;
	seasonId: Id<'seasons'>;
};

// Returns one entry per (form matching my role in that club) x (each of my active Curiosity Club
// memberships), across every season whose collection window is open, minus forms I've already
// submitted for that club. A user who is Guide in club A and Learner in club B can get both a
// guide-form entry for A and a learner-form entry for B.
export const listMyOutstandingForms = query({
	args: {},
	returns: v.array(v.any()),
	handler: async (ctx): Promise<OutstandingForm[]> => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const now = Date.now();

		const openSeasons = await listSeasonsWithOpenCollection(ctx, now);
		if (openSeasons.length === 0) return [];

		const memberships = await listMembershipsForProfile(ctx, profile);
		const activeMemberships = memberships.filter((membership) => !membership.leftAt);
		if (activeMemberships.length === 0) return [];

		const clubsById = new Map<Id<'clubs'>, Doc<'clubs'>>();
		const rolesById = new Map<Id<'clubRoles'>, Doc<'clubRoles'>>();

		const results: OutstandingForm[] = [];

		for (const season of openSeasons) {
			const forms = await ctx.db
				.query('forms')
				.withIndex('by_season', (q) => q.eq('seasonId', season._id))
				.collect();
			if (forms.length === 0) continue;

			const formsByAudience = new Map<'guide' | 'learner', Doc<'forms'>[]>();
			for (const form of forms) {
				const list = formsByAudience.get(form.audience) ?? [];
				list.push(form);
				formsByAudience.set(form.audience, list);
			}

			for (const membership of activeMemberships) {
				let club = clubsById.get(membership.clubId);
				if (club === undefined) {
					const fetched = await ctx.db.get(membership.clubId);
					if (fetched) clubsById.set(membership.clubId, fetched);
					club = fetched ?? undefined;
				}
				// Curiosity Clubs only; CoC groups (kind === 'coc') are excluded.
				if (!club || club.kind === 'coc') continue;

				let role = rolesById.get(membership.roleId);
				if (!role) {
					const fetched = await ctx.db.get(membership.roleId);
					if (!fetched) continue;
					role = fetched;
					rolesById.set(membership.roleId, role);
				}

				const audience = role.key === 'guide' ? 'guide' : 'learner';
				const matchingForms = formsByAudience.get(audience) ?? [];

				for (const form of matchingForms) {
					const existing = await ctx.db
						.query('formResponses')
						.withIndex('by_form_profile_club', (q) =>
							q.eq('formId', form._id).eq('profileId', profile._id).eq('clubId', club!._id)
						)
						.unique();
					if (existing) continue;

					results.push({
						formId: form._id,
						clubId: club._id,
						clubName: club.name,
						audience: form.audience,
						title: form.title,
						seasonId: form.seasonId
					});
				}
			}
		}

		return results;
	}
});

// Gated to an eligible membership: the viewer must currently be active in `clubId` with the role
// matching the form's audience, and the form's season collection window must be open.
export const getFormForSubmission = query({
	args: {
		formId: v.id('forms'),
		clubId: v.id('clubs')
	},
	returns: v.any(),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const form = await ctx.db.get(args.formId);
		if (!form) {
			throw new ConvexError('Form not found');
		}

		const club = await ctx.db.get(args.clubId);
		if (!club || club.kind === 'coc') {
			throw new ConvexError('Club not found');
		}

		const membership = await getMembershipByProfileId(ctx, args.clubId, profile._id);
		if (!membership) {
			throw new ConvexError('Not a member of this club');
		}
		const role = await ctx.db.get(membership.roleId);
		if (!role || roleKeyForAudience(form.audience) !== role.key) {
			throw new ConvexError('This form does not apply to your role in this club');
		}

		const season = await ctx.db.get(form.seasonId);
		if (!season || season.endDate > Date.now()) {
			throw new ConvexError('This form is not open for submission yet');
		}

		const existing = await ctx.db
			.query('formResponses')
			.withIndex('by_form_profile_club', (q) =>
				q.eq('formId', form._id).eq('profileId', profile._id).eq('clubId', club._id)
			)
			.unique();
		if (existing) {
			throw new ConvexError('You have already submitted this form');
		}

		return {
			formId: form._id,
			title: form.title,
			audience: form.audience,
			clubId: club._id,
			clubName: club.name,
			questions: form.questions
		};
	}
});

const validateAnswers = (
	questions: Doc<'forms'>['questions'],
	answers: Array<{ questionId: string; value: string | number | boolean }>
) => {
	const answersByQuestionId = new Map(answers.map((answer) => [answer.questionId, answer]));

	for (const question of questions) {
		const answer = answersByQuestionId.get(question.id);
		if (!answer) {
			if (question.required) {
				throw new ConvexError(`Missing answer for required question "${question.label}"`);
			}
			continue;
		}

		if (question.kind === 'scale_1_10') {
			if (typeof answer.value !== 'number' || !Number.isInteger(answer.value)) {
				throw new ConvexError(`Answer for "${question.label}" must be a whole number`);
			}
			if (answer.value < 1 || answer.value > 10) {
				throw new ConvexError(`Answer for "${question.label}" must be between 1 and 10`);
			}
		} else if (question.kind === 'text') {
			if (typeof answer.value !== 'string') {
				throw new ConvexError(`Answer for "${question.label}" must be text`);
			}
			if (question.required && answer.value.trim().length === 0) {
				throw new ConvexError(`Missing answer for required question "${question.label}"`);
			}
		} else if (question.kind === 'yes_no') {
			if (typeof answer.value !== 'boolean') {
				throw new ConvexError(`Answer for "${question.label}" must be yes or no`);
			}
		}
	}

	// Reject answers for questions that don't exist on the form.
	const questionIds = new Set(questions.map((question) => question.id));
	for (const answer of answers) {
		if (!questionIds.has(answer.questionId)) {
			throw new ConvexError('Answer references an unknown question');
		}
	}
};

export const submitResponse = mutation({
	args: {
		formId: v.id('forms'),
		clubId: v.id('clubs'),
		answers: v.array(v.object(answerFields))
	},
	returns: v.id('formResponses'),
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const form = await ctx.db.get(args.formId);
		if (!form) {
			throw new ConvexError('Form not found');
		}

		const club = await ctx.db.get(args.clubId);
		if (!club || club.kind === 'coc') {
			throw new ConvexError('Club not found');
		}

		const membership = await getMembershipByProfileId(ctx, args.clubId, profile._id);
		if (!membership) {
			throw new ConvexError('Not a member of this club');
		}
		const role = await ctx.db.get(membership.roleId);
		if (!role || roleKeyForAudience(form.audience) !== role.key) {
			throw new ConvexError('This form does not apply to your role in this club');
		}

		const season = await ctx.db.get(form.seasonId);
		if (!season || season.endDate > Date.now()) {
			throw new ConvexError('This form is not open for submission yet');
		}

		// Duplicate-submission guard: one response per (form, profile, club).
		const existing = await ctx.db
			.query('formResponses')
			.withIndex('by_form_profile_club', (q) =>
				q.eq('formId', form._id).eq('profileId', profile._id).eq('clubId', club._id)
			)
			.unique();
		if (existing) {
			throw new ConvexError('You have already submitted this form');
		}

		validateAnswers(form.questions, args.answers);

		// Responses are immutable by design: no update/delete mutation exists for formResponses.
		return await ctx.db.insert('formResponses', {
			formId: args.formId,
			profileId: profile._id,
			clubId: args.clubId,
			answers: args.answers,
			submittedAt: Date.now()
		});
	}
});
