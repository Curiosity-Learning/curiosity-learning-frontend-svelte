import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const HOUR = 60 * 60 * 1000;

afterEach(() => {
	vi.useRealTimers();
});

const seedSessionFixture = async () => {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const now = Date.now();
		// Members "join" well in the past so tests can freely patch a session's startTime into
		// the recent past/future without accidentally putting the join after the session start.
		const memberJoinedAt = now - 30 * 24 * 60 * 60 * 1000;
		const guideRoleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: [
				'club:read',
				'club_member:read_active',
				'session:read',
				'session:create',
				'session:update',
				'session:cancel',
				'session_rsvp:set',
				'session_activity:read',
				'attendance:read',
				'attendance:create'
			],
			order: 0,
			createdAt: now
		});
		const learnerRoleId = await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: ['club:read', 'session:read', 'session_rsvp:set', 'session_activity:read'],
			order: 1,
			createdAt: now
		});
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
		const outsiderProfileId = await ctx.db.insert('profiles', {
			authUserId: 'outsider-user',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const clubId = await ctx.db.insert('clubs', {
			name: 'Curiosity Club',
			discoverable: false,
			createdByProfileId: guideProfileId,
			createdAt: now,
			updatedAt: now
		});
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: guideProfileId,
			roleId: guideRoleId,
			createdAt: memberJoinedAt
		});
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: learnerProfileId,
			roleId: learnerRoleId,
			createdAt: memberJoinedAt
		});
		return { clubId, guideProfileId, learnerProfileId, outsiderProfileId };
	});

	return { t, ...ids };
};

const createFutureSession = async (
	t: Awaited<ReturnType<typeof seedSessionFixture>>['t'],
	clubId: Awaited<ReturnType<typeof seedSessionFixture>>['clubId'],
	overrides: { startTime?: number; endTime?: number } = {}
) => {
	const startTime = overrides.startTime ?? Date.now() + HOUR;
	const endTime = overrides.endTime ?? startTime + HOUR;
	const session = await t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.create, {
		clubId,
		location: 'Club HQ',
		startTime,
		endTime
	});
	if (!session) throw new Error('session not created');
	return session;
};

describe('sessions.cancel', () => {
	it('allows a guide to cancel a future session', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		const cancelled = await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.cancel, { sessionId: session._id });

		expect(cancelled?.cancelled).toBe(true);
		expect(cancelled?.cancelledAt).toBeTypeOf('number');
		expect(cancelled?.cancelledByProfileId).toBeDefined();
	});

	it('rejects cancelling a past session', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId, {
			startTime: Date.now() + HOUR,
			endTime: Date.now() + 2 * HOUR
		});

		// Move the session into the past directly (create() rejects past start times implicitly
		// via UI conventions, but the schema itself allows it, so patch it for this test).
		await t.run(async (ctx) => {
			await ctx.db.patch(session._id, {
				startTime: Date.now() - HOUR,
				endTime: Date.now() - HOUR + 1000
			});
		});

		await expect(
			t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.cancel, {
				sessionId: session._id
			})
		).rejects.toThrow('Only future sessions can be cancelled');
	});

	it('rejects a learner cancelling a session', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await expect(
			t.withIdentity({ subject: 'learner-user' }).mutation(api.sessions.cancel, {
				sessionId: session._id
			})
		).rejects.toThrow('Permission denied');
	});

	it('rejects double-cancelling', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.cancel, { sessionId: session._id });

		await expect(
			t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.cancel, {
				sessionId: session._id
			})
		).rejects.toThrow('Session is already cancelled');
	});

	it('hides cancelled sessions from listByClub and listCardPreviewsByClub', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.cancel, { sessionId: session._id });

		const listed = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.sessions.listByClub, { clubId });
		expect(listed).toHaveLength(0);

		const previews = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.sessions.listCardPreviewsByClub, { clubId });
		expect(previews).toHaveLength(0);
	});

	it('prevents editing a cancelled session', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.cancel, { sessionId: session._id });

		await expect(
			t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.update, {
				sessionId: session._id,
				location: 'Club HQ',
				startTime: Date.now() + 2 * HOUR,
				endTime: Date.now() + 3 * HOUR
			})
		).rejects.toThrow('Cannot update a cancelled session');
	});

	it('notifies members who RSVP’d going when the session is cancelled', async () => {
		const { t, clubId, learnerProfileId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await t
			.withIdentity({ subject: 'learner-user' })
			.mutation(api.sessions.setRsvp, { sessionId: session._id, status: 'going' });

		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.cancel, { sessionId: session._id });

		const notifications = await t.run(async (ctx) => {
			return await ctx.db
				.query('notifications')
				.withIndex('by_profile', (q) => q.eq('profileId', learnerProfileId))
				.collect();
		});
		expect(notifications).toHaveLength(1);
		expect(notifications[0].message).toContain('cancelled');
	});

	it('does not notify members who RSVP’d not going', async () => {
		const { t, clubId, learnerProfileId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await t
			.withIdentity({ subject: 'learner-user' })
			.mutation(api.sessions.setRsvp, { sessionId: session._id, status: 'not_going' });

		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.cancel, { sessionId: session._id });

		const notifications = await t.run(async (ctx) => {
			return await ctx.db
				.query('notifications')
				.withIndex('by_profile', (q) => q.eq('profileId', learnerProfileId))
				.collect();
		});
		expect(notifications).toHaveLength(0);
	});

	it('notifies default-going members (no explicit RSVP) but never the cancelling guide', async () => {
		const { t, clubId, guideProfileId, learnerProfileId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.cancel, { sessionId: session._id });

		const notificationsFor = (profileId: typeof learnerProfileId) =>
			t.run((ctx) =>
				ctx.db
					.query('notifications')
					.withIndex('by_profile', (q) => q.eq('profileId', profileId))
					.collect()
			);
		// Learner never touched RSVP — default going (CL-712) — so they are notified.
		expect(await notificationsFor(learnerProfileId)).toHaveLength(1);
		// The guide performing the cancellation is not notified about their own action.
		expect(await notificationsFor(guideProfileId)).toHaveLength(0);
	});

	it('keeps cancelled sessions in listCardPreviewsByClub when includeCancelled is set', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.cancel, { sessionId: session._id });

		const previews = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.sessions.listCardPreviewsByClub, { clubId, includeCancelled: true });
		expect(previews).toHaveLength(1);
		expect(previews[0].session.cancelled).toBe(true);
	});

	// Regression test (CEO review round 3): the club home dashboard queries with
	// `upcomingOnly: true` and no `includeCancelled` — a cancelled *future* session must not
	// count as "upcoming" here, or the dashboard's empty state (and "Plan next session" CTA)
	// would be incorrectly suppressed even though nothing is actually upcoming.
	it('excludes a cancelled future session from the upcoming-only dashboard query', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.cancel, { sessionId: session._id });

		const dashboardPreviews = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.sessions.listCardPreviewsByClub, {
				clubId,
				upcomingOnly: true,
				limit: 6,
				includeAttendees: true
			});
		expect(dashboardPreviews).toHaveLength(0);
	});
});

describe('sessions list pagination is resilient to heavy cancellation', () => {
	// Regression test: listByClub/listCardPreviewsByClub used to over-fetch a fixed multiple of
	// `limit` (limit*2+10) from the index, filter out cancelled sessions, and only then slice to
	// `limit` — so a club with more cancelled sessions than that multiple could under-return
	// results even though enough non-cancelled sessions existed further down the index.
	const seedManySessions = async (
		t: Awaited<ReturnType<typeof seedSessionFixture>>['t'],
		clubId: Awaited<ReturnType<typeof seedSessionFixture>>['clubId'],
		guideProfileId: Awaited<ReturnType<typeof seedSessionFixture>>['guideProfileId']
	) => {
		await t.run(async (ctx) => {
			const now = Date.now();
			// 30 cancelled sessions, earliest in the index...
			for (let i = 0; i < 30; i++) {
				await ctx.db.insert('sessions', {
					clubId,
					startTime: now + i * HOUR,
					endTime: now + i * HOUR + HOUR,
					createdByProfileId: guideProfileId,
					cancelled: true,
					cancelledAt: now,
					cancelledByProfileId: guideProfileId,
					createdAt: now,
					updatedAt: now
				});
			}
			// ...then 15 non-cancelled sessions after them in the index.
			for (let i = 30; i < 45; i++) {
				await ctx.db.insert('sessions', {
					clubId,
					startTime: now + i * HOUR,
					endTime: now + i * HOUR + HOUR,
					createdByProfileId: guideProfileId,
					createdAt: now,
					updatedAt: now
				});
			}
		});
	};

	it('listByClub still returns `limit` sessions when cancellations outnumber the old over-fetch multiple', async () => {
		const { t, clubId, guideProfileId } = await seedSessionFixture();
		await seedManySessions(t, clubId, guideProfileId);

		const listed = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.sessions.listByClub, { clubId, limit: 10 });

		expect(listed).toHaveLength(10);
		expect(listed.every((session) => !session.cancelled)).toBe(true);
	});

	it('listCardPreviewsByClub still returns `limit` previews when cancellations outnumber the old over-fetch multiple', async () => {
		const { t, clubId, guideProfileId } = await seedSessionFixture();
		await seedManySessions(t, clubId, guideProfileId);

		const previews = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.sessions.listCardPreviewsByClub, { clubId, limit: 10 });

		expect(previews).toHaveLength(10);
		expect(previews.every((entry) => !entry.session.cancelled)).toBe(true);
	});
});

describe('sessions.setRsvp', () => {
	it('allows an active member to RSVP going, then change to not going', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		const going = await t
			.withIdentity({ subject: 'learner-user' })
			.mutation(api.sessions.setRsvp, { sessionId: session._id, status: 'going' });
		expect(going?.status).toBe('going');

		const notGoing = await t
			.withIdentity({ subject: 'learner-user' })
			.mutation(api.sessions.setRsvp, { sessionId: session._id, status: 'not_going' });
		expect(notGoing?.status).toBe('not_going');
		expect(notGoing?._id).toBe(going?._id);
	});

	it('upserts rather than creating duplicate rows', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await t
			.withIdentity({ subject: 'learner-user' })
			.mutation(api.sessions.setRsvp, { sessionId: session._id, status: 'going' });
		await t
			.withIdentity({ subject: 'learner-user' })
			.mutation(api.sessions.setRsvp, { sessionId: session._id, status: 'going' });

		const rows = await t.run(async (ctx) => {
			return await ctx.db
				.query('sessionRsvps')
				.withIndex('by_session', (q) => q.eq('sessionId', session._id))
				.collect();
		});
		expect(rows).toHaveLength(1);
	});

	it('rejects RSVP from a non-member', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await expect(
			t.withIdentity({ subject: 'outsider-user' }).mutation(api.sessions.setRsvp, {
				sessionId: session._id,
				status: 'going'
			})
		).rejects.toThrow('Permission denied');
	});

	it('rejects RSVP once the session has started', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await t.run(async (ctx) => {
			await ctx.db.patch(session._id, {
				startTime: Date.now() - 1000,
				endTime: Date.now() + HOUR
			});
		});

		await expect(
			t.withIdentity({ subject: 'learner-user' }).mutation(api.sessions.setRsvp, {
				sessionId: session._id,
				status: 'going'
			})
		).rejects.toThrow('RSVP is locked once the session has started');
	});

	it('rejects RSVP on a cancelled session', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.cancel, { sessionId: session._id });

		await expect(
			t.withIdentity({ subject: 'learner-user' }).mutation(api.sessions.setRsvp, {
				sessionId: session._id,
				status: 'going'
			})
		).rejects.toThrow('Cannot RSVP to a cancelled session');
	});

	it('defaults an active member with no RSVP row to going via card data (CL-712)', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		const learnerCardData = await t
			.withIdentity({ subject: 'learner-user' })
			.query(api.sessions.getSessionCardData, { sessionId: session._id });
		expect(learnerCardData.myRsvpStatus).toBe('going');
	});

	it('reflects an explicit not_going over the default via card data', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await t
			.withIdentity({ subject: 'learner-user' })
			.mutation(api.sessions.setRsvp, { sessionId: session._id, status: 'not_going' });

		const learnerCardData = await t
			.withIdentity({ subject: 'learner-user' })
			.query(api.sessions.getSessionCardData, { sessionId: session._id });
		expect(learnerCardData.myRsvpStatus).toBe('not_going');
	});
});

describe('sessions.create location requirement', () => {
	it('rejects a whitespace-only location', async () => {
		const { t, clubId } = await seedSessionFixture();
		const startTime = Date.now() + HOUR;

		await expect(
			t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.create, {
				clubId,
				location: '   ',
				startTime,
				endTime: startTime + HOUR
			})
		).rejects.toThrow('Location is required');
	});

	it('trims and stores the provided location', async () => {
		const { t, clubId } = await seedSessionFixture();
		const startTime = Date.now() + HOUR;

		const session = await t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.create, {
			clubId,
			location: '  Club HQ  ',
			startTime,
			endTime: startTime + HOUR
		});
		expect(session?.location).toBe('Club HQ');
	});

	it('rejects clearing the location on update', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await expect(
			t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.update, {
				sessionId: session._id,
				location: ' ',
				startTime: Date.now() + 2 * HOUR,
				endTime: Date.now() + 3 * HOUR
			})
		).rejects.toThrow('Location is required');
	});
});

describe('sessions.listRsvpRoster (default going, CL-712)', () => {
	it('lists every roster member as going by default and flags the caller', async () => {
		const { t, clubId, guideProfileId, learnerProfileId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		const roster = await t
			.withIdentity({ subject: 'learner-user' })
			.query(api.sessions.listRsvpRoster, { sessionId: session._id });

		expect(roster).toHaveLength(2);
		expect(roster.every((entry) => entry.status === 'going')).toBe(true);
		expect(roster.find((entry) => entry.profileId === learnerProfileId)?.isSelf).toBe(true);
		expect(roster.find((entry) => entry.profileId === guideProfileId)?.isSelf).toBe(false);
	});

	it('overrides the default with an explicit not_going row', async () => {
		const { t, clubId, learnerProfileId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await t
			.withIdentity({ subject: 'learner-user' })
			.mutation(api.sessions.setRsvp, { sessionId: session._id, status: 'not_going' });

		const roster = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.sessions.listRsvpRoster, { sessionId: session._id });

		expect(roster.find((entry) => entry.profileId === learnerProfileId)?.status).toBe('not_going');
		expect(
			roster.filter((entry) => entry.status === 'going').length
		).toBe(roster.length - 1);
	});

	it('rejects non-members', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await expect(
			t
				.withIdentity({ subject: 'outsider-user' })
				.query(api.sessions.listRsvpRoster, { sessionId: session._id })
		).rejects.toThrow('Permission denied');
	});

	// CEO review round 3 (CL-702/CL-712): the viewer's own row always sorts to the top, whoever
	// the viewer is — this is independent of any other ordering the roster happens to have.
	it('sorts the viewer\'s own row to the top regardless of who is viewing', async () => {
		const { t, clubId, guideProfileId, learnerProfileId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		const asLearner = await t
			.withIdentity({ subject: 'learner-user' })
			.query(api.sessions.listRsvpRoster, { sessionId: session._id });
		expect(asLearner[0]?.profileId).toBe(learnerProfileId);
		expect(asLearner[0]?.isSelf).toBe(true);

		const asGuide = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.sessions.listRsvpRoster, { sessionId: session._id });
		expect(asGuide[0]?.profileId).toBe(guideProfileId);
		expect(asGuide[0]?.isSelf).toBe(true);
	});
});

describe('session card attendee previews', () => {
	it('previews going members (default going) for an upcoming session', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		const cardData = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.sessions.getSessionCardData, {
				sessionId: session._id,
				includeAttendees: true
			});
		// Both fixture members default to going; neither has attended anything.
		expect(cardData.attendees).toHaveLength(2);
	});

	it('drops members who explicitly RSVP not_going from the upcoming preview', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await t
			.withIdentity({ subject: 'learner-user' })
			.mutation(api.sessions.setRsvp, { sessionId: session._id, status: 'not_going' });

		const cardData = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.sessions.getSessionCardData, {
				sessionId: session._id,
				includeAttendees: true
			});
		expect(cardData.attendees).toHaveLength(1);
	});

	it('previews recorded present members once the session has started', async () => {
		const { t, clubId, learnerProfileId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await t.run(async (ctx) => {
			await ctx.db.patch(session._id, {
				startTime: Date.now() - HOUR,
				endTime: Date.now() + HOUR
			});
		});
		await t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.setAttendance, {
			sessionId: session._id,
			profileId: learnerProfileId,
			status: 'present'
		});

		const cardData = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.sessions.getSessionCardData, {
				sessionId: session._id,
				includeAttendees: true
			});
		expect(cardData.attendees).toHaveLength(1);
	});
});

describe('sessions.setAttendance timing rules', () => {
	it('rejects marking attendance before the session starts', async () => {
		const { t, clubId, learnerProfileId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId, {
			startTime: Date.now() + HOUR,
			endTime: Date.now() + 2 * HOUR
		});

		await expect(
			t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.setAttendance, {
				sessionId: session._id,
				profileId: learnerProfileId,
				status: 'present'
			})
		).rejects.toThrow('Attendance opens when the session starts');
	});

	it('rejects marking attendance more than 12 hours after the session ends', async () => {
		const { t, clubId, learnerProfileId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId, {
			startTime: Date.now() + HOUR,
			endTime: Date.now() + 2 * HOUR
		});

		await t.run(async (ctx) => {
			await ctx.db.patch(session._id, {
				startTime: Date.now() - 20 * HOUR,
				endTime: Date.now() - 13 * HOUR
			});
		});

		await expect(
			t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.setAttendance, {
				sessionId: session._id,
				profileId: learnerProfileId,
				status: 'present'
			})
		).rejects.toThrow('Attendance is locked for this session');
	});

	it('allows marking attendance once the session has started and before the lock', async () => {
		const { t, clubId, learnerProfileId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId, {
			startTime: Date.now() + HOUR,
			endTime: Date.now() + 2 * HOUR
		});

		await t.run(async (ctx) => {
			await ctx.db.patch(session._id, {
				startTime: Date.now() - HOUR,
				endTime: Date.now() - 30 * 60 * 1000
			});
		});

		const result = await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.setAttendance, {
				sessionId: session._id,
				profileId: learnerProfileId,
				status: 'present'
			});
		expect(result.success).toBe(true);
	});

	it('rejects marking attendance for a cancelled session', async () => {
		const { t, clubId, learnerProfileId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await t.run(async (ctx) => {
			await ctx.db.patch(session._id, {
				startTime: Date.now() - HOUR,
				endTime: Date.now() - 30 * 60 * 1000,
				cancelled: true
			});
		});

		await expect(
			t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.setAttendance, {
				sessionId: session._id,
				profileId: learnerProfileId,
				status: 'present'
			})
		).rejects.toThrow('Cannot mark attendance for a cancelled session');
	});

	it('records the recorder and lets attendance be changed', async () => {
		const { t, clubId, learnerProfileId, guideProfileId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId, {
			startTime: Date.now() + HOUR,
			endTime: Date.now() + 2 * HOUR
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(session._id, {
				startTime: Date.now() - HOUR,
				endTime: Date.now() - 30 * 60 * 1000
			});
		});

		await t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.setAttendance, {
			sessionId: session._id,
			profileId: learnerProfileId,
			status: 'present'
		});

		let row = await t.run((ctx) =>
			ctx.db
				.query('attendances')
				.withIndex('by_session_and_profile', (q) =>
					q.eq('sessionId', session._id).eq('profileId', learnerProfileId)
				)
				.unique()
		);
		expect(row?.status).toBe('present');
		expect(row?.recordedByProfileId).toBe(guideProfileId);

		await t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.setAttendance, {
			sessionId: session._id,
			profileId: learnerProfileId,
			status: 'absent'
		});

		row = await t.run((ctx) =>
			ctx.db
				.query('attendances')
				.withIndex('by_session_and_profile', (q) =>
					q.eq('sessionId', session._id).eq('profileId', learnerProfileId)
				)
				.unique()
		);
		expect(row?.status).toBe('absent');
	});
});

describe('sessions.listAttendanceRoster snapshot', () => {
	it('excludes members who joined after the session started', async () => {
		const { t, clubId, learnerProfileId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId, {
			startTime: Date.now() + HOUR,
			endTime: Date.now() + 2 * HOUR
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(session._id, {
				startTime: Date.now() - HOUR,
				endTime: Date.now() + HOUR
			});
		});

		const learnerRoleId = await t.run(async (ctx) => {
			const membership = await ctx.db
				.query('clubMembers')
				.withIndex('by_club_and_profile', (q) =>
					q.eq('clubId', clubId).eq('profileId', learnerProfileId)
				)
				.first();
			return membership!.roleId;
		});
		const lateJoinerProfileId = await t.run(async (ctx) => {
			const profileId = await ctx.db.insert('profiles', {
				authUserId: 'late-joiner',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
			await ctx.db.insert('clubMembers', {
				clubId,
				profileId,
				roleId: learnerRoleId,
				createdAt: Date.now() + 30 * 60 * 1000 // joined 30 min after session started
			});
			return profileId;
		});

		const roster = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.sessions.listAttendanceRoster, { sessionId: session._id });

		expect(roster.some((entry) => entry.profileId === learnerProfileId)).toBe(true);
		expect(roster.some((entry) => entry.profileId === lateJoinerProfileId)).toBe(false);
	});

	it('excludes members who left before the session started', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId, {
			startTime: Date.now() + HOUR,
			endTime: Date.now() + 2 * HOUR
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(session._id, {
				startTime: Date.now() - HOUR,
				endTime: Date.now() + HOUR
			});
		});

		const learnerRoleId = await t.run(async (ctx) => {
			const role = await ctx.db
				.query('clubRoles')
				.withIndex('by_key', (q) => q.eq('key', 'learner'))
				.unique();
			return role!._id;
		});
		const formerMemberProfileId = await t.run(async (ctx) => {
			const profileId = await ctx.db.insert('profiles', {
				authUserId: 'former-member',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
			await ctx.db.insert('clubMembers', {
				clubId,
				profileId,
				roleId: learnerRoleId,
				createdAt: Date.now() - 2 * HOUR,
				leftAt: Date.now() - 90 * 60 * 1000 // left before session started
			});
			return profileId;
		});

		const roster = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.sessions.listAttendanceRoster, { sessionId: session._id });

		expect(roster.some((entry) => entry.profileId === formerMemberProfileId)).toBe(false);
	});

	it('includes members who left after the session, still showing their recorded attendance', async () => {
		const { t, clubId, learnerProfileId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId, {
			startTime: Date.now() + HOUR,
			endTime: Date.now() + 2 * HOUR
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(session._id, {
				startTime: Date.now() - 2 * HOUR,
				endTime: Date.now() - HOUR
			});
		});

		await t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.setAttendance, {
			sessionId: session._id,
			profileId: learnerProfileId,
			status: 'present'
		});

		// Learner leaves the club after the session.
		await t.run(async (ctx) => {
			const membership = await ctx.db
				.query('clubMembers')
				.withIndex('by_club_and_profile', (q) =>
					q.eq('clubId', clubId).eq('profileId', learnerProfileId)
				)
				.first();
			await ctx.db.patch(membership!._id, { leftAt: Date.now() });
		});

		const roster = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.sessions.listAttendanceRoster, { sessionId: session._id });

		const entry = roster.find((row) => row.profileId === learnerProfileId);
		expect(entry).toBeDefined();
		expect(entry?.status).toBe('present');
	});
});

describe('sessions attendance reminder scheduling', () => {
	it('notifies every guide when attendance is unmarked 1 hour after start', async () => {
		vi.useFakeTimers();
		const { t, clubId, guideProfileId } = await seedSessionFixture();

		const startTime = Date.now() + HOUR;
		const endTime = startTime + HOUR;
		const session = await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.create, { clubId, location: 'Club HQ', startTime, endTime });
		if (!session) throw new Error('session not created');

		await vi.advanceTimersByTimeAsync(2 * HOUR);
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const notifications = await t.run((ctx) =>
			ctx.db
				.query('notifications')
				.withIndex('by_profile', (q) => q.eq('profileId', guideProfileId))
				.collect()
		);
		expect(notifications).toHaveLength(1);
		expect(notifications[0].message).toContain("hasn't been recorded yet");
	});

	it('does not notify when attendance was recorded before the reminder fires', async () => {
		vi.useFakeTimers();
		const { t, clubId, guideProfileId, learnerProfileId } = await seedSessionFixture();

		const startTime = Date.now() + HOUR;
		const endTime = startTime + HOUR;
		const session = await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.create, { clubId, location: 'Club HQ', startTime, endTime });
		if (!session) throw new Error('session not created');

		// Advance just past the session's start so attendance can be marked, but still
		// well before the startTime + 1h reminder would fire.
		await vi.advanceTimersByTimeAsync(HOUR + 5 * 60 * 1000);
		await t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.setAttendance, {
			sessionId: session._id,
			profileId: learnerProfileId,
			status: 'present'
		});

		await vi.advanceTimersByTimeAsync(2 * HOUR);
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const notifications = await t.run((ctx) =>
			ctx.db
				.query('notifications')
				.withIndex('by_profile', (q) => q.eq('profileId', guideProfileId))
				.collect()
		);
		expect(notifications).toHaveLength(0);
	});

	it('does not fire the reminder for a cancelled session', async () => {
		vi.useFakeTimers();
		const { t, clubId, guideProfileId } = await seedSessionFixture();

		const startTime = Date.now() + HOUR;
		const endTime = startTime + HOUR;
		const session = await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.create, { clubId, location: 'Club HQ', startTime, endTime });
		if (!session) throw new Error('session not created');

		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.cancel, { sessionId: session._id });

		await vi.advanceTimersByTimeAsync(3 * HOUR);
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const notifications = await t.run((ctx) =>
			ctx.db
				.query('notifications')
				.withIndex('by_profile', (q) => q.eq('profileId', guideProfileId))
				.collect()
		);
		expect(notifications).toHaveLength(0);
	});

	it('reschedules the reminder when the session start time changes', async () => {
		vi.useFakeTimers();
		const { t, clubId, guideProfileId } = await seedSessionFixture();

		const startTime = Date.now() + HOUR;
		const endTime = startTime + HOUR;
		const session = await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.create, { clubId, location: 'Club HQ', startTime, endTime });
		if (!session) throw new Error('session not created');

		// Push the session further into the future; the original startTime+1h reminder must not fire.
		const newStartTime = startTime + 3 * HOUR;
		const newEndTime = newStartTime + HOUR;
		await t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.update, {
			sessionId: session._id,
			location: 'Club HQ',
			startTime: newStartTime,
			endTime: newEndTime
		});

		// The original job (startTime + 1h) must have been cancelled by the update, and only the
		// rescheduled one (newStartTime + 1h) should remain pending.
		const scheduledJobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
		expect(scheduledJobs).toHaveLength(2);
		const originalJob = scheduledJobs.find((job) => job.scheduledTime === startTime + HOUR);
		const rescheduledJob = scheduledJobs.find(
			(job) => job.scheduledTime === newStartTime + HOUR
		);
		expect(originalJob?.state.kind).toBe('canceled');
		expect(rescheduledJob?.state.kind).toBe('pending');

		// `finishAllScheduledFunctions` drains the entire scheduler queue (not just up to a given
		// point in time), so it can only be used once, at the end, to assert the final state.
		await vi.advanceTimersByTimeAsync(5 * HOUR);
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		const notifications = await t.run((ctx) =>
			ctx.db
				.query('notifications')
				.withIndex('by_profile', (q) => q.eq('profileId', guideProfileId))
				.collect()
		);
		expect(notifications).toHaveLength(1);
	});
});

describe('sessions.hasPhotos', () => {
	it('is false for a session without photos', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		const result = await t
			.withIdentity({ subject: 'learner-user' })
			.query(api.sessions.hasPhotos, { sessionId: session._id });
		expect(result).toBe(false);
	});
});

describe('sessions.backfillAttendanceStatus', () => {
	// The schema now requires `status`, so a genuinely pre-migration row (missing it) can't be
	// constructed through the validated test db. This confirms the backfill is a safe no-op
	// against already-migrated data; the one-time production backfill is exercised via
	// `npx convex run sessions:backfillAttendanceStatus` against the real dev deployment (see report).
	it('is a no-op for rows that already have a status', async () => {
		const { t, clubId, guideProfileId, learnerProfileId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId, {
			startTime: Date.now() - HOUR,
			endTime: Date.now() - 30 * 60 * 1000
		});

		await t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.setAttendance, {
			sessionId: session._id,
			profileId: learnerProfileId,
			status: 'absent'
		});

		const result = await t.run((ctx) =>
			ctx.runMutation(internal.sessions.backfillAttendanceStatus, {})
		);
		expect(result.updated).toBe(0);

		const row = await t.run((ctx) =>
			ctx.db
				.query('attendances')
				.withIndex('by_session_and_profile', (q) =>
					q.eq('sessionId', session._id).eq('profileId', learnerProfileId)
				)
				.unique()
		);
		expect(row?.status).toBe('absent');
		expect(row?.recordedByProfileId).toBe(guideProfileId);
	});
});
