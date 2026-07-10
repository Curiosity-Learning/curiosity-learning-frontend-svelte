import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx, MutationCtx } from './_generated/server';
import { internalMutation, mutation, query } from './_generated/server';
import {
	getMembershipByProfileId,
	listMembershipsForProfile,
	requireIdentity,
	requireProfile
} from './permissions';
import { dispatchNotification } from './notificationsModel';

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

// Shared by `listMyOutstandingForms` and `getMyEnforcementState`: one entry per (form matching my
// role in that club) x (each of my active Curiosity Club memberships), across every season whose
// collection window is open, minus forms I've already submitted for that club. A user who is
// Guide in club A and Learner in club B can get both a guide-form entry for A and a learner-form
// entry for B.
const listOutstandingFormsForProfile = async (
	ctx: QueryCtx,
	profile: Doc<'profiles'>,
	now: number
): Promise<OutstandingForm[]> => {
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
};

export const listMyOutstandingForms = query({
	args: {},
	returns: v.array(v.any()),
	handler: async (ctx): Promise<OutstandingForm[]> => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const now = Date.now();
		return await listOutstandingFormsForProfile(ctx, profile, now);
	}
});

// ---------------------------------------------------------------------------
// PRD 6.11.3: Graduated Enforcement.
//
// Phases are keyed off the OLDEST overdue obligation across every outstanding required form
// whose season `feedbackDeadline` has passed (not per-form/per-club — one blocked deadline
// blocks the whole app, per PRD "Platform access blocked until all forms submitted"):
//   - none:       no outstanding form has a passed deadline.
//   - reminder:   days 1-7 past the oldest overdue deadline.
//   - escalation: days 8-14.
//   - blocked:    day 15+.
//
// Judgment call (documented per ticket): this is a UI-level access block, computed here as a
// pure read. It deliberately does NOT gate `requireProfile` (unlike suspension, CL-730) because
// the PRD's "platform access blocked" is about navigation/UI, and two mutations must keep
// working even while blocked: `forms.submitResponse` (clearing the block requires it) and
// `reports.submitReport` (Report Issue must stay reachable, same exception as suspension). Every
// other mutation/query is unaffected server-side; the (app) layout enforces the actual block by
// rendering a full-screen takeover for any route other than /feedback.
const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_START_DAY = 1;
const ESCALATION_START_DAY = 8;
const BLOCKED_START_DAY = 15;

export type EnforcementPhase = 'none' | 'reminder' | 'escalation' | 'blocked';

const phaseForDaysPastDeadline = (daysPast: number): EnforcementPhase => {
	if (daysPast >= BLOCKED_START_DAY) return 'blocked';
	if (daysPast >= ESCALATION_START_DAY) return 'escalation';
	if (daysPast >= REMINDER_START_DAY) return 'reminder';
	return 'none';
};

export const getMyEnforcementState = query({
	args: {},
	returns: v.any(),
	handler: async (
		ctx
	): Promise<{
		phase: EnforcementPhase;
		oldestDeadline: number | null;
		clubName: string | null;
		formId: Id<'forms'> | null;
		clubId: Id<'clubs'> | null;
	}> => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);
		const now = Date.now();

		const outstanding = await listOutstandingFormsForProfile(ctx, profile, now);
		if (outstanding.length === 0) {
			return { phase: 'none', oldestDeadline: null, clubName: null, formId: null, clubId: null };
		}

		const seasonIds = new Set(outstanding.map((item) => item.seasonId));
		const seasonsById = new Map<Id<'seasons'>, Doc<'seasons'>>();
		for (const seasonId of seasonIds) {
			const season = await ctx.db.get(seasonId);
			if (season) seasonsById.set(seasonId, season);
		}

		let oldest: (OutstandingForm & { feedbackDeadline: number }) | null = null;
		for (const item of outstanding) {
			const season = seasonsById.get(item.seasonId);
			if (!season || season.feedbackDeadline > now) continue; // deadline hasn't passed yet
			if (!oldest || season.feedbackDeadline < oldest.feedbackDeadline) {
				oldest = { ...item, feedbackDeadline: season.feedbackDeadline };
			}
		}

		if (!oldest) {
			return { phase: 'none', oldestDeadline: null, clubName: null, formId: null, clubId: null };
		}

		const daysPast = Math.floor((now - oldest.feedbackDeadline) / DAY_MS);
		return {
			phase: phaseForDaysPastDeadline(daysPast),
			oldestDeadline: oldest.feedbackDeadline,
			clubName: oldest.clubName,
			formId: oldest.formId,
			clubId: oldest.clubId
		};
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
		const responseId = await ctx.db.insert('formResponses', {
			formId: args.formId,
			profileId: profile._id,
			clubId: args.clubId,
			answers: args.answers,
			submittedAt: Date.now()
		});

		await recomputeQualityFlag(ctx, args.clubId, form.seasonId, responseId);

		return responseId;
	}
});

// ---------------------------------------------------------------------------
// PRD 6.11.4: Quality Control.
//
// Recomputes the club+season average across every scale_1_10 answer in every form response for
// that (clubId, seasonId) pair — deliberately spans both the guide and learner forms for the
// season, matching the same "pragmatic average, not per-form-weighted" approach admin.ts's
// adminClubsHealth uses for its `qualityRating` column (kept consistent rather than introducing a
// second averaging convention). One `qualityFlags` row per (clubId, seasonId): created/updated
// while avg < 7, deleted once avg >= 7 (no history kept for v1 — see schema.ts comment).
const QUALITY_FLAG_THRESHOLD = 7;

const recomputeQualityFlag = async (
	ctx: MutationCtx,
	clubId: Id<'clubs'>,
	seasonId: Id<'seasons'>,
	latestResponseId: Id<'formResponses'>
) => {
	const seasonForms = await ctx.db
		.query('forms')
		.withIndex('by_season', (q) => q.eq('seasonId', seasonId))
		.collect();
	const scaleQuestionIdsByForm = new Map<Id<'forms'>, Set<string>>();
	for (const seasonForm of seasonForms) {
		const ids = new Set(
			seasonForm.questions.filter((question) => question.kind === 'scale_1_10').map((q) => q.id)
		);
		if (ids.size > 0) scaleQuestionIdsByForm.set(seasonForm._id, ids);
	}
	if (scaleQuestionIdsByForm.size === 0) return; // No scale questions on any form this season.

	// No index covers "all responses for a club" directly (`by_form_profile_club` is keyed by
	// formId first, `by_profile` by profileId) — fall back to filtering the full table, same
	// pragmatic approach as admin.ts's clubs-health query at current data volume.
	const allResponses = await ctx.db.query('formResponses').collect();
	const responsesForClubSeason = allResponses.filter((response) => {
		if (response.clubId !== clubId) return false;
		return scaleQuestionIdsByForm.has(response.formId);
	});

	let scaleSum = 0;
	let scaleCount = 0;
	for (const response of responsesForClubSeason) {
		const scaleIds = scaleQuestionIdsByForm.get(response.formId);
		if (!scaleIds) continue;
		for (const answer of response.answers) {
			if (!scaleIds.has(answer.questionId)) continue;
			if (typeof answer.value !== 'number') continue;
			scaleSum += answer.value;
			scaleCount += 1;
		}
	}
	if (scaleCount === 0) return;

	const avgScore = scaleSum / scaleCount;

	const existingFlag = await ctx.db
		.query('qualityFlags')
		.withIndex('by_club_and_season', (q) => q.eq('clubId', clubId).eq('seasonId', seasonId))
		.unique();

	if (avgScore >= QUALITY_FLAG_THRESHOLD) {
		if (existingFlag) {
			await ctx.db.delete(existingFlag._id);
		}
		return;
	}

	if (existingFlag) {
		await ctx.db.patch(existingFlag._id, { avgScore, formResponseId: latestResponseId });
		return; // Already notified when the flag was first created; avoid renotifying every response.
	}

	await ctx.db.insert('qualityFlags', {
		clubId,
		seasonId,
		avgScore,
		formResponseId: latestResponseId,
		status: 'open',
		createdAt: Date.now()
	});

	await notifyQualityFlag(ctx, clubId, avgScore);
};

// Notifies the club's CoC group's Guides (PRD: "flag to CoC + Core Team"). Core Team visibility
// is covered by `admin.adminListQualityFlags` (admin.ts) rather than a notification, matching how
// other admin-queue items (reports, flagged media) surface today.
const notifyQualityFlag = async (ctx: MutationCtx, clubId: Id<'clubs'>, avgScore: number) => {
	const club = await ctx.db.get(clubId);
	if (!club?.cocGroupId) return;

	const cocMembers = await ctx.db
		.query('clubMembers')
		.withIndex('by_club', (q) => q.eq('clubId', club.cocGroupId!))
		.collect();

	for (const member of cocMembers) {
		if (member.leftAt) continue;
		const role = await ctx.db.get(member.roleId);
		if (role?.key !== 'guide') continue;
		await dispatchNotification(ctx, {
			recipientProfileId: member.profileId,
			kind: 'quality_flag',
			clubId,
			title: 'Quality flag raised',
			message: `${club.name}'s feedback average dropped to ${avgScore.toFixed(1)}/10.`,
			url: `/club/${clubId}`
		});
	}
};

// ---------------------------------------------------------------------------
// PRD 6.13.2: pre-deadline "feedback form due" reminders, called from the daily cron
// (crons.ts:runDailyMaintenance). Fires at 7 days before, 3 days before, and the day of each
// outstanding form's season `feedbackDeadline` — post-deadline nagging is the UI phases'
// job (getMyEnforcementState), not more notifications, per the ticket's anti-spam decision.
//
// Dedupe: a `feedbackReminders` row per (profileId, formId, clubId, stage) means each stage fires
// at most once per user/form/club even though this scans every outstanding form every day (cheap
// at current data volume, matches the `.collect()`-and-filter pattern used across admin.ts/
// forms.ts elsewhere).
// ---------------------------------------------------------------------------

const REMINDER_STAGES: Array<{ stage: '7d' | '3d' | 'day_of'; daysBefore: number }> = [
	{ stage: '7d', daysBefore: 7 },
	{ stage: '3d', daysBefore: 3 },
	{ stage: 'day_of', daysBefore: 0 }
];

// A stage fires once "now" has reached (deadline - daysBefore), i.e. the deadline is between
// `now` and `now + daysBefore` days out (with a day of slack so the once-a-day cron doesn't skip
// a stage if it fires slightly late/early relative to the exact ms boundary).
const stageIsDue = (now: number, feedbackDeadline: number, daysBefore: number) => {
	const stageFiresAt = feedbackDeadline - daysBefore * DAY_MS;
	return now >= stageFiresAt && now < stageFiresAt + DAY_MS;
};

export const sendFeedbackDeadlineReminders = internalMutation({
	args: {},
	returns: v.object({ remindersSent: v.number() }),
	handler: async (ctx) => {
		const now = Date.now();

		// Only seasons whose feedbackDeadline is still ahead (or today) are relevant — once passed,
		// enforcement phases take over instead of more notifications.
		const seasons = await ctx.db.query('seasons').withIndex('by_end_date').collect();
		const upcomingDeadlineSeasons = seasons.filter((season) => season.feedbackDeadline >= now);
		if (upcomingDeadlineSeasons.length === 0) return { remindersSent: 0 };

		let remindersSent = 0;

		for (const season of upcomingDeadlineSeasons) {
			const dueStages = REMINDER_STAGES.filter((entry) =>
				stageIsDue(now, season.feedbackDeadline, entry.daysBefore)
			);
			if (dueStages.length === 0) continue;

			const seasonForms = await ctx.db
				.query('forms')
				.withIndex('by_season', (q) => q.eq('seasonId', season._id))
				.collect();
			if (seasonForms.length === 0) continue;
			const formsByAudience = new Map<'guide' | 'learner', Doc<'forms'>[]>();
			for (const form of seasonForms) {
				const list = formsByAudience.get(form.audience) ?? [];
				list.push(form);
				formsByAudience.set(form.audience, list);
			}

			const clubMembers = await ctx.db.query('clubMembers').collect();
			const activeClubMembers = clubMembers.filter((member) => !member.leftAt);

			for (const membership of activeClubMembers) {
				const club = await ctx.db.get(membership.clubId);
				if (!club || club.kind === 'coc') continue;

				const role = await ctx.db.get(membership.roleId);
				if (!role) continue;
				const audience = role.key === 'guide' ? 'guide' : 'learner';
				const matchingForms = formsByAudience.get(audience) ?? [];
				if (matchingForms.length === 0) continue;

				for (const form of matchingForms) {
					const existingResponse = await ctx.db
						.query('formResponses')
						.withIndex('by_form_profile_club', (q) =>
							q
								.eq('formId', form._id)
								.eq('profileId', membership.profileId)
								.eq('clubId', membership.clubId)
						)
						.unique();
					if (existingResponse) continue; // Already submitted; nothing to remind about.

					for (const { stage } of dueStages) {
						const alreadySent = await ctx.db
							.query('feedbackReminders')
							.withIndex('by_profile_form_club_stage', (q) =>
								q
									.eq('profileId', membership.profileId)
									.eq('formId', form._id)
									.eq('clubId', membership.clubId)
									.eq('stage', stage)
							)
							.unique();
						if (alreadySent) continue;

						await dispatchNotification(ctx, {
							recipientProfileId: membership.profileId,
							kind: 'feedback_due',
							clubId: membership.clubId,
							title: 'Feedback due soon',
							message: `Your feedback for ${club.name} is due ${stage === 'day_of' ? 'today' : `in ${stage === '7d' ? '7' : '3'} days`}.`,
							url: '/feedback'
						});
						await ctx.db.insert('feedbackReminders', {
							profileId: membership.profileId,
							formId: form._id,
							clubId: membership.clubId,
							stage,
							sentAt: now
						});
						remindersSent += 1;
					}
				}
			}
		}

		return { remindersSent };
	}
});
