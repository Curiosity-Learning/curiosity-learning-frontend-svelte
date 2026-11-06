import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { getAuthUserEmail } from './authEmail';
import { CHILD_EMAIL_DOMAIN } from './childAccounts';
import { profileDisplayName } from './chatModel';
import { sendEmail } from './email/resend';
import { applicationReminderEmail, type ApplicationReminderAudience } from './email/templates';
import { buildUnsubscribeLinks, isEmailSuppressed } from './emailUnsubscribe';
import { getApplicationIntakeSeason } from './seasons';
import { formatSeasonDay, formatSeasonDeadline } from '../lib/domain/season-dates';

// CL-770: completion reminders for club applications that were started but never submitted
// (status 'incomplete' — in practice, the video was never uploaded).
//
// Phase 1 (this file): the "applications close soon" email for the season currently taking
// applications (seasons.getApplicationIntakeSeason), sent once per application per season. It is
// run by hand from the CLI — always as a dry run first, so Ron can check every recipient:
//
//   npx convex run applicationReminders:sendClosingSoonReminders '{"dryRun": true}' --prod
//   npx convex run applicationReminders:sendClosingSoonReminders '{"dryRun": false}' --prod
//
// Phase 2 (one hour after starting, a week before and a day before the deadline, applications
// left over from an earlier season) builds on the same recipient rules and will call this from
// the daily cron.
//
// Who gets it (Ron, 2026-11-05):
// - an adult applicant: their own address;
// - a child: the approved parent (parent wording — the child finishes by signing in with their
//   username);
// - a child whose consent is still pending: the parent the consent request went to, asking them
//   to approve; the button is that same consent link (it only ever went to this address).
// Never sent: to an address that unsubscribed (emailUnsubscribe.ts), to a suspended account, to
// someone who already has a submitted application in progress, or without an unsubscribe link.

export const APPLICATION_REMINDER_KIND = 'application_reminder' as const;

// Resend's default rate limit is 2 requests/second.
const SEND_SPACING_MS = 600;

export type ReminderSkipReason =
	| 'already_sent'
	| 'no_profile'
	| 'suspended'
	| 'has_submitted_application'
	| 'no_address'
	| 'unsubscribed'
	| 'duplicate_address';

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
	  }
	| {
			applicationId: Id<'clubApplications'>;
			applicantProfileId: Id<'profiles'>;
			applicantName: string;
			send: false;
			skipReason: ReminderSkipReason;
	  };

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
	// Child account: the approved parent; with none yet, the parent the (still pending) consent
	// request went to. (Once CL-768 lands, the child's own notification email and an unlinked
	// parent are handled through notifications.resolveEmailRecipient instead.)
	const consents = await ctx.db
		.query('parentChildConsents')
		.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', profile._id))
		.order('desc')
		.collect();
	const approved = consents.find((consent) => consent.status === 'approved');
	if (approved) return { audience: 'parent', to: approved.parentEmail };
	const pending = consents.find((consent) => consent.status === 'pending');
	return pending
		? { audience: 'parent_pending', to: pending.parentEmail, consentToken: pending.token }
		: null;
};

const SUBMITTED_STATUSES = new Set(['pending', 'interview', 'accepted']);

export const planClosingSoonReminders = internalQuery({
	args: { now: v.number() },
	returns: v.any(),
	handler: async (ctx, args) => {
		const season = await getApplicationIntakeSeason(ctx, args.now);
		if (!season) return { season: null, reminders: [] };

		const incomplete = await ctx.db
			.query('clubApplications')
			.withIndex('by_status_and_created_at', (q) => q.eq('status', 'incomplete'))
			.collect();

		const reminders: PlannedReminder[] = [];
		const addresses = new Set<string>();
		for (const application of incomplete) {
			const base = {
				applicationId: application._id,
				applicantProfileId: application.applicantProfileId
			};
			const skip = (applicantName: string, skipReason: ReminderSkipReason) =>
				reminders.push({ ...base, applicantName, send: false, skipReason });

			const profile = await ctx.db.get(application.applicantProfileId);
			if (!profile) {
				skip('(deleted profile)', 'no_profile');
				continue;
			}
			const applicantName = profileDisplayName(profile);
			if (application.reminders?.closingSoonSeasonId === season._id) {
				skip(applicantName, 'already_sent');
				continue;
			}
			if (profile.suspendedAt) {
				skip(applicantName, 'suspended');
				continue;
			}
			const otherApplications = await ctx.db
				.query('clubApplications')
				.withIndex('by_applicant_profile_id', (q) =>
					q.eq('applicantProfileId', application.applicantProfileId)
				)
				.collect();
			if (otherApplications.some((other) => SUBMITTED_STATUSES.has(other.status))) {
				skip(applicantName, 'has_submitted_application');
				continue;
			}
			const recipient = await resolveReminderRecipient(ctx, profile);
			if (!recipient) {
				skip(applicantName, 'no_address');
				continue;
			}
			const address = recipient.to.trim().toLowerCase();
			if (await isEmailSuppressed(ctx, APPLICATION_REMINDER_KIND, address)) {
				skip(applicantName, 'unsubscribed');
				continue;
			}
			if (addresses.has(address)) {
				skip(applicantName, 'duplicate_address');
				continue;
			}
			addresses.add(address);
			reminders.push({
				...base,
				applicantName,
				send: true,
				audience: recipient.audience,
				to: recipient.to,
				childName: recipient.audience === 'self' ? undefined : childDisplayName(profile),
				consentToken: recipient.consentToken
			});
		}

		return {
			season: {
				_id: season._id,
				name: season.name,
				applicationDeadline: season.applicationDeadline
			},
			reminders
		};
	}
});

// Marks the application as reminded for this season BEFORE the email goes out, so two runs can
// never both send it. Released again if the send fails.
export const claimClosingSoonReminder = internalMutation({
	args: { applicationId: v.id('clubApplications'), seasonId: v.id('seasons') },
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const application = await ctx.db.get(args.applicationId);
		if (!application || application.status !== 'incomplete') return false;
		if (application.reminders?.closingSoonSeasonId === args.seasonId) return false;
		await ctx.db.patch(args.applicationId, {
			reminders: {
				...application.reminders,
				closingSoonSeasonId: args.seasonId,
				closingSoonSentAt: Date.now()
			}
		});
		return true;
	}
});

export const releaseClosingSoonReminder = internalMutation({
	args: { applicationId: v.id('clubApplications'), seasonId: v.id('seasons') },
	returns: v.null(),
	handler: async (ctx, args) => {
		const application = await ctx.db.get(args.applicationId);
		if (application?.reminders?.closingSoonSeasonId !== args.seasonId) return null;
		await ctx.db.patch(args.applicationId, {
			reminders: {
				...application.reminders,
				closingSoonSeasonId: undefined,
				closingSoonSentAt: undefined
			}
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
		})) as {
			season: { _id: Id<'seasons'>; name: string; applicationDeadline: number } | null;
			reminders: PlannedReminder[];
		};
		if (!plan.season) {
			throw new ConvexError(
				'No season is taking applications: set an application deadline on the next season first.'
			);
		}
		const season = plan.season;
		const deadlineLabel = formatSeasonDeadline(season.applicationDeadline);
		const summary = {
			season: season.name,
			applicationsClose: deadlineLabel,
			dryRun: args.dryRun,
			toSend: plan.reminders.filter((item) => item.send).length,
			skipped: plan.reminders.filter((item) => !item.send).length
		};
		const describe = (item: PlannedReminder) =>
			item.send
				? {
						applicationId: item.applicationId,
						applicant: item.applicantName,
						audience: item.audience,
						to: item.to
					}
				: {
						applicationId: item.applicationId,
						applicant: item.applicantName,
						skipReason: item.skipReason
					};

		if (args.dryRun) {
			return { ...summary, reminders: plan.reminders.map(describe) };
		}

		const appOrigin = getAppOrigin();
		if (!appOrigin) throw new ConvexError('BETTER_AUTH_URL is not set.');
		if (!(await buildUnsubscribeLinks('application_reminder', 'check@example.com'))) {
			throw new ConvexError(
				'Unsubscribe links cannot be built (BETTER_AUTH_SECRET or EMAIL_UNSUBSCRIBE_SECRET, and CONVEX_SITE_URL, must be set).'
			);
		}

		const results: Array<Record<string, unknown>> = [];
		let first = true;
		for (const item of plan.reminders) {
			if (!item.send) {
				// "already_sent" was logged when it was sent; everything else is worth a row.
				if (item.skipReason !== 'already_sent') {
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

			const claimed = await ctx.runMutation(
				internal.applicationReminders.claimClosingSoonReminder,
				{ applicationId: item.applicationId, seasonId: season._id }
			);
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
				childName: item.childName,
				seasonName: season.name,
				deadlineLabel,
				deadlineDayLabel: formatSeasonDay(season.applicationDeadline),
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
				await ctx.runMutation(internal.applicationReminders.releaseClosingSoonReminder, {
					applicationId: item.applicationId,
					seasonId: season._id
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

		return {
			...summary,
			sent: results.filter((result) => result.status === 'sent').length,
			failed: results.filter((result) => result.status === 'failed').length,
			reminders: results
		};
	}
});

/**
 * Sends the three versions of the closing-soon reminder (applicant, approved parent, parent asked
 * to approve) to ONE address, subject prefixed "[Preview]", with sample names, so the wording can
 * be checked in a real inbox before a real run. Touches no application. The unsubscribe link is
 * real for that address — pressing it really unsubscribes it.
 *
 *   npx convex run applicationReminders:sendClosingSoonPreview '{"to": "you@example.com"}' --prod
 */
export const sendClosingSoonPreview = internalAction({
	args: { to: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		const season = (await ctx.runQuery(internal.applicationReminders.planClosingSoonReminders, {
			now: Date.now()
		})) as { season: { name: string; applicationDeadline: number } | null };
		if (!season.season) {
			throw new ConvexError(
				'No season is taking applications: set an application deadline on the next season first.'
			);
		}
		const appOrigin = getAppOrigin();
		const links = await buildUnsubscribeLinks('application_reminder', args.to);
		if (!appOrigin || !links) throw new ConvexError('Links cannot be built on this deployment.');
		const audiences: ApplicationReminderAudience[] = ['self', 'parent', 'parent_pending'];
		for (const [index, audience] of audiences.entries()) {
			if (index > 0) await new Promise((resolve) => setTimeout(resolve, SEND_SPACING_MS));
			const email = applicationReminderEmail({
				audience,
				childName: audience === 'self' ? undefined : 'Sam',
				seasonName: season.season.name,
				deadlineLabel: formatSeasonDeadline(season.season.applicationDeadline),
				deadlineDayLabel: formatSeasonDay(season.season.applicationDeadline),
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
