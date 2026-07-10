import { query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { getClubRoleByKey, requireGlobalAdmin } from './permissions';

// CL-693: minimal Overview stub for the /admin route group. The real dashboard is CL-732 — this
// is deliberately just a few trivial counts, but it is the template every future admin
// query/mutation should copy: requireGlobalAdmin first, no route-gating-only reliance.
export const getOverviewCounts = query({
	args: {},
	handler: async (ctx) => {
		await requireGlobalAdmin(ctx);

		const [clubs, profiles, openReports] = await Promise.all([
			ctx.db.query('clubs').collect(),
			ctx.db.query('profiles').collect(),
			ctx.db
				.query('reports')
				.withIndex('by_status_and_created', (q) => q.eq('status', 'open'))
				.collect()
		]);

		return {
			clubCount: clubs.length,
			profileCount: profiles.length,
			openReportCount: openReports.length
		};
	}
});

// ---------------------------------------------------------------------------
// CL-732: Admin Operations Dashboard (PRD 6.14.1-6.14.3).
//
// Shared helpers + three new admin-gated queries: getDashboardOverview (6 headline cards),
// adminClubsHealth (per-club table), adminApplicationsPipeline (pipeline counts + in-flight
// list). Everything here is read-only and deliberately reuses `.collect()`-and-filter over small
// admin tables, matching the existing `getOverviewCounts`/`moderation.searchClubs` precedent —
// this is fine at current data volume; if tables grow large this should move to indexed scans.
// ---------------------------------------------------------------------------

const isActiveCuriosityClub = (club: Doc<'clubs'>) => club.kind === 'curiosity' && !club.abandonedAt;

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

		// "In-flight" = still somewhere in the pipeline, per PRD (pending/interview/accepted).
		const pendingApplicationCount = applications.filter((application) =>
			['pending', 'interview', 'accepted'].includes(application.status)
		).length;

		// Reuses the same "open" definition as moderation.listQueue: open reports + flagged media
		// not yet reviewed by an admin.
		const openFlaggedMediaCount = flaggedMedia.filter((asset) => !asset.moderationReviewedAt).length;
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
			const ids = new Set(
				form.questions.filter((q) => q.kind === 'scale_1_10').map((q) => q.id)
			);
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
			if (qualityRating !== null && qualityRating < LOW_QUALITY_THRESHOLD) flags.push('low_quality');
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

const IN_FLIGHT_STATUSES: Doc<'clubApplications'>['status'][] = ['incomplete', 'pending', 'interview', 'accepted'];

export type ApplicationPipelineItem = {
	applicationId: Id<'clubApplications'>;
	name: string;
	clubName: string | null;
	status: Doc<'clubApplications'>['status'];
	createdAt: number;
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
			rejected: 0,
			finalized: 0
		};
		for (const application of applications) {
			statusCounts[application.status] += 1;
		}

		const inFlight = applications.filter((application) =>
			IN_FLIGHT_STATUSES.includes(application.status)
		);

		const items: ApplicationPipelineItem[] = await Promise.all(
			inFlight.map(async (application) => {
				const applicationReviews = reviewsByApplication.get(application._id) ?? [];
				const scores = applicationReviews.map((r) => r.score);
				const avgScore =
					scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : null;
				// PRD-defined discrepancy: at least 2 reviews and a max-min spread >= 4.
				const scoreDiscrepancyFlag =
					scores.length >= 2 ? Math.max(...scores) - Math.min(...scores) >= 4 : false;

				return {
					applicationId: application._id,
					name: application.name,
					clubName: await getClubName(ctx, application.createdClubId),
					status: application.status,
					createdAt: application.createdAt,
					reviewCount: applicationReviews.length,
					avgScore,
					scoreDiscrepancyFlag,
					adminFollowUpFlag: application.adminFollowUpFlag ?? null
				};
			})
		);

		items.sort((a, b) => b.createdAt - a.createdAt);

		return { statusCounts, items };
	}
});
