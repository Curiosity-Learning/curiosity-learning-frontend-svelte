import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { getClubRoleByKey, requireGlobalAdmin, requireProfile } from './permissions';
import { ensureClubApplicationRoom, profileDisplayName } from './chatModel';
import { dispatchNotification } from './notificationsModel';
import { createClubFromApplication, resolveApplicationVideoUrl } from './clubApplications';
import { getAuthUserEmail } from './authEmail';

// ---------------------------------------------------------------------------
// CL-732: Admin Operations Dashboard (PRD 6.14.1-6.14.3).
//
// Shared helpers + three new admin-gated queries: getDashboardOverview (6 headline cards),
// adminClubsHealth (per-club table), adminApplicationsPipeline (pipeline counts + in-flight
// list). Everything here is read-only and deliberately reuses `.collect()`-and-filter over small
// admin tables, matching the existing `moderation.searchClubs` precedent — this is fine at
// current data volume; if tables grow large this should move to indexed scans.
//
// (CL-693's original `getOverviewCounts` stub — the template every admin query/mutation here
// still follows: requireGlobalAdmin first, no route-gating-only reliance — was superseded by
// `getDashboardOverview` below once CL-732 shipped the real dashboard, and has been removed; the
// admin UI's Overview page has called `getDashboardOverview` since.)
// ---------------------------------------------------------------------------

const isActiveCuriosityClub = (club: Doc<'clubs'>) =>
	club.kind === 'curiosity' && !club.abandonedAt;

// Distinct profiles holding an active (non-left) membership with the given role, across the
// given set of clubs.
const countDistinctActiveMembersByRole = (
	members: Doc<'clubMembers'>[],
	clubIds: Set<Id<'clubs'>>,
	roleId: Id<'clubRoles'>
) => {
	const distinct = new Set<Id<'profiles'>>();
	for (const member of members) {
		if (member.leftAt) continue;
		if (!clubIds.has(member.clubId)) continue;
		if (member.roleId !== roleId) continue;
		distinct.add(member.profileId);
	}
	return distinct.size;
};

// ---------------------------------------------------------------------------
// 1. Overview cards.
// ---------------------------------------------------------------------------

export const getDashboardOverview = query({
	args: {},
	handler: async (ctx) => {
		await requireGlobalAdmin(ctx);

		const [
			clubs,
			clubMembers,
			guideRole,
			learnerRole,
			applications,
			openReports,
			flaggedMedia,
			seasons,
			forms,
			formResponses
		] = await Promise.all([
			ctx.db.query('clubs').collect(),
			ctx.db.query('clubMembers').collect(),
			getClubRoleByKey(ctx, 'guide'),
			getClubRoleByKey(ctx, 'learner'),
			ctx.db.query('clubApplications').collect(),
			ctx.db
				.query('reports')
				.withIndex('by_status_and_created', (q) => q.eq('status', 'open'))
				.collect(),
			ctx.db
				.query('mediaAssets')
				.withIndex('by_moderation_status', (q) => q.eq('moderation.status', 'flagged'))
				.collect(),
			ctx.db.query('seasons').collect(),
			ctx.db.query('forms').collect(),
			ctx.db.query('formResponses').collect()
		]);

		const activeCuriosityClubs = clubs.filter(isActiveCuriosityClub);
		const activeCuriosityClubIds = new Set(activeCuriosityClubs.map((club) => club._id));

		const activeGuideCount = guideRole
			? countDistinctActiveMembersByRole(clubMembers, activeCuriosityClubIds, guideRole._id)
			: 0;
		const activeLearnerCount = learnerRole
			? countDistinctActiveMembersByRole(clubMembers, activeCuriosityClubIds, learnerRole._id)
			: 0;

		// "In-flight" = still somewhere in the pipeline, per PRD (pending/interview). CL-710 CEO
		// review: acceptance is now terminal (the interview IS the onboarding call and the club is
		// created immediately), so `accepted` no longer counts as pending/in-flight.
		const pendingApplicationCount = applications.filter((application) =>
			['pending', 'interview'].includes(application.status)
		).length;

		// Reuses the same "open" definition as moderation.listQueue: open reports + flagged media
		// not yet reviewed by an admin.
		const openFlaggedMediaCount = flaggedMedia.filter(
			(asset) => !asset.moderationReviewedAt
		).length;
		const openSafeguardingAlertCount = openReports.length + openFlaggedMediaCount;

		// Feedback completion: for seasons whose collection window is currently open, responses
		// submitted vs. expected (= active memberships in curiosity clubs matching the form's
		// audience). Simple percentage across all such seasons/forms combined.
		const now = Date.now();
		const openSeasonIds = new Set(
			seasons
				.filter((season) => season.reviewWindowOpen <= now && now <= season.feedbackDeadline)
				.map((season) => season._id)
		);
		const openForms = forms.filter((form) => openSeasonIds.has(form.seasonId));

		let expectedResponses = 0;
		let submittedResponses = 0;
		for (const form of openForms) {
			const roleId = form.audience === 'guide' ? guideRole?._id : learnerRole?._id;
			expectedResponses += roleId
				? countDistinctActiveMembersByRole(clubMembers, activeCuriosityClubIds, roleId)
				: 0;
			submittedResponses += formResponses.filter((response) => response.formId === form._id).length;
		}
		const feedbackCompletionPercent =
			expectedResponses > 0 ? Math.round((submittedResponses / expectedResponses) * 100) : null;

		return {
			activeClubCount: activeCuriosityClubs.length,
			activeGuideCount,
			activeLearnerCount,
			pendingApplicationCount,
			openSafeguardingAlertCount,
			feedbackCompletionPercent
		};
	}
});

// ---------------------------------------------------------------------------
// 2. Clubs health table.
// ---------------------------------------------------------------------------

export type ClubHealthFlag = 'abandoned' | 'no_sessions_yet' | 'low_quality' | 'inactive';

export type ClubHealthRow = {
	clubId: Id<'clubs'>;
	name: string;
	location: string | null;
	cocGroupId: Id<'clubs'> | null;
	cocGroupName: string | null;
	guideCount: number;
	learnerCount: number;
	sessionsRun: number;
	attendanceRate: number | null;
	activeProjectCount: number;
	lastActivityAt: number | null;
	qualityRating: number | null;
	status: 'active' | 'abandoned';
	flags: ClubHealthFlag[];
};

const INACTIVITY_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;
const LOW_QUALITY_THRESHOLD = 7;

export const adminClubsHealth = query({
	args: {},
	handler: async (ctx): Promise<ClubHealthRow[]> => {
		await requireGlobalAdmin(ctx);

		const [
			clubs,
			clubMembers,
			guideRole,
			learnerRole,
			sessions,
			attendances,
			projectAttributions,
			projects,
			forms,
			formResponses
		] = await Promise.all([
			ctx.db.query('clubs').collect(),
			ctx.db.query('clubMembers').collect(),
			getClubRoleByKey(ctx, 'guide'),
			getClubRoleByKey(ctx, 'learner'),
			ctx.db.query('sessions').collect(),
			ctx.db.query('attendances').collect(),
			ctx.db.query('projectAttributions').collect(),
			ctx.db.query('projects').collect(),
			ctx.db.query('forms').collect(),
			ctx.db.query('formResponses').collect()
		]);

		const curiosityClubs = clubs.filter((club) => club.kind === 'curiosity');
		const clubsById = new Map(clubs.map((club) => [club._id, club]));
		const projectsById = new Map(projects.map((project) => [project._id, project]));
		const now = Date.now();

		// Scale-1-10 questions per form, used for the "quality rating" pragmatic average below.
		const scaleQuestionIdsByForm = new Map<Id<'forms'>, Set<string>>();
		for (const form of forms) {
			const ids = new Set(form.questions.filter((q) => q.kind === 'scale_1_10').map((q) => q.id));
			if (ids.size > 0) scaleQuestionIdsByForm.set(form._id, ids);
		}

		const rows: ClubHealthRow[] = curiosityClubs.map((club) => {
			const activeMembers = clubMembers.filter(
				(member) => member.clubId === club._id && !member.leftAt
			);
			const guideCount = guideRole
				? activeMembers.filter((m) => m.roleId === guideRole._id).length
				: 0;
			const learnerCount = learnerRole
				? activeMembers.filter((m) => m.roleId === learnerRole._id).length
				: 0;
			const activeMemberProfileIds = new Set(activeMembers.map((m) => m.profileId));

			const clubSessions = sessions.filter((session) => session.clubId === club._id);
			const pastNonCancelledSessions = clubSessions.filter(
				(session) => !session.cancelled && session.startTime <= now
			);
			const sessionsRun = pastNonCancelledSessions.length;

			// Attendance rate: present / (present + absent) across attendance rows recorded for
			// this club's past, non-cancelled sessions. Null when nothing has been recorded yet.
			const pastSessionIds = new Set(pastNonCancelledSessions.map((s) => s._id));
			let present = 0;
			let absent = 0;
			for (const attendance of attendances) {
				if (!pastSessionIds.has(attendance.sessionId)) continue;
				if (attendance.status === 'present') present += 1;
				else if (attendance.status === 'absent') absent += 1;
			}
			const attendanceRate = present + absent > 0 ? present / (present + absent) : null;

			// Active projects "attributed to this club": projects with a projectAttributions row
			// for this club AND at least one active (still-a-member) attributed profile, not
			// archived/taken down. Simplification: attribution rows aren't cleaned up per-member
			// leave beyond the "last person out" rule noted in schema.ts, so this re-checks
			// membership here rather than trusting attribution rows alone.
			const clubAttributions = projectAttributions.filter((a) => a.clubId === club._id);
			const activeProjectIds = new Set<Id<'projects'>>();
			for (const attribution of clubAttributions) {
				const project = projectsById.get(attribution.projectId);
				if (!project || project.archivedAt || project.takedown) continue;
				if (!activeMemberProfileIds.has(attribution.profileId)) continue;
				activeProjectIds.add(attribution.projectId);
			}
			const activeProjectCount = activeProjectIds.size;

			// Last activity: latest of (last session start, last update in attributed projects).
			// Simplification per PRD note: "last update in attributed projects" is approximated by
			// each project's own `updatedAt` rather than walking the updates feed — cheap and good
			// enough for a dashboard staleness signal.
			let lastActivityAt: number | null = null;
			for (const session of clubSessions) {
				if (lastActivityAt === null || session.startTime > lastActivityAt) {
					lastActivityAt = session.startTime;
				}
			}
			for (const projectId of activeProjectIds) {
				const project = projectsById.get(projectId);
				if (!project) continue;
				if (lastActivityAt === null || project.updatedAt > lastActivityAt) {
					lastActivityAt = project.updatedAt;
				}
			}

			// Quality rating: pragmatic average of ALL scale_1_10 answers across this club's
			// feedback responses (not per-form-weighted). Null if no scale answers exist.
			let scaleSum = 0;
			let scaleCount = 0;
			for (const response of formResponses) {
				if (response.clubId !== club._id) continue;
				const scaleIds = scaleQuestionIdsByForm.get(response.formId);
				if (!scaleIds) continue;
				for (const answer of response.answers) {
					if (!scaleIds.has(answer.questionId)) continue;
					if (typeof answer.value !== 'number') continue;
					scaleSum += answer.value;
					scaleCount += 1;
				}
			}
			const qualityRating = scaleCount > 0 ? scaleSum / scaleCount : null;

			const status: 'active' | 'abandoned' = club.abandonedAt ? 'abandoned' : 'active';
			const flags: ClubHealthFlag[] = [];
			if (club.abandonedAt) flags.push('abandoned');
			if (sessionsRun === 0) flags.push('no_sessions_yet');
			if (qualityRating !== null && qualityRating < LOW_QUALITY_THRESHOLD)
				flags.push('low_quality');
			if (
				!club.abandonedAt &&
				(lastActivityAt === null || now - lastActivityAt > INACTIVITY_THRESHOLD_MS)
			) {
				flags.push('inactive');
			}

			const cocGroup = club.cocGroupId ? (clubsById.get(club.cocGroupId) ?? null) : null;

			return {
				clubId: club._id,
				name: club.name,
				location: club.location ?? null,
				cocGroupId: club.cocGroupId ?? null,
				cocGroupName: cocGroup?.name ?? null,
				guideCount,
				learnerCount,
				sessionsRun,
				attendanceRate,
				activeProjectCount,
				lastActivityAt,
				qualityRating,
				status,
				flags
			};
		});

		return rows;
	}
});

// ---------------------------------------------------------------------------
// 3. Applications pipeline.
// ---------------------------------------------------------------------------

// CL-710 CEO review: `accepted` is now terminal (club created immediately, no onboarding-call
// wait), so it's no longer "in-flight" here — only applications still awaiting a decision are.
const IN_FLIGHT_STATUSES: Doc<'clubApplications'>['status'][] = [
	'incomplete',
	'pending',
	'interview'
];

export type ApplicationPipelineItem = {
	applicationId: Id<'clubApplications'>;
	name: string;
	applicantName: string | null;
	applicantEmail: string | null;
	clubName: string | null;
	status: Doc<'clubApplications'>['status'];
	createdAt: number;
	// Set for decided applications only (see `decidedItems` below).
	decidedAt: number | null;
	reviewCount: number;
	avgScore: number | null;
	scoreDiscrepancyFlag: boolean;
	adminFollowUpFlag: Doc<'clubApplications'>['adminFollowUpFlag'] | null;
};

const getClubName = async (ctx: QueryCtx, clubId: Id<'clubs'> | undefined) => {
	if (!clubId) return null;
	const club = await ctx.db.get(clubId);
	return club?.name ?? null;
};

export const adminApplicationsPipeline = query({
	args: {},
	handler: async (ctx) => {
		await requireGlobalAdmin(ctx);

		const [applications, reviews] = await Promise.all([
			ctx.db.query('clubApplications').collect(),
			ctx.db.query('applicationReviews').collect()
		]);

		const reviewsByApplication = new Map<Id<'clubApplications'>, Doc<'applicationReviews'>[]>();
		for (const review of reviews) {
			const list = reviewsByApplication.get(review.applicationId) ?? [];
			list.push(review);
			reviewsByApplication.set(review.applicationId, list);
		}

		const statusCounts: Record<Doc<'clubApplications'>['status'], number> = {
			incomplete: 0,
			pending: 0,
			interview: 0,
			accepted: 0,
			rejected: 0
		};
		for (const application of applications) {
			statusCounts[application.status] += 1;
		}

		const toPipelineItem = async (
			application: Doc<'clubApplications'>
		): Promise<ApplicationPipelineItem> => {
			const applicationReviews = reviewsByApplication.get(application._id) ?? [];
			const scores = applicationReviews.map((r) => r.score);
			const avgScore =
				scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : null;
			// PRD-defined discrepancy: at least 2 reviews and a max-min spread >= 4.
			const scoreDiscrepancyFlag =
				scores.length >= 2 ? Math.max(...scores) - Math.min(...scores) >= 4 : false;
			const applicantProfile = await ctx.db.get(application.applicantProfileId);

			return {
				applicationId: application._id,
				name: application.name,
				applicantName: applicantProfile ? profileDisplayName(applicantProfile) : null,
				// Auth email (Better Auth user record) — staff reach applicants outside the app too.
				applicantEmail: applicantProfile
					? await getAuthUserEmail(ctx, applicantProfile.authUserId)
					: null,
				clubName: await getClubName(ctx, application.createdClubId),
				status: application.status,
				createdAt: application.createdAt,
				decidedAt: application.decidedAt ?? null,
				reviewCount: applicationReviews.length,
				avgScore,
				scoreDiscrepancyFlag,
				adminFollowUpFlag: application.adminFollowUpFlag ?? null
			};
		};

		const inFlight = applications.filter((application) =>
			IN_FLIGHT_STATUSES.includes(application.status)
		);
		const items: ApplicationPipelineItem[] = await Promise.all(inFlight.map(toPipelineItem));
		items.sort((a, b) => b.createdAt - a.createdAt);

		// Decided (accepted/rejected) applications stay listed so staff can still open them — the
		// application chat deliberately stays sendable after a decision (CL-710 CEO review item 4),
		// and the admin portal's review page is now a chat surface too.
		const decided = applications.filter(
			(application) => application.status === 'accepted' || application.status === 'rejected'
		);
		const decidedItems: ApplicationPipelineItem[] = await Promise.all(decided.map(toPipelineItem));
		decidedItems.sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt));

		return { statusCounts, items, decidedItems };
	}
});

// ---------------------------------------------------------------------------
// 4. Quality flags (CL-733, PRD 6.11.4).
//
// Separate from `adminClubsHealth`'s `qualityRating`/`low_quality` flag above: that column is a
// live-computed snapshot for the dashboard table, while `qualityFlags` (schema.ts) is the actual
// flag record created by forms.ts submitResponse whenever a club+season average drops below 7/10
// (and deleted once it recovers). This query is minimal on purpose — no admin UI is required by
// this ticket, just a consumable list for CL-732's dashboard to build on later.
// ---------------------------------------------------------------------------

export type AdminQualityFlagRow = {
	flagId: Id<'qualityFlags'>;
	clubId: Id<'clubs'>;
	clubName: string;
	seasonId: Id<'seasons'>;
	seasonName: string;
	avgScore: number;
	createdAt: number;
};

export const adminListQualityFlags = query({
	args: {},
	handler: async (ctx): Promise<AdminQualityFlagRow[]> => {
		await requireGlobalAdmin(ctx);

		const flags = await ctx.db
			.query('qualityFlags')
			.withIndex('by_status_and_created', (q) => q.eq('status', 'open'))
			.order('desc')
			.collect();

		const clubsById = new Map<Id<'clubs'>, Doc<'clubs'>>();
		const seasonsById = new Map<Id<'seasons'>, Doc<'seasons'>>();

		const rows: AdminQualityFlagRow[] = [];
		for (const flag of flags) {
			let club = clubsById.get(flag.clubId);
			if (club === undefined) {
				const fetched = await ctx.db.get(flag.clubId);
				if (fetched) clubsById.set(flag.clubId, fetched);
				club = fetched ?? undefined;
			}
			let season = seasonsById.get(flag.seasonId);
			if (season === undefined) {
				const fetched = await ctx.db.get(flag.seasonId);
				if (fetched) seasonsById.set(flag.seasonId, fetched);
				season = fetched ?? undefined;
			}

			rows.push({
				flagId: flag._id,
				clubId: flag.clubId,
				clubName: club?.name ?? 'Unknown club',
				seasonId: flag.seasonId,
				seasonName: season?.name ?? 'Unknown season',
				avgScore: flag.avgScore,
				createdAt: flag.createdAt
			});
		}

		return rows;
	}
});

// ---------------------------------------------------------------------------
// 5. Application review (staff decisions + review page data).
//
// Until peer review is fully staffed, applications are accepted/declined by staff from the admin
// portal. These mirror clubApplications.ts's moveToInterview/decideApplication — same status
// transitions, same chat/system messages, same notifications, same accept side effects
// (createClubFromApplication) — but are gated on requireGlobalAdmin instead of the
// deciding-reviewer rule, and accept a decision straight from `pending` (staff don't have to
// stage through `interview` unless they want the call). The staff↔applicant conversation uses
// the application's existing chat room via the regular chat.* functions — admins get read+send
// there through chatModel.getClubApplicationAccess's globalRole check, so the applicant sees
// staff messages in the member app's chat exactly like reviewer messages.
// ---------------------------------------------------------------------------

const DECIDABLE_STATUSES: Doc<'clubApplications'>['status'][] = ['pending', 'interview'];

export const adminGetApplication = query({
	args: {
		applicationId: v.id('clubApplications')
	},
	handler: async (ctx, args) => {
		await requireGlobalAdmin(ctx);

		const application = await ctx.db.get(args.applicationId);
		if (!application) {
			return null;
		}

		const applicantProfile = await ctx.db.get(application.applicantProfileId);
		const room = await ctx.db
			.query('rooms')
			.withIndex('by_club_application_id', (q) => q.eq('clubApplicationId', application._id))
			.first();

		const reviewRows = await ctx.db
			.query('applicationReviews')
			.withIndex('by_application_id', (q) => q.eq('applicationId', application._id))
			.collect();
		const reviews = await Promise.all(
			reviewRows.map(async (review) => {
				const reviewerProfile = await ctx.db.get(review.reviewerProfileId);
				return {
					reviewId: review._id,
					reviewerName: reviewerProfile ? profileDisplayName(reviewerProfile) : 'Unknown reviewer',
					principlesScore: review.principlesScore ?? null,
					safetyScore: review.safetyScore ?? null,
					score: review.score,
					note: review.note,
					createdAt: review.createdAt
				};
			})
		);

		const decidedByProfile = application.decidedByProfileId
			? await ctx.db.get(application.decidedByProfileId)
			: null;

		return {
			applicationId: application._id,
			status: application.status,
			name: application.name,
			description: application.description ?? null,
			location: application.location ?? null,
			applicantRole: application.applicantRole ?? null,
			referralSource: application.referralSource ?? null,
			referralOther: application.referralOther ?? null,
			createdAt: application.createdAt,
			decidedAt: application.decidedAt ?? null,
			decidedByName: decidedByProfile ? profileDisplayName(decidedByProfile) : null,
			rejectionNote: application.rejectionNote ?? null,
			adminFollowUpFlag: application.adminFollowUpFlag ?? null,
			applicant: applicantProfile
				? {
						profileId: applicantProfile._id,
						name: profileDisplayName(applicantProfile),
						username: applicantProfile.username ?? null,
						email: await getAuthUserEmail(ctx, applicantProfile.authUserId)
					}
				: null,
			clubName: await getClubName(ctx, application.createdClubId),
			createdClubId: application.createdClubId ?? null,
			// Direct storage URL (see clubApplications.resolveApplicationVideoUrl's caveat: in
			// environments with private buckets + CDN signing this can 403; the admin portal has no
			// signed-delivery proxy yet, and current production serves direct URLs).
			videoUrl: await resolveApplicationVideoUrl(ctx, application),
			roomId: room?._id ?? null,
			reviews
		};
	}
});

export const adminMoveToInterview = mutation({
	args: {
		applicationId: v.id('clubApplications')
	},
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		const identity = await requireGlobalAdmin(ctx);
		const adminProfile = await requireProfile(ctx, identity.subject);
		const application = await ctx.db.get(args.applicationId);
		if (!application) {
			throw new ConvexError('Application not found');
		}
		if (application.status !== 'pending') {
			throw new ConvexError('Only applications in review can move to interview');
		}

		const now = Date.now();
		await ctx.db.patch(application._id, {
			status: 'interview',
			movedToInterviewAt: now,
			movedToInterviewByProfileId: adminProfile._id,
			updatedAt: now
		});
		await ensureClubApplicationRoom(ctx, application._id);

		await dispatchNotification(ctx, {
			recipientProfileId: application.applicantProfileId,
			kind: 'application_status',
			title: 'Your application moved to interview',
			message: 'Your application moved to interview — expect a message to schedule a call.'
		});

		return { success: true };
	}
});

export const adminDecideApplication = mutation({
	args: {
		applicationId: v.id('clubApplications'),
		decision: v.union(v.literal('accepted'), v.literal('rejected')),
		rejectionNote: v.optional(v.string())
	},
	returns: v.object({ success: v.boolean() }),
	handler: async (ctx, args) => {
		const identity = await requireGlobalAdmin(ctx);
		const adminProfile = await requireProfile(ctx, identity.subject);
		const application = await ctx.db.get(args.applicationId);
		if (!application) {
			throw new ConvexError('Application not found');
		}
		if (!DECIDABLE_STATUSES.includes(application.status)) {
			throw new ConvexError('This application is not awaiting a decision');
		}

		const now = Date.now();
		const trimmedNote = args.rejectionNote?.trim();
		const rejectionNote = args.decision === 'rejected' && trimmedNote ? trimmedNote : undefined;

		await ctx.db.patch(application._id, {
			status: args.decision,
			decidedAt: now,
			decidedByProfileId: adminProfile._id,
			rejectionNote,
			updatedAt: now
		});

		const roomId = await ensureClubApplicationRoom(ctx, application._id);

		if (args.decision === 'rejected') {
			if (rejectionNote) {
				await ctx.db.insert('messages', {
					roomId,
					profileId: adminProfile._id,
					content: rejectionNote
				});
			}
			await ctx.db.insert('messages', {
				roomId,
				content: 'This application was not accepted.'
			});
			await dispatchNotification(ctx, {
				recipientProfileId: application.applicantProfileId,
				kind: 'application_status',
				title: 'Application update',
				message: 'Your application was not accepted this time.'
			});
		} else {
			const patchedApplication = await ctx.db.get(application._id);
			if (!patchedApplication) {
				throw new ConvexError('Application not found');
			}
			await createClubFromApplication(ctx, patchedApplication);

			await ctx.db.insert('messages', {
				roomId,
				content: 'This application was accepted — the club is live!'
			});
			await dispatchNotification(ctx, {
				recipientProfileId: application.applicantProfileId,
				kind: 'application_status',
				title: 'Application accepted',
				message: 'Congratulations! Your application was accepted and your club is now live.'
			});
		}

		return { success: true };
	}
});

// ---------------------------------------------------------------------------
// 6. Club Interest Form signups (read-only list for the admin portal).
//
// These are the public "keep me posted" signups from the marketing/site flow
// (clubs.submitClubInterestSignup) — email + location, no account attached.
// ---------------------------------------------------------------------------

export const adminListClubInterestSignups = query({
	args: {},
	handler: async (ctx) => {
		await requireGlobalAdmin(ctx);

		const signups = await ctx.db
			.query('clubInterestSignups')
			.withIndex('by_created_at')
			.order('desc')
			.collect();

		return signups.map((signup) => ({
			signupId: signup._id,
			email: signup.email,
			location: signup.location,
			createdAt: signup.createdAt,
			updatedAt: signup.updatedAt
		}));
	}
});
