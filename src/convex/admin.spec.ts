import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

// The betterAuth component is not available in convex-test, so the auth-email lookup module is
// mocked with a fixed map — same pattern as adminInvites.spec.ts / parentAccounts.spec.ts.
const { authEmailByUserId } = vi.hoisted(() => ({
	authEmailByUserId: new Map<string, string>([['applicant-user', 'applicant@example.com']])
}));

vi.mock('./authEmail', () => ({
	getAuthUserEmail: async (_ctx: unknown, authUserId: string) =>
		authEmailByUserId.get(authUserId) ?? null,
	getAuthUserEmailInfo: async (_ctx: unknown, authUserId: string) => {
		const email = authEmailByUserId.get(authUserId);
		return email ? { email, emailVerified: true, name: null } : null;
	},
	getAuthUserIdByEmail: async (_ctx: unknown, email: string) => {
		for (const [authUserId, candidate] of authEmailByUserId) {
			if (candidate === email) return authUserId;
		}
		return null;
	}
}));

const seedProfile = async (
	t: ReturnType<typeof convexTest>,
	authUserId: string
): Promise<Id<'profiles'>> =>
	t.run(async (ctx) => {
		return await ctx.db.insert('profiles', {
			authUserId,
			username: authUserId,
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: Date.now()
		});
	});

const makeAdmin = async (t: ReturnType<typeof convexTest>, profileId: Id<'profiles'>) =>
	t.run((ctx) =>
		ctx.runMutation(internal.profiles.setGlobalRole, { profileId, globalRole: 'admin' })
	);

const seedClubRoles = async (t: ReturnType<typeof convexTest>) =>
	t.run(async (ctx) => {
		const now = Date.now();
		const guideRoleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: [],
			order: 0,
			createdAt: now
		});
		const learnerRoleId = await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: [],
			order: 1,
			createdAt: now
		});
		return { guideRoleId, learnerRoleId };
	});

describe('admin.getDashboardOverview', () => {
	it('rejects a non-admin caller', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'regular-user');
		await expect(
			t.withIdentity({ subject: 'regular-user' }).query(api.admin.getDashboardOverview, {})
		).rejects.toThrow('Not authorized');
	});

	it('computes headline counts for an admin caller', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const { guideRoleId, learnerRoleId } = await seedClubRoles(t);

		await t.run(async (ctx) => {
			const now = Date.now();
			const guideProfileId = await ctx.db.insert('profiles', {
				authUserId: 'guide-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const learnerProfileId = await ctx.db.insert('profiles', {
				authUserId: 'learner-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});

			const activeClubId = await ctx.db.insert('clubs', {
				name: 'Active club',
				discoverable: true,
				kind: 'curiosity',
				createdByProfileId: adminProfileId,
				createdAt: now,
				updatedAt: now
			});
			// Abandoned club: excluded from active counts.
			await ctx.db.insert('clubs', {
				name: 'Abandoned club',
				discoverable: false,
				kind: 'curiosity',
				abandonedAt: now,
				createdByProfileId: adminProfileId,
				createdAt: now,
				updatedAt: now
			});

			await ctx.db.insert('clubMembers', {
				clubId: activeClubId,
				profileId: guideProfileId,
				roleId: guideRoleId,
				createdAt: now
			});
			await ctx.db.insert('clubMembers', {
				clubId: activeClubId,
				profileId: learnerProfileId,
				roleId: learnerRoleId,
				createdAt: now
			});

			await ctx.db.insert('clubApplications', {
				applicantProfileId: learnerProfileId,
				status: 'pending',
				name: 'App A',
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('clubApplications', {
				applicantProfileId: learnerProfileId,
				status: 'rejected',
				name: 'App B',
				createdAt: now,
				updatedAt: now
			});

			await ctx.db.insert('reports', {
				reporterProfileId: adminProfileId,
				category: 'safeguarding',
				targetType: 'club',
				targetId: 'fixture',
				status: 'open',
				createdAt: now
			});
		});

		const result = await t
			.withIdentity({ subject: 'admin-user' })
			.query(api.admin.getDashboardOverview, {});

		expect(result.activeClubCount).toBe(1);
		expect(result.activeGuideCount).toBe(1);
		expect(result.activeLearnerCount).toBe(1);
		expect(result.pendingApplicationCount).toBe(1);
		expect(result.openSafeguardingAlertCount).toBe(1);
	});
});

describe('admin.adminClubsHealth', () => {
	it('rejects a non-admin caller', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'regular-user');
		await expect(
			t.withIdentity({ subject: 'regular-user' }).query(api.admin.adminClubsHealth, {})
		).rejects.toThrow('Not authorized');
	});

	it('computes attendance rate, sessions run, and flags per club', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const { guideRoleId, learnerRoleId } = await seedClubRoles(t);

		const { clubId, noSessionClubId } = await t.run(async (ctx) => {
			const now = Date.now();
			const guideProfileId = await ctx.db.insert('profiles', {
				authUserId: 'guide-user-2',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const learnerProfileId = await ctx.db.insert('profiles', {
				authUserId: 'learner-user-2',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});

			const clubId = await ctx.db.insert('clubs', {
				name: 'Test club',
				location: 'Nairobi',
				discoverable: true,
				kind: 'curiosity',
				createdByProfileId: adminProfileId,
				createdAt: now,
				updatedAt: now
			});
			const noSessionClubId = await ctx.db.insert('clubs', {
				name: 'Fresh club',
				discoverable: true,
				kind: 'curiosity',
				createdByProfileId: adminProfileId,
				createdAt: now,
				updatedAt: now
			});

			await ctx.db.insert('clubMembers', {
				clubId,
				profileId: guideProfileId,
				roleId: guideRoleId,
				createdAt: now
			});
			await ctx.db.insert('clubMembers', {
				clubId,
				profileId: learnerProfileId,
				roleId: learnerRoleId,
				createdAt: now
			});

			// Past, non-cancelled session with recorded attendance: 1 present, 1 absent -> 50%.
			const pastSessionId = await ctx.db.insert('sessions', {
				clubId,
				startTime: now - 60 * 60 * 1000,
				endTime: now - 30 * 60 * 1000,
				createdByProfileId: guideProfileId,
				createdAt: now,
				updatedAt: now
			});
			// Cancelled session: excluded from sessionsRun and attendance rate entirely.
			const cancelledSessionId = await ctx.db.insert('sessions', {
				clubId,
				startTime: now - 2 * 60 * 60 * 1000,
				endTime: now - 90 * 60 * 1000,
				createdByProfileId: guideProfileId,
				cancelled: true,
				cancelledAt: now,
				createdAt: now,
				updatedAt: now
			});
			// Future session: excluded from sessionsRun (not yet past).
			await ctx.db.insert('sessions', {
				clubId,
				startTime: now + 60 * 60 * 1000,
				endTime: now + 90 * 60 * 1000,
				createdByProfileId: guideProfileId,
				createdAt: now,
				updatedAt: now
			});

			await ctx.db.insert('attendances', {
				sessionId: pastSessionId,
				profileId: guideProfileId,
				status: 'present',
				recordedByProfileId: guideProfileId,
				recordedAt: now
			});
			await ctx.db.insert('attendances', {
				sessionId: pastSessionId,
				profileId: learnerProfileId,
				status: 'absent',
				recordedByProfileId: guideProfileId,
				recordedAt: now
			});
			// Attendance recorded against a cancelled session must not count.
			await ctx.db.insert('attendances', {
				sessionId: cancelledSessionId,
				profileId: guideProfileId,
				status: 'present',
				recordedByProfileId: guideProfileId,
				recordedAt: now
			});

			return { clubId, noSessionClubId };
		});

		const rows = await t
			.withIdentity({ subject: 'admin-user' })
			.query(api.admin.adminClubsHealth, {});

		const testClubRow = rows.find((row) => row.clubId === clubId);
		expect(testClubRow).toBeDefined();
		expect(testClubRow?.sessionsRun).toBe(1);
		expect(testClubRow?.attendanceRate).toBeCloseTo(0.5);
		expect(testClubRow?.guideCount).toBe(1);
		expect(testClubRow?.learnerCount).toBe(1);
		expect(testClubRow?.flags).not.toContain('no_sessions_yet');

		const freshClubRow = rows.find((row) => row.clubId === noSessionClubId);
		expect(freshClubRow).toBeDefined();
		expect(freshClubRow?.sessionsRun).toBe(0);
		expect(freshClubRow?.attendanceRate).toBeNull();
		expect(freshClubRow?.flags).toContain('no_sessions_yet');
		expect(freshClubRow?.flags).toContain('inactive');
	});

	it('flags abandoned clubs and low quality ratings', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);

		const { abandonedClubId, lowQualityClubId } = await t.run(async (ctx) => {
			const now = Date.now();
			const guideProfileId = await ctx.db.insert('profiles', {
				authUserId: 'guide-user-3',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});

			const abandonedClubId = await ctx.db.insert('clubs', {
				name: 'Abandoned club',
				discoverable: false,
				kind: 'curiosity',
				abandonedAt: now,
				createdByProfileId: adminProfileId,
				createdAt: now,
				updatedAt: now
			});

			const lowQualityClubId = await ctx.db.insert('clubs', {
				name: 'Low quality club',
				discoverable: true,
				kind: 'curiosity',
				createdByProfileId: adminProfileId,
				createdAt: now,
				updatedAt: now
			});

			const seasonId = await ctx.db.insert('seasons', {
				name: 'Season 1',
				startDate: now,
				endDate: now + 1000,
				reviewWindowOpen: now,
				reviewWindowClose: now + 1000,
				feedbackDeadline: now + 1000,
				createdAt: now,
				updatedAt: now
			});
			const formId = await ctx.db.insert('forms', {
				title: 'Learner feedback',
				audience: 'learner',
				seasonId,
				questions: [{ id: 'q1', label: 'Overall', kind: 'scale_1_10', required: true }],
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('formResponses', {
				formId,
				profileId: guideProfileId,
				clubId: lowQualityClubId,
				answers: [{ questionId: 'q1', value: 3 }],
				submittedAt: now
			});

			return { abandonedClubId, lowQualityClubId };
		});

		const rows = await t
			.withIdentity({ subject: 'admin-user' })
			.query(api.admin.adminClubsHealth, {});

		const abandonedRow = rows.find((row) => row.clubId === abandonedClubId);
		expect(abandonedRow?.status).toBe('abandoned');
		expect(abandonedRow?.flags).toContain('abandoned');
		// Abandoned clubs aren't also double-flagged inactive by this implementation.
		expect(abandonedRow?.flags).not.toContain('inactive');

		const lowQualityRow = rows.find((row) => row.clubId === lowQualityClubId);
		expect(lowQualityRow?.qualityRating).toBe(3);
		expect(lowQualityRow?.flags).toContain('low_quality');
	});
});

describe('admin.adminApplicationsPipeline', () => {
	it('rejects a non-admin caller', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'regular-user');
		await expect(
			t.withIdentity({ subject: 'regular-user' }).query(api.admin.adminApplicationsPipeline, {})
		).rejects.toThrow('Not authorized');
	});

	it('counts every status and flags in-flight applications with score discrepancies', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);

		const { discrepantApplicationId, agreeableApplicationId } = await t.run(async (ctx) => {
			const now = Date.now();
			const applicantProfileId = await ctx.db.insert('profiles', {
				authUserId: 'applicant-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const reviewerAProfileId = await ctx.db.insert('profiles', {
				authUserId: 'reviewer-a',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const reviewerBProfileId = await ctx.db.insert('profiles', {
				authUserId: 'reviewer-b',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});

			const discrepantApplicationId = await ctx.db.insert('clubApplications', {
				applicantProfileId,
				status: 'pending',
				name: 'Discrepant application',
				createdAt: now,
				updatedAt: now,
				adminFollowUpFlag: {
					reason: 'No-show at interview',
					createdAt: now,
					createdByProfileId: adminProfileId
				}
			});
			await ctx.db.insert('applicationReviews', {
				applicationId: discrepantApplicationId,
				reviewerProfileId: reviewerAProfileId,
				score: 9,
				note: 'Great',
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('applicationReviews', {
				applicationId: discrepantApplicationId,
				reviewerProfileId: reviewerBProfileId,
				score: 4,
				note: 'Concerned',
				createdAt: now,
				updatedAt: now
			});

			const agreeableApplicationId = await ctx.db.insert('clubApplications', {
				applicantProfileId,
				status: 'interview',
				name: 'Agreeable application',
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('applicationReviews', {
				applicationId: agreeableApplicationId,
				reviewerProfileId: reviewerAProfileId,
				score: 8,
				note: 'Good',
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('applicationReviews', {
				applicationId: agreeableApplicationId,
				reviewerProfileId: reviewerBProfileId,
				score: 7,
				note: 'Good too',
				createdAt: now,
				updatedAt: now
			});

			// Not in-flight (CL-710: accepted is terminal — club already created): excluded from the
			// `items` list but counted in `statusCounts`.
			await ctx.db.insert('clubApplications', {
				applicantProfileId,
				status: 'accepted',
				name: 'Accepted application',
				createdAt: now,
				updatedAt: now
			});

			return { discrepantApplicationId, agreeableApplicationId };
		});

		const result = await t
			.withIdentity({ subject: 'admin-user' })
			.query(api.admin.adminApplicationsPipeline, {});

		expect(result.statusCounts.pending).toBe(1);
		expect(result.statusCounts.interview).toBe(1);
		expect(result.statusCounts.accepted).toBe(1);
		expect(result.items).toHaveLength(2);

		const discrepant = result.items.find((item) => item.applicationId === discrepantApplicationId);
		expect(discrepant?.reviewCount).toBe(2);
		expect(discrepant?.avgScore).toBeCloseTo(6.5);
		expect(discrepant?.scoreDiscrepancyFlag).toBe(true);
		expect(discrepant?.adminFollowUpFlag?.reason).toBe('No-show at interview');

		const agreeable = result.items.find((item) => item.applicationId === agreeableApplicationId);
		expect(agreeable?.scoreDiscrepancyFlag).toBe(false);
		expect(agreeable?.avgScore).toBeCloseTo(7.5);
	});
});

// ---------------------------------------------------------------------------
// Staff application review (adminGetApplication / adminMoveToInterview /
// adminDecideApplication) + admin chat access + interest signups.
// ---------------------------------------------------------------------------

const seedPendingApplication = async (t: ReturnType<typeof convexTest>) =>
	t.run(async (ctx) => {
		const now = Date.now();
		const applicantProfileId = await ctx.db.insert('profiles', {
			authUserId: 'applicant-user',
			username: 'applicant',
			firstName: 'App',
			lastName: 'Licant',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const applicationId = await ctx.db.insert('clubApplications', {
			applicantProfileId,
			status: 'pending',
			name: 'Braga Curiosity Club',
			description: 'A great club',
			location: 'Braga',
			createdAt: now,
			updatedAt: now
		});
		const roomId = await ctx.db.insert('rooms', {
			contextType: 'clubApplication',
			clubApplicationId: applicationId
		});
		return { applicantProfileId, applicationId, roomId };
	});

describe('admin.adminApplicationsPipeline chat state', () => {
	it('flags applications whose latest human chat message is from the applicant', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const { applicantProfileId, applicationId, roomId } = await seedPendingApplication(t);

		const readPipelineItem = async () => {
			const result = await t
				.withIdentity({ subject: 'admin-user' })
				.query(api.admin.adminApplicationsPipeline, {});
			return result.items.find((item) => item.applicationId === applicationId);
		};

		// No messages yet: nothing awaiting.
		let item = await readPipelineItem();
		expect(item?.chatLastMessageAt).toBeNull();
		expect(item?.chatAwaitingReply).toBe(false);

		// Applicant writes: awaiting a reply.
		await t.run(async (ctx) => {
			await ctx.db.insert('messages', {
				roomId,
				profileId: applicantProfileId,
				content: 'Hi, any update?'
			});
		});
		item = await readPipelineItem();
		expect(item?.chatLastMessageAt).not.toBeNull();
		expect(item?.chatAwaitingReply).toBe(true);

		// A system message (no profileId) after it does not count as a reply.
		await t.run(async (ctx) => {
			await ctx.db.insert('messages', { roomId, content: 'Automated notice' });
		});
		item = await readPipelineItem();
		expect(item?.chatAwaitingReply).toBe(true);

		// Staff reply clears it.
		await t.run(async (ctx) => {
			await ctx.db.insert('messages', {
				roomId,
				profileId: adminProfileId,
				content: 'On it!'
			});
		});
		item = await readPipelineItem();
		expect(item?.chatAwaitingReply).toBe(false);
	});
});

describe('admin application review', () => {
	it('rejects non-admin callers on every entry point', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'regular-user');
		const { applicationId } = await seedPendingApplication(t);
		const regular = t.withIdentity({ subject: 'regular-user' });

		await expect(regular.query(api.admin.adminGetApplication, { applicationId })).rejects.toThrow(
			'Not authorized'
		);
		await expect(
			regular.mutation(api.admin.adminMoveToInterview, { applicationId })
		).rejects.toThrow('Not authorized');
		await expect(
			regular.mutation(api.admin.adminDecideApplication, { applicationId, decision: 'accepted' })
		).rejects.toThrow('Not authorized');
		await expect(regular.query(api.admin.adminListClubInterestSignups, {})).rejects.toThrow(
			'Not authorized'
		);
	});

	it('creates a chat room on demand for an incomplete application, idempotently', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		// An incomplete draft — no room exists yet (rooms are otherwise only created at submission).
		const applicationId = await t.run(async (ctx) => {
			const applicantProfileId = await ctx.db.insert('profiles', {
				authUserId: 'draft-user',
				username: 'draft-applicant',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
			return await ctx.db.insert('clubApplications', {
				applicantProfileId,
				status: 'incomplete',
				name: 'Draft Curiosity Club',
				createdAt: Date.now(),
				updatedAt: Date.now()
			});
		});
		const admin = t.withIdentity({ subject: 'admin-user' });

		await expect(
			t
				.withIdentity({ subject: 'draft-user' })
				.mutation(api.admin.adminEnsureApplicationRoom, { applicationId })
		).rejects.toThrow('Not authorized');

		const first = await admin.mutation(api.admin.adminEnsureApplicationRoom, { applicationId });
		const second = await admin.mutation(api.admin.adminEnsureApplicationRoom, { applicationId });
		expect(second.roomId).toBe(first.roomId);

		const detail = await admin.query(api.admin.adminGetApplication, { applicationId });
		expect(detail?.roomId).toBe(first.roomId);
	});

	it('returns application detail including the chat room id', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const { applicationId, roomId } = await seedPendingApplication(t);

		const detail = await t
			.withIdentity({ subject: 'admin-user' })
			.query(api.admin.adminGetApplication, { applicationId });

		expect(detail?.status).toBe('pending');
		expect(detail?.name).toBe('Braga Curiosity Club');
		expect(detail?.applicant?.name).toBe('App Licant');
		expect(detail?.applicant?.email).toBe('applicant@example.com');
		expect(detail?.roomId).toBe(roomId);
		expect(detail?.reviews).toHaveLength(0);
		expect(detail?.hasVideo).toBe(false);
	});

	it('lets an admin move a pending application to interview', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const { applicationId, applicantProfileId } = await seedPendingApplication(t);

		await t
			.withIdentity({ subject: 'admin-user' })
			.mutation(api.admin.adminMoveToInterview, { applicationId });

		const { application, notifications } = await t.run(async (ctx) => ({
			application: await ctx.db.get(applicationId),
			notifications: await ctx.db.query('notifications').collect()
		}));
		expect(application?.status).toBe('interview');
		expect(application?.movedToInterviewByProfileId).toBe(adminProfileId);
		expect(
			notifications.some((notification) => notification.profileId === applicantProfileId)
		).toBe(true);
	});

	it('accepts straight from pending: creates the club, guide membership, and system message', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		await seedClubRoles(t);
		const { applicationId, applicantProfileId, roomId } = await seedPendingApplication(t);

		await t
			.withIdentity({ subject: 'admin-user' })
			.mutation(api.admin.adminDecideApplication, { applicationId, decision: 'accepted' });

		const { application, club, membership, messages } = await t.run(async (ctx) => {
			const applicationDoc = await ctx.db.get(applicationId);
			const clubDoc = applicationDoc?.createdClubId
				? await ctx.db.get(applicationDoc.createdClubId)
				: null;
			const membershipDoc = applicationDoc?.createdClubId
				? await ctx.db
						.query('clubMembers')
						.withIndex('by_club_and_profile', (q) =>
							q
								.eq('clubId', applicationDoc.createdClubId as Id<'clubs'>)
								.eq('profileId', applicantProfileId)
						)
						.first()
				: null;
			const messageDocs = await ctx.db
				.query('messages')
				.withIndex('by_room', (q) => q.eq('roomId', roomId))
				.collect();
			return {
				application: applicationDoc,
				club: clubDoc,
				membership: membershipDoc,
				messages: messageDocs
			};
		});

		expect(application?.status).toBe('accepted');
		expect(application?.decidedByProfileId).toBe(adminProfileId);
		expect(club?.name).toBe('Braga Curiosity Club');
		expect(membership).not.toBeNull();
		expect(messages.some((message) => message.content.includes('accepted'))).toBe(true);
	});

	it('rejects with a note: note lands in the chat attributed to the admin', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const { applicationId, roomId } = await seedPendingApplication(t);

		await t.withIdentity({ subject: 'admin-user' }).mutation(api.admin.adminDecideApplication, {
			applicationId,
			decision: 'rejected',
			rejectionNote: 'Not enough learners in the area yet.'
		});

		const { application, messages } = await t.run(async (ctx) => ({
			application: await ctx.db.get(applicationId),
			messages: await ctx.db
				.query('messages')
				.withIndex('by_room', (q) => q.eq('roomId', roomId))
				.collect()
		}));

		expect(application?.status).toBe('rejected');
		expect(application?.rejectionNote).toBe('Not enough learners in the area yet.');
		expect(
			messages.some(
				(message) =>
					message.profileId === adminProfileId &&
					message.content === 'Not enough learners in the area yet.'
			)
		).toBe(true);
		expect(messages.some((message) => !message.profileId)).toBe(true);
	});

	it('refuses to decide an already-decided application', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const { applicationId } = await seedPendingApplication(t);
		await t.run((ctx) => ctx.db.patch(applicationId, { status: 'rejected' }));

		await expect(
			t.withIdentity({ subject: 'admin-user' }).mutation(api.admin.adminDecideApplication, {
				applicationId,
				decision: 'accepted'
			})
		).rejects.toThrow('not awaiting a decision');
	});
});

describe('admin chat access to application rooms', () => {
	it('admin can read and send in an application chat; a random user cannot', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		await seedProfile(t, 'random-user');
		const { roomId } = await seedPendingApplication(t);

		const admin = t.withIdentity({ subject: 'admin-user' });
		await admin.mutation(api.chat.sendMessage, {
			roomId,
			content: 'Hi! We had a look at your application.'
		});
		const listed = await admin.query(api.chat.listMessages, { roomId });
		expect(listed.messages.some((m) => m.content.includes('had a look'))).toBe(true);

		await expect(
			t.withIdentity({ subject: 'random-user' }).query(api.chat.listMessages, { roomId })
		).rejects.toThrow('cannot access');
	});

	it('the applicant sees the admin message in their own chat surface', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const { roomId } = await seedPendingApplication(t);

		await t.withIdentity({ subject: 'admin-user' }).mutation(api.chat.sendMessage, {
			roomId,
			content: 'Hello from the Curiosity team!'
		});

		const applicantView = await t
			.withIdentity({ subject: 'applicant-user' })
			.query(api.chat.listMessages, { roomId });
		expect(applicantView.messages.some((m) => m.content === 'Hello from the Curiosity team!')).toBe(
			true
		);
	});
});

describe('admin.adminListClubInterestSignups', () => {
	it('lists signups newest-first for an admin', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		await t.run(async (ctx) => {
			await ctx.db.insert('clubInterestSignups', {
				email: 'older@example.com',
				location: 'Porto',
				createdAt: 1000,
				updatedAt: 1000
			});
			await ctx.db.insert('clubInterestSignups', {
				email: 'newer@example.com',
				location: 'Braga',
				createdAt: 2000,
				updatedAt: 2000
			});
		});

		const signups = await t
			.withIdentity({ subject: 'admin-user' })
			.query(api.admin.adminListClubInterestSignups, {});

		expect(signups).toHaveLength(2);
		expect(signups[0].email).toBe('newer@example.com');
		expect(signups[1].location).toBe('Porto');
	});
});

describe('admin.adminAnalyticsApplications', () => {
	it('rejects a non-admin caller', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'regular-user');
		await expect(
			t.withIdentity({ subject: 'regular-user' }).query(api.admin.adminAnalyticsApplications, {})
		).rejects.toThrow('Not authorized');
	});

	it('returns raw referral fields per application, defaulting missing ones to null', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);

		await t.run(async (ctx) => {
			const now = Date.now();
			const applicantProfileId = await ctx.db.insert('profiles', {
				authUserId: 'applicant-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			await ctx.db.insert('clubApplications', {
				applicantProfileId,
				status: 'pending',
				name: 'With referral',
				referralSource: 'instagram',
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('clubApplications', {
				applicantProfileId,
				status: 'accepted',
				name: 'Without referral',
				createdAt: now + 1,
				updatedAt: now + 1
			});
		});

		const rows = await t
			.withIdentity({ subject: 'admin-user' })
			.query(api.admin.adminAnalyticsApplications, {});

		expect(rows).toHaveLength(2);
		const withReferral = rows.find((row) => row.referralSource === 'instagram');
		expect(withReferral?.status).toBe('pending');
		expect(withReferral?.referralOther).toBeNull();
		const withoutReferral = rows.find((row) => row.referralSource === null);
		expect(withoutReferral?.status).toBe('accepted');
	});
});
