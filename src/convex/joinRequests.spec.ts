/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { autoCreateJoinRequestFromNextPath, extractPendingRequestJoinClubId } from './joinRequests';

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
		expect(requesterSummaries).toContainEqual(expect.objectContaining({ roomId, canSend: false }));
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

		expect(asRequester).toMatchObject({
			isRequester: true,
			canDecide: false,
			status: 'pending',
			clubDiscoverable: true
		});
		expect(asGuide).toMatchObject({ isRequester: false, canDecide: true, status: 'pending' });
	});
});

describe('extractPendingRequestJoinClubId', () => {
	it('extracts the clubId segment from a /clubs/{clubId} path', () => {
		expect(extractPendingRequestJoinClubId('/clubs/abc123')).toBe('abc123');
	});

	it('strips a trailing query string or hash', () => {
		expect(extractPendingRequestJoinClubId('/clubs/abc123?foo=bar')).toBe('abc123');
		expect(extractPendingRequestJoinClubId('/clubs/abc123#section')).toBe('abc123');
	});

	it('returns undefined for unrelated paths', () => {
		expect(extractPendingRequestJoinClubId('/onboarding/join-club/ABCDEF')).toBeUndefined();
		expect(extractPendingRequestJoinClubId('/')).toBeUndefined();
		expect(extractPendingRequestJoinClubId(undefined)).toBeUndefined();
		expect(extractPendingRequestJoinClubId(null)).toBeUndefined();
	});

	it('returns undefined when the clubId segment is empty', () => {
		expect(extractPendingRequestJoinClubId('/clubs/')).toBeUndefined();
	});
});

// CL-711 CEO feedback item 6: a logged-out visitor who taps "Request to Join" is redirected to
// sign-up before any request can exist. `autoCreateJoinRequestFromNextPath` is the auto-completion
// path invoked once the account exists (auth.ts's completeSignupProfile for adults,
// childSignup.ts's approveConsent for minors) so the visitor never has to tap "Request to Join"
// again.
describe('autoCreateJoinRequestFromNextPath', () => {
	it('creates a join request, room, and guide notification when nextPath points at the club', async () => {
		const { t, clubId, guideProfileId, requesterProfileId } = await seedClubFixture();

		await t.run((ctx) =>
			autoCreateJoinRequestFromNextPath(ctx, `/clubs/${clubId}`, requesterProfileId)
		);

		const joinRequest = await t.run((ctx) =>
			ctx.db
				.query('joinRequests')
				.withIndex('by_club_and_requester', (q) =>
					q.eq('clubId', clubId).eq('requesterProfileId', requesterProfileId)
				)
				.first()
		);
		expect(joinRequest).toMatchObject({ clubId, status: 'pending' });

		const room = await t.run((ctx) =>
			ctx.db
				.query('rooms')
				.withIndex('by_join_request_id', (q) => q.eq('joinRequestId', joinRequest!._id))
				.first()
		);
		expect(room).toMatchObject({ contextType: 'joinRequest' });

		const notifications = await t.run((ctx) =>
			ctx.db
				.query('notifications')
				.withIndex('by_profile', (q) => q.eq('profileId', guideProfileId))
				.collect()
		);
		expect(notifications.some((n) => n.title === 'New join request')).toBe(true);
	});

	it('is a no-op when nextPath does not point at a club preview', async () => {
		const { t, requesterProfileId } = await seedClubFixture();

		await t.run((ctx) =>
			autoCreateJoinRequestFromNextPath(ctx, '/onboarding/join-club/ABCDEF', requesterProfileId)
		);
		await t.run((ctx) => autoCreateJoinRequestFromNextPath(ctx, undefined, requesterProfileId));

		const requests = await t.run((ctx) => ctx.db.query('joinRequests').collect());
		expect(
			requests.filter((request) => request.requesterProfileId === requesterProfileId)
		).toHaveLength(0);
	});

	it('is a no-op when the clubId segment does not resolve to a real club', async () => {
		const { t, requesterProfileId } = await seedClubFixture();

		await t.run((ctx) =>
			autoCreateJoinRequestFromNextPath(ctx, '/clubs/not-a-real-id', requesterProfileId)
		);

		const requests = await t.run((ctx) => ctx.db.query('joinRequests').collect());
		expect(
			requests.filter((request) => request.requesterProfileId === requesterProfileId)
		).toHaveLength(0);
	});

	it('is a no-op when the club is not discoverable', async () => {
		const { t, clubId, requesterProfileId } = await seedClubFixture({ discoverable: false });

		await t.run((ctx) =>
			autoCreateJoinRequestFromNextPath(ctx, `/clubs/${clubId}`, requesterProfileId)
		);

		const requests = await t.run((ctx) =>
			ctx.db
				.query('joinRequests')
				.withIndex('by_club_and_requester', (q) =>
					q.eq('clubId', clubId).eq('requesterProfileId', requesterProfileId)
				)
				.collect()
		);
		expect(requests).toHaveLength(0);
	});

	it('is a no-op when the club has been abandoned', async () => {
		const { t, clubId, requesterProfileId } = await seedClubFixture({ abandonedAt: Date.now() });

		await t.run((ctx) =>
			autoCreateJoinRequestFromNextPath(ctx, `/clubs/${clubId}`, requesterProfileId)
		);

		const requests = await t.run((ctx) =>
			ctx.db
				.query('joinRequests')
				.withIndex('by_club_and_requester', (q) =>
					q.eq('clubId', clubId).eq('requesterProfileId', requesterProfileId)
				)
				.collect()
		);
		expect(requests).toHaveLength(0);
	});

	it('is a no-op when the profile is already a member of the club', async () => {
		const { t, clubId, requesterProfileId, learnerRoleId } = await seedClubFixture();
		await t.run((ctx) =>
			ctx.db.insert('clubMembers', {
				clubId,
				profileId: requesterProfileId,
				roleId: learnerRoleId,
				createdAt: Date.now()
			})
		);

		await t.run((ctx) =>
			autoCreateJoinRequestFromNextPath(ctx, `/clubs/${clubId}`, requesterProfileId)
		);

		const requests = await t.run((ctx) =>
			ctx.db
				.query('joinRequests')
				.withIndex('by_club_and_requester', (q) =>
					q.eq('clubId', clubId).eq('requesterProfileId', requesterProfileId)
				)
				.collect()
		);
		expect(requests).toHaveLength(0);
	});

	it('is a no-op (and does not throw) when a pending request already exists', async () => {
		const { t, requester, clubId, requesterProfileId } = await seedClubFixture();
		await requester.mutation(api.joinRequests.requestToJoin, { clubId });

		await t.run((ctx) =>
			autoCreateJoinRequestFromNextPath(ctx, `/clubs/${clubId}`, requesterProfileId)
		);

		const requests = await t.run((ctx) =>
			ctx.db
				.query('joinRequests')
				.withIndex('by_club_and_requester', (q) =>
					q.eq('clubId', clubId).eq('requesterProfileId', requesterProfileId)
				)
				.collect()
		);
		expect(requests).toHaveLength(1);
	});
});

// CL-690 CEO review item F: the no-club page needs to list join requests alongside Start Club
// applications, each with a roomId to link straight to its chat.
describe('listMyJoinRequests', () => {
	it('returns the requester own join requests with club name, status, and roomId', async () => {
		const { requester, clubId } = await seedClubFixture();
		const { roomId, joinRequestId } = await requester.mutation(api.joinRequests.requestToJoin, {
			clubId
		});

		const result = await requester.query(api.joinRequests.listMyJoinRequests, {});

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			joinRequestId,
			roomId,
			clubId,
			clubName: 'Curiosity Club',
			status: 'pending'
		});
	});

	it("does not surface another profile's join requests", async () => {
		const { guide, clubId } = await seedClubFixture();
		await guide.query(api.joinRequests.listMyJoinRequests, {}).then((result) => {
			expect(result).toHaveLength(0);
		});
		expect(clubId).toBeDefined();
	});
});

// CL-695/725 CEO review items A and E: the chat member overview and the chat-list
// open/action-needed/closed badge for join_request rooms.
describe('join request chat overview and action state', () => {
	it('lists the requester and deciding guides as participants, highlighting the requester for the guide', async () => {
		const { requester, guide, clubId, requesterProfileId, guideProfileId } =
			await seedClubFixture();
		const { roomId } = await requester.mutation(api.joinRequests.requestToJoin, { clubId });

		const asGuide = await guide.query(api.chat.getRoomParticipants, { roomId });
		expect(asGuide.primaryProfileId).toBe(requesterProfileId);
		expect(asGuide.participants).toContainEqual(
			expect.objectContaining({ profileId: requesterProfileId, roleLabel: 'Requester' })
		);
		expect(asGuide.participants).toContainEqual(
			expect.objectContaining({ profileId: guideProfileId, roleLabel: 'Guide' })
		);

		const asRequester = await requester.query(api.chat.getRoomParticipants, { roomId });
		expect(asRequester.primaryProfileId).toBeNull();
	});

	it('flags actionState as action_needed for the deciding guide and open for the waiting requester', async () => {
		const { requester, guide, clubId } = await seedClubFixture();
		const { roomId } = await requester.mutation(api.joinRequests.requestToJoin, { clubId });

		const guideSummaries = await guide.query(api.chat.listRoomSummaries, {});
		const requesterSummaries = await requester.query(api.chat.listRoomSummaries, {});

		expect(guideSummaries).toContainEqual(
			expect.objectContaining({ roomId, actionState: 'action_needed' })
		);
		expect(requesterSummaries).toContainEqual(
			expect.objectContaining({ roomId, actionState: 'open' })
		);
	});

	it('flags actionState as closed for both parties once decided', async () => {
		const { requester, guide, clubId } = await seedClubFixture();
		const { roomId, joinRequestId } = await requester.mutation(api.joinRequests.requestToJoin, {
			clubId
		});
		await guide.mutation(api.joinRequests.declineJoinRequest, { joinRequestId });

		const guideSummaries = await guide.query(api.chat.listRoomSummaries, {});
		const requesterSummaries = await requester.query(api.chat.listRoomSummaries, {});

		expect(guideSummaries).toContainEqual(
			expect.objectContaining({ roomId, actionState: 'closed' })
		);
		expect(requesterSummaries).toContainEqual(
			expect.objectContaining({ roomId, actionState: 'closed' })
		);
	});
});
