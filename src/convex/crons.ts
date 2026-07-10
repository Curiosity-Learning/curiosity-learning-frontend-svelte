import { cronJobs } from 'convex/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import { reportConvexError } from './monitoring';

// ------------------------------------------------------------------------------------------
// Scheduled jobs & automation foundation (CL-700)
//
// Timezone note: cron schedules below run in UTC (Convex crons have no timezone concept). Any
// future daily/recurring job whose correctness depends on a club's local day boundary (e.g.
// "send this the morning of the session, club-local time") must NOT rely on the cron's fire
// time for that purpose — instead, compute the relevant per-club moment from the absolute UTC
// ms timestamps already stored on the record (see `sessions.startTime`/`endTime`, which resolve
// club-timezone concerns once at creation time, per the one-shot `ctx.scheduler.runAt` jobs in
// sessions.ts) and gate the job's work off that, the same way `sendAttendanceReminderIfUnmarked`
// / `sendSessionReminder` do for one-shot per-session jobs. A daily cron is only appropriate for
// batch/maintenance work where "once per UTC day" is an acceptable granularity (like the purge
// below); it is not a substitute for per-club scheduling.
//
// Observability: every handler below wraps its body in try/catch -> reportConvexError, so
// failures are never silent. To check on cron health:
//   - Convex dashboard -> Logs (filter to the function name, e.g. "crons.ts:runDailyMaintenance"
//     or "childSignup:purgeExpiredChildConsents") shows every invocation, its console output
//     (the summary object is logged), and any thrown error.
//   - Google Chat: reportConvexError posts to the configured space whenever MONITORING_REPORT_
//     SECRET and BETTER_AUTH_URL are set (see monitoring.ts) — this is the "look here first"
//     channel for prod failures without opening the dashboard.
// ------------------------------------------------------------------------------------------

// Quiet hour: 03:00 UTC, chosen to avoid overlapping typical peak usage windows in the app's
// primary markets and to run well clear of midnight-boundary batch jobs elsewhere.
const DAILY_MAINTENANCE_HOUR_UTC = 3;

// Single daily entry point that fans out to each maintenance job. Adding a new daily job means
// adding one more try/catch block here (or, for a job that needs its own schedule/frequency,
// registering an additional `crons.daily`/`crons.interval` call below) — no other wiring needed.
export const runDailyMaintenance = internalAction({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		try {
			const summary = await ctx.runAction(internal.childSignup.purgeExpiredChildConsents, {});
			console.log('cron:runDailyMaintenance:purgeExpiredChildConsents', summary);
		} catch (error) {
			await reportConvexError(error, {
				area: 'backend',
				operation: 'crons:runDailyMaintenance:purgeExpiredChildConsents'
			});
		}

		try {
			// CL-733 / PRD 6.13.2: 7 days / 3 days / day-of feedback deadline reminders.
			const summary = await ctx.runMutation(internal.forms.sendFeedbackDeadlineReminders, {});
			console.log('cron:runDailyMaintenance:sendFeedbackDeadlineReminders', summary);
		} catch (error) {
			await reportConvexError(error, {
				area: 'backend',
				operation: 'crons:runDailyMaintenance:sendFeedbackDeadlineReminders'
			});
		}

		return null;
	}
});

const crons = cronJobs();

crons.daily(
	'daily maintenance (under-16 consent purge, etc.)',
	{ hourUTC: DAILY_MAINTENANCE_HOUR_UTC, minuteUTC: 0 },
	internal.crons.runDailyMaintenance,
	{}
);

export default crons;
