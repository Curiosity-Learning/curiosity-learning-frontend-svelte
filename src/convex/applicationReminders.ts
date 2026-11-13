import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx, QueryCtx } from './_generated/server';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { getAuthUserEmail } from './authEmail';
import { CHILD_EMAIL_DOMAIN } from './childAccounts';
import { profileDisplayName } from './chatModel';
import { sendEmail } from './email/resend';
import {
	applicationReminderEmail,
	type ApplicationReminderAudience,
	type ApplicationReminderVariant
} from './email/templates';
import { buildUnsubscribeLinks, isEmailSuppressed } from './emailUnsubscribe';
import { effectiveApplicationDeadline, getApplicationIntakeSeason } from './seasons';
import { formatSeasonDay, formatSeasonDeadline } from '../lib/domain/season-dates';

// CL-770: completion reminders for club applications that were started but never submitted
// (status 'incomplete' — in practice, the video was never uploaded).
//
// Phase 1: the "applications close soon" email for the season currently taking applications
// (seasons.getApplicationIntakeSeason), sent once per application per season, run by hand from
// the CLI — always as a dry run first, so Ron can check every recipient:
//
//   npx convex run applicationReminders:sendClosingSoonReminders '{"dryRun": true}' --prod
//   npx convex run applicationReminders:sendClosingSoonReminders '{"dryRun": false}' --prod
//
// Phase 2 (CL-796), automatic:
// - A, "started": one hour after an application is first saved (scheduled by
//   clubApplications.upsertIncompleteApplication). Waits one more hour, once, while a video is
//   still processing.
// - B, "week before", and C, "day before": the daily maintenance cron (crons.ts, 03:00 UTC) runs
//   sendDeadlineReminders. B goes out on the first run 7 days or less before the season's
//   EFFECTIVE deadline (CL-777: the extension if there is one), C on the run less than 24 hours
//   before it (03:00 on the closing day for a 23:55 deadline). Each at most once per application
//   per season. B is skipped (and retried the next day) while A went out less than 24 hours ago.
//   A phase 1 send for the season counts as both B and C.
// - Applications started in an earlier season's intake (CL-770 3b) get "it's not too late"
//   wording, and stop after one later season: once two deadlines have passed since an
//   application was started, it gets no more B/C (decision for Ron, "stop after N seasons").
//
//   npx convex run applicationReminders:sendDeadlineReminders '{"dryRun": true}'
//
// Who gets it (Ron, 2026-11-05):
// - an adult applicant: their own address;
// - a child: their own address once they confirmed it; else the approved parent, unless the
//   child unlinked them (parent wording — the child finishes by signing in with their username);
// - a child whose consent is still pending: the parent the consent request went to, asking them
//   to approve; the button is that same consent link (it only ever went to this address).
// Never sent: to an address that unsubscribed (emailUnsubscribe.ts, by link or by the settings
// switch), to a suspended account, to someone who already has a submitted application in
// progress, or without an unsubscribe link.

export const APPLICATION_REMINDER_KIND = 'application_reminder' as const;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Reminder A goes out this long after the application is first saved.
export const STARTED_REMINDER_DELAY_MS = HOUR;
// B is due from this long before the deadline, C from DAY_BEFORE_WINDOW_MS.
export const WEEK_BEFORE_WINDOW_MS = 7 * DAY;
export const DAY_BEFORE_WINDOW_MS = DAY;
// "Stop after N seasons" (CL-796 open question): reminders follow an unfinished application into
// at most this many later seasons.
export const MAX_LATER_SEASONS = 1;
// With no earlier season to compare with, an application this old counts as "from earlier".
const EARLIER_WITHOUT_SEASON_MS = 30 * DAY;

// Resend's default rate limit is 2 requests/second.
const SEND_SPACING_MS = 600;

export type ReminderSkipReason =
	| 'already_sent'
	| 'no_profile'
	| 'suspended'
	| 'has_submitted_application'
	| 'no_address'
	| 'unsubscribed'
	| 'duplicate_address'
	| 'not_incomplete'
	| 'recent_reminder'
	| 'too_old';

// Skips that won't change by tomorrow: the daily job records them once per season (so the log
// shows them) instead of every day.
const SETTLED_SKIP_REASONS = new Set<ReminderSkipReason>([
	'no_profile',
	'suspended',
	'has_submitted_application',
	'no_address',
	'unsubscribed',
	'duplicate_address'
]);

type ReminderSlot = 'closing_soon' | 'started' | 'week_before' | 'day_before';
const reminderSlotValidator = v.union(
	v.literal('closing_soon'),
	v.literal('started'),
	v.literal('week_before'),
	v.literal('day_before')
);

type PlannedReminder =
	| {
			applicationId: Id<'clubApplications'>;
			applicantProfileId: Id<'profiles'>;
			applicantName: string;
			send: true;
			audience: ApplicationReminderAudience;
			to: string;
			childName?: string;
			consentToken?: string;
			earlierSeason?: boolean;
	  }
	| {
			applicationId: Id<'clubApplications'>;
			applicantProfileId: Id<'profiles'>;
			applicantName: string;
			send: false;
			skipReason: ReminderSkipReason;
	  };

type PlannedSeason = { _id: Id<'seasons'>; name: string; closesAt: number; extended: boolean };

// Child accounts sign up with a username only; a first name is a bonus (Ron: "we need a backup").
const childDisplayName = (profile: Doc<'profiles'>) =>
	profile.firstName?.trim() || profile.username?.trim() || 'your child';

const resolveReminderRecipient = async (
	ctx: QueryCtx,
	profile: Doc<'profiles'>
): Promise<{ audience: ApplicationReminderAudience; to: string; consentToken?: string } | null> => {
	const authEmail = await getAuthUserEmail(ctx, profile.authUserId);
	if (!authEmail) return null;
	if (!authEmail.toLowerCase().endsWith(`@${CHILD_EMAIL_DOMAIN}`)) {
		return { audience: 'self', to: authEmail };
	}
	// Child account, following the CL-768/769 routing rules (notificationRouting.ts): the child's
	// own address once they CONFIRMED it (they can upload the video themselves); otherwise the
	// approved parent, unless the child unlinked them (rule 4: an unlinked parent hears nothing);
	// with no approved consent yet, the parent the still-pending consent request went to.
	if (profile.notificationEmail && profile.notificationEmailVerifiedAt !== undefined) {
		return { audience: 'self', to: profile.notificationEmail };
	}
	const consents = await ctx.db
		.query('parentChildConsents')
		.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', profile._id))
		.order('desc')
		.collect();
	const approved = consents.find(
		(consent) => consent.status === 'approved' && consent.unlinkedAt === undefined
	);
	if (approved) return { audience: 'parent', to: approved.parentEmail };
	if (consents.some((consent) => consent.status === 'approved')) return null;
	const pending = consents.find((consent) => consent.status === 'pending');
	return pending
		? { audience: 'parent_pending', to: pending.parentEmail, consentToken: pending.token }
		: null;
};

const SUBMITTED_STATUSES = new Set(['pending', 'interview', 'accepted']);

// The checks every reminder shares, for one incomplete application. `addresses` holds the
// addresses already planned in this run, so nobody gets two of the same reminder at once.
const planApplication = async (
	ctx: QueryCtx,
	application: Doc<'clubApplications'>,
	addresses: Set<string>,
	extra: { alreadySent?: boolean; earlierSeason?: boolean } = {}
): Promise<PlannedReminder> => {
	const base = {
		applicationId: application._id,
		applicantProfileId: application.applicantProfileId
	};
	const skip = (applicantName: string, skipReason: ReminderSkipReason): PlannedReminder => ({
		...base,
		applicantName,
		send: false,
		skipReason
	});

	const profile = await ctx.db.get(application.applicantProfileId);
	if (!profile) return skip('(deleted profile)', 'no_profile');
	const applicantName = profileDisplayName(profile);
	if (extra.alreadySent) return skip(applicantName, 'already_sent');
	if (profile.suspendedAt) return skip(applicantName, 'suspended');
	const otherApplications = await ctx.db
		.query('clubApplications')
		.withIndex('by_applicant_profile_id', (q) =>
			q.eq('applicantProfileId', application.applicantProfileId)
		)
		.collect();
	if (otherApplications.some((other) => SUBMITTED_STATUSES.has(other.status))) {
		return skip(applicantName, 'has_submitted_application');
	}
	const recipient = await resolveReminderRecipient(ctx, profile);
	if (!recipient) return skip(applicantName, 'no_address');
	const address = recipient.to.trim().toLowerCase();
	if (await isEmailSuppressed(ctx, APPLICATION_REMINDER_KIND, address)) {
		return skip(applicantName, 'unsubscribed');
	}
	if (addresses.has(address)) return skip(applicantName, 'duplicate_address');
	addresses.add(address);
	return {
		...base,
		applicantName,
		send: true,
		audience: recipient.audience,
		to: recipient.to,
		childName: recipient.audience === 'self' ? undefined : childDisplayName(profile),
		consentToken: recipient.consentToken,
		earlierSeason: extra.earlierSeason
	};
};

const toPlannedSeason = (season: Doc<'seasons'> & { closesAt: number }): PlannedSeason => ({
	_id: season._id,
	name: season.name,
	closesAt: season.closesAt,
	// CL-777: set when the deadline was extended, so the email can say so.
	extended: season.applicationDeadlineExtendedTo !== undefined
});

const listIncompleteApplications = async (ctx: QueryCtx) =>
	await ctx.db
		.query('clubApplications')
		.withIndex('by_status_and_created_at', (q) => q.eq('status', 'incomplete'))
		.collect();

// ---------------------------------------------------------------------------------------------
// Phase 1: the hand-run "applications close soon" send.
// ---------------------------------------------------------------------------------------------

export const planClosingSoonReminders = internalQuery({
	args: { now: v.number() },
	returns: v.any(),
	handler: async (ctx, args) => {
		const season = await getApplicationIntakeSeason(ctx, args.now);
		if (!season) return { season: null, reminders: [] };

		const reminders: PlannedReminder[] = [];
		const addresses = new Set<string>();
		for (const application of await listIncompleteApplications(ctx)) {
			reminders.push(
				await planApplication(ctx, application, addresses, {
					alreadySent: application.reminders?.closingSoonSeasonId === season._id
				})
			);
		}
		return { season: toPlannedSeason(season), reminders };
	}
});

// ---------------------------------------------------------------------------------------------
// Phase 2 (CL-796): reminders B and C, from the daily cron.
// ---------------------------------------------------------------------------------------------

/** Which deadline reminder is due `closesAt - now` before the deadline, if any. */
export const dueDeadlineReminder = (
	closesAt: number,
	now: number
): 'week_before' | 'day_before' | null => {
	const left = closesAt - now;
	if (left <= 0) return null;
	if (left <= DAY_BEFORE_WINDOW_MS) return 'day_before';
	if (left <= WEEK_BEFORE_WINDOW_MS) return 'week_before';
	return null;
};

export const planDeadlineReminders = internalQuery({
	args: { now: v.number() },
	returns: v.any(),
	handler: async (ctx, args) => {
		const now = args.now;
		const intake = await getApplicationIntakeSeason(ctx, now);
		const due = intake ? dueDeadlineReminder(intake.closesAt, now) : null;
		if (!intake || !due) {
			return { season: intake ? toPlannedSeason(intake) : null, due: null, reminders: [] };
		}

		// Every deadline that has already passed, to tell how many seasons an application has been
		// left unfinished for.
		const passedDeadlines = (await ctx.db.query('seasons').collect())
			.map((season) => effectiveApplicationDeadline(season))
			.filter((deadline): deadline is number => deadline !== undefined && deadline <= now);

		const reminders: PlannedReminder[] = [];
		const addresses = new Set<string>();
		for (const application of await listIncompleteApplications(ctx)) {
			const sent = application.reminders;
			const alreadySent =
				sent?.closingSoonSeasonId === intake._id ||
				sent?.dayBeforeSeasonId === intake._id ||
				(due === 'week_before' && sent?.weekBeforeSeasonId === intake._id);
			const seasonsMissed = passedDeadlines.filter(
				(deadline) => deadline > application.createdAt
			).length;
			const earlierSeason =
				seasonsMissed > 0 ||
				(passedDeadlines.length === 0 && application.createdAt < now - EARLIER_WITHOUT_SEASON_MS);

			if (!alreadySent && seasonsMissed > MAX_LATER_SEASONS) {
				const profile = await ctx.db.get(application.applicantProfileId);
				reminders.push({
					applicationId: application._id,
					applicantProfileId: application.applicantProfileId,
					applicantName: profile ? profileDisplayName(profile) : '(deleted profile)',
					send: false,
					skipReason: 'too_old'
				});
				continue;
			}
			if (
				!alreadySent &&
				due === 'week_before' &&
				sent?.startedSentAt !== undefined &&
				sent.startedSentAt > now - DAY
			) {
				const profile = await ctx.db.get(application.applicantProfileId);
				reminders.push({
					applicationId: application._id,
					applicantProfileId: application.applicantProfileId,
					applicantName: profile ? profileDisplayName(profile) : '(deleted profile)',
					send: false,
					skipReason: 'recent_reminder'
				});
				continue;
			}
			reminders.push(
				await planApplication(ctx, application, addresses, { alreadySent, earlierSeason })
			);
		}
		return { season: toPlannedSeason(intake), due, reminders };
	}
});

// ---------------------------------------------------------------------------------------------
// Phase 2 (CL-796): reminder A, one hour after starting.
// ---------------------------------------------------------------------------------------------

export const planStartedReminder = internalQuery({
	args: {
		applicationId: v.id('clubApplications'),
		now: v.number(),
		// The second attempt sends even while a video is still processing.
		checkProcessingVideo: v.boolean()
	},
	returns: v.any(),
	handler: async (ctx, args) => {
		const application = await ctx.db.get(args.applicationId);
		if (!application || application.status !== 'incomplete') {
			return { wait: false, season: null, reminder: null };
		}
		const profile = await ctx.db.get(application.applicantProfileId);
		// A video still being processed: the applicant is probably about to submit.
		if (profile && args.checkProcessingVideo) {
			const processing = await ctx.db
				.query('mediaAssets')
				.withIndex('by_owner_and_status', (q) =>
					q.eq('ownerUserId', profile.authUserId).eq('status', 'processing')
				)
				.collect();
			if (processing.some((asset) => asset.mediaKind === 'video')) {
				return { wait: true, season: null, reminder: null };
			}
		}
		const season = await getApplicationIntakeSeason(ctx, args.now);
		return {
			wait: false,
			season: season ? toPlannedSeason(season) : null,
			reminder: await planApplication(ctx, application, new Set(), {
				alreadySent: application.reminders?.startedSentAt !== undefined
			})
		};
	}
});

// ---------------------------------------------------------------------------------------------
// Bookkeeping shared by every reminder.
// ---------------------------------------------------------------------------------------------

// Marks the reminder as handled on the application BEFORE the email goes out, so two runs can
// never both send it; released again if the send fails. With `skipped`, it only records that this
// season's reminder was considered and deliberately not sent (the daily job then logs it once).
// Returns false when it was already handled, or the application is no longer unfinished.
export const claimReminder = internalMutation({
	args: {
		applicationId: v.id('clubApplications'),
		slot: reminderSlotValidator,
		seasonId: v.optional(v.id('seasons')),
		skipped: v.optional(v.boolean())
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const application = await ctx.db.get(args.applicationId);
		if (!application || application.status !== 'incomplete') return false;
		const reminders = application.reminders ?? {};
		const now = Date.now();
		const sentAt = args.skipped ? undefined : now;
		if (args.slot === 'started') {
			if (reminders.startedSentAt !== undefined) return false;
			if (!args.skipped) {
				await ctx.db.patch(args.applicationId, {
					reminders: { ...reminders, startedSentAt: now }
				});
			}
			return true;
		}
		if (!args.seasonId) throw new ConvexError('seasonId is required for this reminder');
		const seasonKey = SEASON_FIELDS[args.slot];
		if (reminders[seasonKey.season] === args.seasonId) return false;
		await ctx.db.patch(args.applicationId, {
			reminders: { ...reminders, [seasonKey.season]: args.seasonId, [seasonKey.sentAt]: sentAt }
		});
		return true;
	}
});

const SEASON_FIELDS = {
	closing_soon: { season: 'closingSoonSeasonId', sentAt: 'closingSoonSentAt' },
	week_before: { season: 'weekBeforeSeasonId', sentAt: 'weekBeforeSentAt' },
	day_before: { season: 'dayBeforeSeasonId', sentAt: 'dayBeforeSentAt' }
} as const;

export const releaseReminder = internalMutation({
	args: {
		applicationId: v.id('clubApplications'),
		slot: reminderSlotValidator,
		seasonId: v.optional(v.id('seasons'))
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const application = await ctx.db.get(args.applicationId);
		const reminders = application?.reminders;
		if (!application || !reminders) return null;
		if (args.slot === 'started') {
			await ctx.db.patch(args.applicationId, {
				reminders: { ...reminders, startedSentAt: undefined }
			});
			return null;
		}
		const seasonKey = SEASON_FIELDS[args.slot];
		if (reminders[seasonKey.season] !== args.seasonId) return null;
		await ctx.db.patch(args.applicationId, {
			reminders: { ...reminders, [seasonKey.season]: undefined, [seasonKey.sentAt]: undefined }
		});
		return null;
	}
});

export const recordReminderDelivery = internalMutation({
	args: {
		recipientProfileId: v.id('profiles'),
		to: v.string(),
		subject: v.string(),
		status: v.union(v.literal('sent'), v.literal('failed'), v.literal('skipped')),
		skipReason: v.optional(v.string()),
		error: v.optional(v.string()),
		providerMessageId: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.insert('emailDeliveries', {
			...args,
			kind: APPLICATION_REMINDER_KIND,
			createdAt: Date.now()
		});
		return null;
	}
});

const getAppOrigin = () => {
	const baseUrl = process.env.BETTER_AUTH_URL?.trim();
	return baseUrl ? new URL(baseUrl).origin : null;
};

const assertCanSend = async () => {
	const appOrigin = getAppOrigin();
	if (!appOrigin) throw new ConvexError('BETTER_AUTH_URL is not set.');
	if (!(await buildUnsubscribeLinks('application_reminder', 'check@example.com'))) {
		throw new ConvexError(
			'Unsubscribe links cannot be built (BETTER_AUTH_SECRET or EMAIL_UNSUBSCRIBE_SECRET, and CONVEX_SITE_URL, must be set).'
		);
	}
	return appOrigin;
};

const describe = (item: PlannedReminder) =>
	item.send
		? {
				applicationId: item.applicationId,
				applicant: item.applicantName,
				audience: item.audience,
				to: item.to,
				...(item.earlierSeason ? { earlierSeason: true } : {})
			}
		: {
				applicationId: item.applicationId,
				applicant: item.applicantName,
				skipReason: item.skipReason
			};

const VARIANT_BY_SLOT: Record<ReminderSlot, ApplicationReminderVariant> = {
	closing_soon: 'closing_soon',
	started: 'started',
	week_before: 'week_before',
	day_before: 'day_before'
};

// Sends the planned reminders of one slot: claim, send, log; release when the send fails so the
// next run retries. Skips are logged too: every one except "already sent" for the hand-run
// send; for the daily job only the settled ones, once per application and season.
const deliverReminders = async (
	ctx: ActionCtx,
	args: {
		slot: ReminderSlot;
		season: PlannedSeason | null;
		items: PlannedReminder[];
		appOrigin: string;
	}
) => {
	const { slot, season, appOrigin } = args;
	const seasonId = season?._id;
	const results: Array<Record<string, unknown>> = [];
	let first = true;
	for (const item of args.items) {
		if (!item.send) {
			let log = false;
			if (slot === 'closing_soon') {
				log = item.skipReason !== 'already_sent';
			} else if (SETTLED_SKIP_REASONS.has(item.skipReason)) {
				log = await ctx.runMutation(internal.applicationReminders.claimReminder, {
					applicationId: item.applicationId,
					slot,
					seasonId,
					skipped: true
				});
			}
			if (log) {
				await ctx.runMutation(internal.applicationReminders.recordReminderDelivery, {
					recipientProfileId: item.applicantProfileId,
					to: '',
					subject: '',
					status: 'skipped',
					skipReason: item.skipReason
				});
			}
			results.push(describe(item));
			continue;
		}

		const claimed = await ctx.runMutation(internal.applicationReminders.claimReminder, {
			applicationId: item.applicationId,
			slot,
			seasonId
		});
		if (!claimed) {
			results.push({ ...describe(item), status: 'skipped', skipReason: 'already_sent' });
			continue;
		}

		const links = await buildUnsubscribeLinks('application_reminder', item.to);
		const ctaUrl =
			item.audience === 'parent_pending' && item.consentToken
				? `${appOrigin}/onboarding/parent-consent/${item.consentToken}`
				: `${appOrigin}/new-club/start?step=2`;
		const email = applicationReminderEmail({
			audience: item.audience,
			variant: VARIANT_BY_SLOT[slot],
			earlierSeason: item.earlierSeason,
			childName: item.childName,
			seasonName: season?.name,
			deadlineLabel: season ? formatSeasonDeadline(season.closesAt) : undefined,
			deadlineDayLabel: season ? formatSeasonDay(season.closesAt) : undefined,
			extended: season?.extended,
			ctaUrl,
			unsubscribeUrl: links!.pageUrl
		});

		if (!first) await new Promise((resolve) => setTimeout(resolve, SEND_SPACING_MS));
		first = false;
		try {
			const { providerMessageId } = await sendEmail({
				to: item.to,
				type: 'application-reminder',
				headers: links!.headers,
				...email
			});
			await ctx.runMutation(internal.applicationReminders.recordReminderDelivery, {
				recipientProfileId: item.applicantProfileId,
				to: item.to,
				subject: email.subject,
				status: 'sent',
				providerMessageId: providerMessageId ?? undefined
			});
			results.push({ ...describe(item), status: 'sent' });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await ctx.runMutation(internal.applicationReminders.releaseReminder, {
				applicationId: item.applicationId,
				slot,
				seasonId
			});
			await ctx.runMutation(internal.applicationReminders.recordReminderDelivery, {
				recipientProfileId: item.applicantProfileId,
				to: item.to,
				subject: email.subject,
				status: 'failed',
				error: message
			});
			results.push({ ...describe(item), status: 'failed', error: message });
		}
	}
	return results;
};

const countResults = (results: Array<Record<string, unknown>>) => ({
	sent: results.filter((result) => result.status === 'sent').length,
	failed: results.filter((result) => result.status === 'failed').length
});

/**
 * Sends (or, with dryRun, only lists) the "applications close soon" reminder for the season
 * currently taking applications. Returns every application it considered, what it would do / did
 * and why. A real run refuses to start when the links an email needs cannot be built.
 */
export const sendClosingSoonReminders = internalAction({
	args: { dryRun: v.boolean() },
	returns: v.any(),
	handler: async (ctx, args) => {
		const plan = (await ctx.runQuery(internal.applicationReminders.planClosingSoonReminders, {
			now: Date.now()
		})) as { season: PlannedSeason | null; reminders: PlannedReminder[] };
		if (!plan.season) {
			throw new ConvexError(
				'No season is taking applications: set an application deadline on the next season first.'
			);
		}
		const summary = {
			season: plan.season.name,
			applicationsClose: formatSeasonDeadline(plan.season.closesAt),
			dryRun: args.dryRun,
			toSend: plan.reminders.filter((item) => item.send).length,
			skipped: plan.reminders.filter((item) => !item.send).length
		};
		if (args.dryRun) {
			return { ...summary, reminders: plan.reminders.map(describe) };
		}
		const appOrigin = await assertCanSend();
		const results = await deliverReminders(ctx, {
			slot: 'closing_soon',
			season: plan.season,
			items: plan.reminders,
			appOrigin
		});
		return { ...summary, ...countResults(results), reminders: results };
	}
});

/**
 * CL-796 reminders B and C, run by the daily maintenance cron (crons.ts). Sends whichever is due
 * for the season taking applications, or nothing. With dryRun, only lists what it would do.
 *
 *   npx convex run applicationReminders:sendDeadlineReminders '{"dryRun": true}'
 */
export const sendDeadlineReminders = internalAction({
	args: { dryRun: v.optional(v.boolean()) },
	returns: v.any(),
	handler: async (ctx, args) => {
		const plan = (await ctx.runQuery(internal.applicationReminders.planDeadlineReminders, {
			now: Date.now()
		})) as {
			season: PlannedSeason | null;
			due: 'week_before' | 'day_before' | null;
			reminders: PlannedReminder[];
		};
		const summary = {
			season: plan.season?.name ?? null,
			applicationsClose: plan.season ? formatSeasonDeadline(plan.season.closesAt) : null,
			due: plan.due,
			dryRun: args.dryRun ?? false,
			toSend: plan.reminders.filter((item) => item.send).length,
			skipped: plan.reminders.filter((item) => !item.send).length
		};
		if (!plan.due || !plan.season) return { ...summary, reminders: [] };
		if (args.dryRun) return { ...summary, reminders: plan.reminders.map(describe) };
		const appOrigin = await assertCanSend();
		const results = await deliverReminders(ctx, {
			slot: plan.due,
			season: plan.season,
			items: plan.reminders,
			appOrigin
		});
		return { ...summary, ...countResults(results), reminders: results };
	}
});

/**
 * CL-796 reminder A, scheduled one hour after an application is first saved
 * (clubApplications.upsertIncompleteApplication). Sends nothing when the application was
 * submitted or deleted meanwhile; waits one more hour, once, while a video is processing.
 */
export const sendStartedReminder = internalAction({
	args: { applicationId: v.id('clubApplications'), attempt: v.optional(v.number()) },
	returns: v.any(),
	handler: async (ctx, args) => {
		const attempt = args.attempt ?? 1;
		const plan = (await ctx.runQuery(internal.applicationReminders.planStartedReminder, {
			applicationId: args.applicationId,
			now: Date.now(),
			checkProcessingVideo: attempt === 1
		})) as { wait: boolean; season: PlannedSeason | null; reminder: PlannedReminder | null };
		if (plan.wait) {
			await ctx.scheduler.runAfter(
				STARTED_REMINDER_DELAY_MS,
				internal.applicationReminders.sendStartedReminder,
				{ applicationId: args.applicationId, attempt: 2 }
			);
			return { status: 'waiting_for_video' };
		}
		if (!plan.reminder) return { status: 'skipped', skipReason: 'not_incomplete' };
		const appOrigin = getAppOrigin();
		if (!appOrigin || !(await buildUnsubscribeLinks('application_reminder', 'check@example.com'))) {
			console.warn('applicationReminders:sendStartedReminder: links cannot be built; not sent');
			return { status: 'skipped', skipReason: 'no_links' };
		}
		const [result] = await deliverReminders(ctx, {
			slot: 'started',
			season: plan.season,
			items: [plan.reminder],
			appOrigin
		});
		return result;
	}
});

/**
 * Sends every version of the reminder (applicant, approved parent, parent asked to approve; and
 * with `variant`, the started / week-before / day-before / earlier-season wording) to ONE
 * address, subject prefixed "[Preview]", with sample names, so the wording can be checked in a
 * real inbox. Touches no application. The unsubscribe link is real for that address — pressing it
 * really unsubscribes it.
 *
 *   npx convex run applicationReminders:sendClosingSoonPreview '{"to": "you@example.com"}' --prod
 *   npx convex run applicationReminders:sendClosingSoonPreview \
 *     '{"to": "you@example.com", "variant": "day_before", "earlierSeason": true}'
 */
export const sendClosingSoonPreview = internalAction({
	args: {
		to: v.string(),
		variant: v.optional(
			v.union(
				v.literal('closing_soon'),
				v.literal('started'),
				v.literal('week_before'),
				v.literal('day_before')
			)
		),
		earlierSeason: v.optional(v.boolean())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const plan = (await ctx.runQuery(internal.applicationReminders.planClosingSoonReminders, {
			now: Date.now()
		})) as { season: PlannedSeason | null };
		if (!plan.season && args.variant !== 'started') {
			throw new ConvexError(
				'No season is taking applications: set an application deadline on the next season first.'
			);
		}
		const season = plan.season;
		const appOrigin = getAppOrigin();
		const links = await buildUnsubscribeLinks('application_reminder', args.to);
		if (!appOrigin || !links) throw new ConvexError('Links cannot be built on this deployment.');
		const audiences: ApplicationReminderAudience[] = ['self', 'parent', 'parent_pending'];
		for (const [index, audience] of audiences.entries()) {
			if (index > 0) await new Promise((resolve) => setTimeout(resolve, SEND_SPACING_MS));
			const email = applicationReminderEmail({
				audience,
				variant: args.variant,
				earlierSeason: args.earlierSeason,
				childName: audience === 'self' ? undefined : 'Sam',
				seasonName: season?.name,
				deadlineLabel: season ? formatSeasonDeadline(season.closesAt) : undefined,
				deadlineDayLabel: season ? formatSeasonDay(season.closesAt) : undefined,
				extended: season?.extended,
				ctaUrl:
					audience === 'parent_pending'
						? `${appOrigin}/onboarding/parent-consent/preview`
						: `${appOrigin}/new-club/start?step=2`,
				unsubscribeUrl: links.pageUrl
			});
			await sendEmail({
				to: args.to,
				type: 'application-reminder',
				headers: links.headers,
				...email,
				subject: `[Preview] ${email.subject}`
			});
		}
		return null;
	}
});
