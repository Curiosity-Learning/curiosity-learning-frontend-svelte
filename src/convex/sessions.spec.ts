import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const HOUR = 60 * 60 * 1000;

const seedSessionFixture = async () => {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const now = Date.now();
		const guideRoleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: [
				'club:read',
				'session:read',
				'session:create',
				'session:update',
				'session:cancel',
				'session_rsvp:set',
				'session_rsvp:read_all',
				'session_activity:read'
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
			createdByProfileId: guideProfileId,
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

	it('reports going/not-going counts and the caller’s own status via card data', async () => {
		const { t, clubId } = await seedSessionFixture();
		const session = await createFutureSession(t, clubId);

		await t
			.withIdentity({ subject: 'learner-user' })
			.mutation(api.sessions.setRsvp, { sessionId: session._id, status: 'going' });

		const cardData = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.sessions.getSessionCardData, { sessionId: session._id });
		expect(cardData.rsvpCounts).toEqual({ going: 1, notGoing: 0 });

		const learnerCardData = await t
			.withIdentity({ subject: 'learner-user' })
			.query(api.sessions.getSessionCardData, { sessionId: session._id });
		expect(learnerCardData.myRsvpStatus).toBe('going');
	});
});
