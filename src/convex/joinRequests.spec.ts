/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const seedClubFixture = async (
	options: {
		discoverable?: boolean;
		abandonedAt?: number;
		clubCode?: string;
		requesterGateComplete?: boolean;
		requesterIsChildWithConsent?: 'pending' | 'approved';
	} = {}
) => {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const now = Date.now();
		const guideRoleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: ['club:read', 'club_join_request:decide'],
			order: 0,
			createdAt: now
		});
		const learnerRoleId = await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: ['club:read'],
			order: 1,
			createdAt: now
		});
		const guideProfileId = await ctx.db.insert('profiles', {
			authUserId: 'guide-user',
			username: 'guide',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const requesterProfileId = await ctx.db.insert('profiles', {
			authUserId: 'requester-user',
			username: 'requester',
			firstName: 'Req',
			lastName: 'Ester',
			isVerified: true,
			firstLoginCompleted: options.requesterGateComplete ?? true,
			updatedAt: now
		});
		const clubId = await ctx.db.insert('clubs', {
			name: 'Curiosity Club',
			clubCode: options.clubCode ?? 'ABC123',
			discoverable: options.discoverable ?? true,
			abandonedAt: options.abandonedAt,
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

		if (options.requesterIsChildWithConsent) {
			await ctx.db.insert('parentChildConsents', {
				childProfileId: requesterProfileId,
				parentEmail: 'parent@example.com',
				status: options.requesterIsChildWithConsent,
				token: 'token-123',
				createdAt: now,
				updatedAt: now
			});
		}

		return { clubId, guideProfileId, requesterProfileId, learnerRoleId };
	});

	return {
		t,
		guide: t.withIdentity({ subject: 'guide-user' }),
		requester: t.withIdentity({ subject: 'requester-user' }),
		...ids
	};
};

describe('requestToJoin', () => {
	it('rejects non-discoverable clubs', async () => {
		const { requester, clubId } = await seedClubFixture({ discoverable: false });
		await expect(requester.mutation(api.joinRequests.requestToJoin, { clubId })).rejects.toThrow(
			'This club is not open for join requests'
		);
	});

	it('rejects abandoned clubs', async () => {
		const { requester, clubId } = await seedClubFixture({ abandonedAt: Date.now() });
		await expect(requester.mutation(api.joinRequests.requestToJoin, { clubId })).rejects.toThrow(
			'This club is not open for join requests'
		);
	});

	it('rejects when the requester is already a member', async () => {
		const { requester, clubId, requesterProfileId, learnerRoleId, t } = await seedClubFixture();
		await t.run((ctx) =>
			ctx.db.insert('clubMembers', {
				clubId,
				profileId: requesterProfileId,
				roleId: learnerRoleId,
				createdAt: Date.now()
			})
		);
		await expect(requester.mutation(api.joinRequests.requestToJoin, { clubId })).rejects.toThrow(
			'You are already a member of this club'
		);
	});

	it('rejects a duplicate pending request for the same club', async () => {
		const { requester, clubId } = await seedClubFixture();
		await requester.mutation(api.joinRequests.requestToJoin, { clubId });
		await expect(requester.mutation(api.joinRequests.requestToJoin, { clubId })).rejects.toThrow(
			'You already have a pending request to join this club'
		);
	});

	it('creates a joinRequest and a joinRequest room, and notifies guides', async () => {
		const { requester, clubId, guideProfileId, t } = await seedClubFixture();
		const result = await requester.mutation(api.joinRequests.requestToJoin, { clubId });

		const joinRequest = await t.run((ctx) => ctx.db.get(result.joinRequestId));
		const room = await t.run((ctx) => ctx.db.get(result.roomId));
		const notifications = await t.run((ctx) =>
			ctx.db
				.query('notifications')
				.withIndex('by_profile', (q) => q.eq('profileId', guideProfileId))
				.collect()
		);

		expect(joinRequest).toMatchObject({ clubId, status: 'pending' });
		expect(room).toMatchObject({ contextType: 'joinRequest', joinRequestId: result.joinRequestId });
		expect(notifications).toHaveLength(1);
		expect(notifications[0].title).toBe('New join request');
	});
});

describe('chat access for joinRequest rooms', () => {
	it('lets requester and guide read/send while pending, and surfaces the chat without club membership', async () => {
		const { requester, guide, clubId } = await seedClubFixture();
		const { roomId } = await requester.mutation(api.joinRequests.requestToJoin, { clubId });

		const requesterSummaries = await requester.query(api.chat.listRoomSummaries, {});
		const guideSummaries = await guide.query(api.chat.listRoomSummaries, {});

		expect(requesterSummaries).toContainEqual(
			expect.objectContaining({ roomId, contextType: 'joinRequest', canSend: true })
		);
		expect(guideSummaries).toContainEqual(
			expect.objectContaining({ roomId, contextType: 'joinRequest', canSend: true })
		);

		await expect(
			requester.mutation(api.chat.sendMessage, { roomId, content: 'Hi there' })
		).resolves.toMatchObject({ content: 'Hi there' });
		await expect(
			guide.mutation(api.chat.sendMessage, { roomId, content: 'Welcome!' })
		).resolves.toMatchObject({ content: 'Welcome!' });
	});

	it('rejects access for outsiders', async () => {
		const { requester, clubId, t } = await seedClubFixture();
		const { roomId } = await requester.mutation(api.joinRequests.requestToJoin, { clubId });
		await t.run((ctx) =>
			ctx.db.insert('profiles', {
				authUserId: 'outsider-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			})
		);
		const outsider = t.withIdentity({ subject: 'outsider-user' });

		await expect(outsider.query(api.chat.listMessages, { roomId })).rejects.toThrow(
			'You cannot access this chat'
		);
	});

	it('becomes read-only for both parties once decided', async () => {
		const { requester, guide, clubId } = await seedClubFixture();
		const { roomId, joinRequestId } = await requester.mutation(api.joinRequests.requestToJoin, {
			clubId
		});
		await guide.mutation(api.joinRequests.declineJoinRequest, { joinRequestId });

		const requesterSummaries = await requester.query(api.chat.listRoomSummaries, {});
		expect(requesterSummaries).toContainEqual(
			expect.objectContaining({ roomId, canSend: false })
		);
		await expect(
			requester.mutation(api.chat.sendMessage, { roomId, content: 'Still here?' })
		).rejects.toThrow('You can no longer send messages in this chat');
		// History remains readable.
		await expect(requester.query(api.chat.listMessages, { roomId })).resolves.toMatchObject({
			messages: []
		});
	});
});

describe('acceptJoinRequest', () => {
	it('enforces the decide permission', async () => {
		const { requester, clubId } = await seedClubFixture();
		const { joinRequestId } = await requester.mutation(api.joinRequests.requestToJoin, { clubId });
		await expect(
			requester.mutation(api.joinRequests.acceptJoinRequest, { joinRequestId })
		).rejects.toThrow('Permission denied');
	});

	it('creates a club membership immediately when onboarding gates are complete', async () => {
		const { requester, guide, clubId, requesterProfileId, t } = await seedClubFixture({
			requesterGateComplete: true
		});
		const { joinRequestId } = await requester.mutation(api.joinRequests.requestToJoin, { clubId });

		const result = await guide.mutation(api.joinRequests.acceptJoinRequest, { joinRequestId });

		expect(result).toMatchObject({ success: true, membershipCreated: true });
		const membership = await t.run((ctx) =>
			ctx.db
				.query('clubMembers')
				.withIndex('by_club_and_profile', (q) =>
					q.eq('clubId', clubId).eq('profileId', requesterProfileId)
				)
				.first()
		);
		expect(membership).not.toBeNull();
		const joinRequest = await t.run((ctx) => ctx.db.get(joinRequestId));
		expect(joinRequest?.status).toBe('accepted');
	});

	it('defers membership and records a pendingClubJoins row when gates are incomplete (adult, pledge not agreed)', async () => {
		const { requester, guide, clubId, requesterProfileId, t } = await seedClubFixture({
			requesterGateComplete: false,
			clubCode: 'XYZ789'
		});
		const { joinRequestId } = await requester.mutation(api.joinRequests.requestToJoin, { clubId });

		const result = await guide.mutation(api.joinRequests.acceptJoinRequest, { joinRequestId });

		expect(result).toMatchObject({ success: true, membershipCreated: false });
		const membership = await t.run((ctx) =>
			ctx.db
				.query('clubMembers')
				.withIndex('by_club_and_profile', (q) =>
					q.eq('clubId', clubId).eq('profileId', requesterProfileId)
				)
				.first()
		);
		expect(membership).toBeNull();
		const pendingJoin = await t.run((ctx) =>
			ctx.db
				.query('pendingClubJoins')
				.withIndex('by_profile', (q) => q.eq('profileId', requesterProfileId))
				.first()
		);
		expect(pendingJoin).toMatchObject({ clubId, source: 'map_request' });
		const joinRequest = await t.run((ctx) => ctx.db.get(joinRequestId));
		expect(joinRequest?.status).toBe('accepted');
	});

	it('defers membership for an under-16 requester awaiting parent consent', async () => {
		const { requester, guide, clubId, requesterProfileId, t } = await seedClubFixture({
			requesterIsChildWithConsent: 'pending',
			clubCode: 'KID123'
		});
		const { joinRequestId } = await requester.mutation(api.joinRequests.requestToJoin, { clubId });

		const result = await guide.mutation(api.joinRequests.acceptJoinRequest, { joinRequestId });

		expect(result).toMatchObject({ success: true, membershipCreated: false });
		const pendingJoin = await t.run((ctx) =>
			ctx.db
				.query('pendingClubJoins')
				.withIndex('by_profile', (q) => q.eq('profileId', requesterProfileId))
				.first()
		);
		expect(pendingJoin).toMatchObject({ clubId, source: 'map_request' });
	});

	it('rejects deciding a request twice', async () => {
		const { requester, guide, clubId } = await seedClubFixture();
		const { joinRequestId } = await requester.mutation(api.joinRequests.requestToJoin, { clubId });
		await guide.mutation(api.joinRequests.acceptJoinRequest, { joinRequestId });
		await expect(
			guide.mutation(api.joinRequests.acceptJoinRequest, { joinRequestId })
		).rejects.toThrow('This join request has already been decided');
	});
});

describe('declineJoinRequest', () => {
	it('enforces the decide permission', async () => {
		const { requester, clubId } = await seedClubFixture();
		const { joinRequestId } = await requester.mutation(api.joinRequests.requestToJoin, { clubId });
		await expect(
			requester.mutation(api.joinRequests.declineJoinRequest, { joinRequestId })
		).rejects.toThrow('Permission denied');
	});

	it('marks the request declined and notifies the requester', async () => {
		const { requester, guide, clubId, requesterProfileId, t } = await seedClubFixture();
		const { joinRequestId } = await requester.mutation(api.joinRequests.requestToJoin, { clubId });

		await guide.mutation(api.joinRequests.declineJoinRequest, { joinRequestId });

		const joinRequest = await t.run((ctx) => ctx.db.get(joinRequestId));
		expect(joinRequest?.status).toBe('declined');
		const notifications = await t.run((ctx) =>
			ctx.db
				.query('notifications')
				.withIndex('by_profile', (q) => q.eq('profileId', requesterProfileId))
				.collect()
		);
		expect(notifications.some((n) => n.title === 'Join request declined')).toBe(true);
	});
});

describe('cancelJoinRequest', () => {
	it('lets only the requester cancel a pending request', async () => {
		const { requester, guide, clubId } = await seedClubFixture();
		const { joinRequestId } = await requester.mutation(api.joinRequests.requestToJoin, { clubId });

		await expect(
			guide.mutation(api.joinRequests.cancelJoinRequest, { joinRequestId })
		).rejects.toThrow('You can only cancel your own join request');

		const result = await requester.mutation(api.joinRequests.cancelJoinRequest, { joinRequestId });
		expect(result).toMatchObject({ success: true });
	});

	it('rejects cancelling a non-pending request', async () => {
		const { requester, guide, clubId } = await seedClubFixture();
		const { joinRequestId } = await requester.mutation(api.joinRequests.requestToJoin, { clubId });
		await guide.mutation(api.joinRequests.declineJoinRequest, { joinRequestId });

		await expect(
			requester.mutation(api.joinRequests.cancelJoinRequest, { joinRequestId })
		).rejects.toThrow('This join request is no longer pending');
	});
});

describe('getJoinRequestForRoom', () => {
	it('returns decide/requester flags for participants', async () => {
		const { requester, guide, clubId } = await seedClubFixture();
		const { roomId } = await requester.mutation(api.joinRequests.requestToJoin, { clubId });

		const asRequester = await requester.query(api.joinRequests.getJoinRequestForRoom, { roomId });
		const asGuide = await guide.query(api.joinRequests.getJoinRequestForRoom, { roomId });

		expect(asRequester).toMatchObject({ isRequester: true, canDecide: false, status: 'pending' });
		expect(asGuide).toMatchObject({ isRequester: false, canDecide: true, status: 'pending' });
	});
});
