/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const seedClubChatFixture = async (options: { viewerLeftAt?: number } = {}) => {
	const base = convexTest(schema, modules);
	const ids = await base.run(async (ctx) => {
		const now = Date.now();
		const roleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: ['project:read'],
			order: 0,
			createdAt: now
		});
		const viewerProfileId = await ctx.db.insert('profiles', {
			authUserId: 'viewer-user',
			username: 'viewer',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const otherProfileId = await ctx.db.insert('profiles', {
			authUserId: 'other-user',
			firstName: 'Other',
			lastName: 'Person',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const clubId = await ctx.db.insert('clubs', {
			name: 'Club room',
			discoverable: false,
			createdByProfileId: viewerProfileId,
			createdAt: now,
			updatedAt: now
		});
		const roomId = await ctx.db.insert('rooms', {
			contextType: 'club',
			clubId
		});
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: viewerProfileId,
			roleId,
			...(options.viewerLeftAt ? { leftAt: options.viewerLeftAt } : {}),
			createdAt: now
		});
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: otherProfileId,
			roleId,
			createdAt: now
		});
		const firstMessageId = await ctx.db.insert('messages', {
			roomId,
			profileId: otherProfileId,
			content: 'Welcome'
		});

		return {
			clubId,
			firstMessageId,
			otherProfileId,
			roomId,
			viewerProfileId
		};
	});

	return {
		base,
		viewer: base.withIdentity({ subject: 'viewer-user' }),
		...ids
	};
};

describe('context room chat', () => {
	it('stores only essential room and message fields', async () => {
		const { base, firstMessageId, roomId } = await seedClubChatFixture();

		const records = await base.run(async (ctx) => ({
			message: await ctx.db.get(firstMessageId),
			room: await ctx.db.get(roomId)
		}));

		expect(Object.keys(records.room ?? {}).sort()).toEqual(
			['_creationTime', '_id', 'clubId', 'contextType'].sort()
		);
		expect(Object.keys(records.message ?? {}).sort()).toEqual(
			['_creationTime', '_id', 'content', 'profileId', 'roomId'].sort()
		);
	});

	it('derives room summaries from context access and messages', async () => {
		const { base, clubId, roomId, viewer } = await seedClubChatFixture();
		await base.run((ctx) => ctx.db.patch(clubId, { name: 'Updated club', updatedAt: Date.now() }));

		const summaries = await viewer.query(api.chat.listRoomSummaries, {});

		expect(summaries).toHaveLength(1);
		expect(summaries[0]).toMatchObject({
			canSend: true,
			contextType: 'club',
			lastMessagePreview: 'Welcome',
			roomId,
			roomName: 'Updated club',
			// CL-695/725 CEO review item E: the chat-list badge state.
			actionState: 'open'
		});
		expect('participantDisplayNames' in summaries[0]).toBe(false);
	});

	it('rejects room access for a profile outside the context', async () => {
		const { base, roomId } = await seedClubChatFixture();
		await base.run(async (ctx) => {
			await ctx.db.insert('profiles', {
				authUserId: 'outsider-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
		});
		const outsider = base.withIdentity({ subject: 'outsider-user' });

		await expect(outsider.query(api.chat.listMessages, { roomId })).rejects.toThrow(
			'You cannot access this chat'
		);
		await expect(
			outsider.mutation(api.chat.sendMessage, { roomId, content: 'Nope' })
		).rejects.toThrow('You cannot access this chat');
	});

	it('keeps history readable but blocks sending after context removal', async () => {
		const { roomId, viewer } = await seedClubChatFixture({ viewerLeftAt: Date.now() });

		const summaries = await viewer.query(api.chat.listRoomSummaries, {});
		const result = await viewer.query(api.chat.listMessages, { roomId });

		expect(summaries).toHaveLength(1);
		expect(summaries[0].canSend).toBe(false);
		expect(summaries[0].sendBlockedReason).toBe('not_participant');
		expect(summaries[0].actionState).toBe('closed');
		expect(result.messages.map((entry) => entry.content)).toEqual(['Welcome']);
		expect(result.hasMore).toBe(false);
		await expect(
			viewer.mutation(api.chat.sendMessage, { roomId, content: 'I should not send' })
		).rejects.toThrow('You can no longer send messages in this chat');
	});

	it('accepts only non-empty text up to 1,000 characters', async () => {
		const { viewer, roomId, viewerProfileId } = await seedClubChatFixture();

		await expect(
			viewer.mutation(api.chat.sendMessage, {
				roomId,
				content: 'Text with a legacy attachment',
				mediaUrl: 'https://example.com/image.png'
			} as never)
		).rejects.toThrow();
		await expect(viewer.mutation(api.chat.sendMessage, { roomId, content: '   ' })).rejects.toThrow(
			'Message content is required'
		);
		await expect(
			viewer.mutation(api.chat.sendMessage, { roomId, content: 'x'.repeat(1_001) })
		).rejects.toThrow('Messages cannot exceed 1000 characters');

		const message = await viewer.mutation(api.chat.sendMessage, {
			roomId,
			content: `  ${'x'.repeat(1_000)}  `
		});

		expect(message).toMatchObject({
			content: 'x'.repeat(1_000),
			profileId: viewerProfileId,
			roomId
		});
		expect(Object.keys(message ?? {}).sort()).toEqual(
			['_creationTime', '_id', 'content', 'profileId', 'roomId'].sort()
		);
	});

	it('returns persistent message history in creation order', async () => {
		const { viewer, firstMessageId, roomId } = await seedClubChatFixture();

		const sent = await viewer.mutation(api.chat.sendMessage, {
			roomId,
			content: 'Second message'
		});
		const result = await viewer.query(api.chat.listMessages, { roomId });

		expect(result.messages.map((message) => message._id)).toEqual([firstMessageId, sent?._id]);
		expect(result.messages.map((message) => message.content)).toEqual([
			'Welcome',
			'Second message'
		]);
		expect(result.hasMore).toBe(false);

		const latestPage = await viewer.query(api.chat.listMessages, { roomId, limit: 1 });

		expect(latestPage.messages.map((message) => message._id)).toEqual([sent?._id]);
		expect(latestPage.hasMore).toBe(true);
	});

	// CL-695/725 CEO review item B: sender attribution for every message, so the frontend can show
	// name/avatar on inbound messages without a second round-trip per sender.
	it('attaches sender name and avatar to every message', async () => {
		const { viewer, roomId } = await seedClubChatFixture();

		const result = await viewer.query(api.chat.listMessages, { roomId });

		expect(result.messages).toHaveLength(1);
		expect(result.messages[0]).toMatchObject({
			content: 'Welcome',
			senderName: 'Other Person',
			senderAvatarUrl: null
		});
	});

	// CL-695/725 CEO review item A: the chat member overview.
	it('lists active club members as participants for a club room', async () => {
		const { viewer, roomId, viewerProfileId, otherProfileId } = await seedClubChatFixture();

		const result = await viewer.query(api.chat.getRoomParticipants, { roomId });

		expect(result.contextType).toBe('club');
		expect(result.primaryProfileId).toBeNull();
		expect(result.participants).toContainEqual(
			expect.objectContaining({ profileId: viewerProfileId, roleLabel: 'Guide' })
		);
		expect(result.participants).toContainEqual(
			expect.objectContaining({ profileId: otherProfileId, name: 'Other Person', roleLabel: 'Guide' })
		);
	});

	it('excludes a member who left from the participants list', async () => {
		const { viewer, roomId, otherProfileId } = await seedClubChatFixture({
			viewerLeftAt: Date.now()
		});

		const result = await viewer.query(api.chat.getRoomParticipants, { roomId });

		// The viewer left, so only the other (still-active) member should remain.
		expect(result.participants).toHaveLength(1);
		expect(result.participants).toContainEqual(
			expect.objectContaining({ profileId: otherProfileId })
		);
	});

	it('allows done project members to chat and removed project members to read only', async () => {
		const base = convexTest(schema, modules);
		const ids = await base.run(async (ctx) => {
			const now = Date.now();
			const roleId = await ctx.db.insert('projectRoles', {
				key: 'contributor',
				name: 'Contributor',
				permissions: ['project:read'],
				order: 0,
				createdAt: now
			});
			const viewerProfileId = await ctx.db.insert('profiles', {
				authUserId: 'viewer-user',
				username: 'viewer',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const otherProfileId = await ctx.db.insert('profiles', {
				authUserId: 'other-user',
				username: 'other',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const doneProjectId = await ctx.db.insert('projects', {
				name: 'Done project',
				dueDate: now,
			visibility: 'clubs',
				createdByProfileId: viewerProfileId,
				createdAt: now,
				updatedAt: now
			});
			const removedProjectId = await ctx.db.insert('projects', {
				name: 'Removed project',
				dueDate: now,
			visibility: 'clubs',
				createdByProfileId: otherProfileId,
				createdAt: now,
				updatedAt: now
			});
			const doneRoomId = await ctx.db.insert('rooms', {
				contextType: 'project',
				projectId: doneProjectId
			});
			const removedRoomId = await ctx.db.insert('rooms', {
				contextType: 'project',
				projectId: removedProjectId
			});
			await ctx.db.insert('projectMembers', {
				projectId: doneProjectId,
				profileId: viewerProfileId,
				roleId,
				createdAt: now
			});
			await ctx.db.insert('projectMembers', {
				projectId: removedProjectId,
				profileId: viewerProfileId,
				roleId,
				leftAt: now,
				createdAt: now
			});
			await ctx.db.insert('messages', {
				roomId: removedRoomId,
				profileId: otherProfileId,
				content: 'Historical project message'
			});

			return { doneRoomId, removedRoomId, viewerProfileId };
		});
		const viewer = base.withIdentity({ subject: 'viewer-user' });

		const summaries = await viewer.query(api.chat.listRoomSummaries, {});
		const sent = await viewer.mutation(api.chat.sendMessage, {
			roomId: ids.doneRoomId,
			content: 'Still active'
		});
		const removedMessages = await viewer.query(api.chat.listMessages, {
			roomId: ids.removedRoomId
		});

		expect(summaries).toContainEqual(
			expect.objectContaining({
				canSend: true,
				roomId: ids.doneRoomId,
				roomName: 'Done project'
			})
		);
		expect(summaries).toContainEqual(
			expect.objectContaining({
				canSend: false,
				roomId: ids.removedRoomId,
				roomName: 'Removed project'
			})
		);
		expect(sent).toMatchObject({
			content: 'Still active',
			profileId: ids.viewerProfileId,
			roomId: ids.doneRoomId
		});
		expect(removedMessages.messages.map((entry) => entry.content)).toEqual([
			'Historical project message'
		]);
		await expect(
			viewer.mutation(api.chat.sendMessage, { roomId: ids.removedRoomId, content: 'Blocked' })
		).rejects.toThrow('You can no longer send messages in this chat');
	});

	it('reports not_participant reason for a removed project member and blocks sending', async () => {
		const base = convexTest(schema, modules);
		const ids = await base.run(async (ctx) => {
			const now = Date.now();
			const roleId = await ctx.db.insert('projectRoles', {
				key: 'contributor',
				name: 'Contributor',
				permissions: ['project:read'],
				order: 0,
				createdAt: now
			});
			const viewerProfileId = await ctx.db.insert('profiles', {
				authUserId: 'viewer-user',
				username: 'viewer',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const otherProfileId = await ctx.db.insert('profiles', {
				authUserId: 'other-user',
				username: 'other',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const projectId = await ctx.db.insert('projects', {
				name: 'Left project',
				dueDate: now,
			visibility: 'clubs',
				createdByProfileId: otherProfileId,
				createdAt: now,
				updatedAt: now
			});
			const roomId = await ctx.db.insert('rooms', { contextType: 'project', projectId });
			await ctx.db.insert('projectMembers', {
				projectId,
				profileId: viewerProfileId,
				roleId,
				leftAt: now,
				createdAt: now
			});
			await ctx.db.insert('projectMembers', {
				projectId,
				profileId: otherProfileId,
				roleId,
				createdAt: now
			});

			return { roomId, viewerProfileId };
		});
		const viewer = base.withIdentity({ subject: 'viewer-user' });

		const summaries = await viewer.query(api.chat.listRoomSummaries, {});

		expect(summaries).toContainEqual(
			expect.objectContaining({
				roomId: ids.roomId,
				canSend: false,
				sendBlockedReason: 'not_participant'
			})
		);
		await expect(
			viewer.mutation(api.chat.sendMessage, { roomId: ids.roomId, content: 'Blocked' })
		).rejects.toThrow('You can no longer send messages in this chat');
	});

	it('blocks sending for everyone once a project is archived (all current members Done)', async () => {
		const base = convexTest(schema, modules);
		const ids = await base.run(async (ctx) => {
			const now = Date.now();
			const memberRoleId = await ctx.db.insert('projectRoles', {
				key: 'contributor',
				name: 'Contributor',
				permissions: ['project:read'],
				order: 0,
				createdAt: now
			});
			const guideRoleId = await ctx.db.insert('clubRoles', {
				key: 'guide',
				name: 'Guide',
				permissions: ['project:read'],
				order: 0,
				createdAt: now
			});
			const memberProfileId = await ctx.db.insert('profiles', {
				authUserId: 'member-user',
				username: 'member',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const observerProfileId = await ctx.db.insert('profiles', {
				authUserId: 'observer-user',
				username: 'observer',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const clubId = await ctx.db.insert('clubs', {
				name: 'Observer club',
				discoverable: false,
				createdByProfileId: observerProfileId,
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('clubMembers', {
				clubId,
				profileId: observerProfileId,
				roleId: guideRoleId,
				createdAt: now
			});
			const projectId = await ctx.db.insert('projects', {
				name: 'Archived project',
				dueDate: now,
			visibility: 'clubs',
				createdByProfileId: memberProfileId,
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('projectAttributions', {
				projectId,
				profileId: memberProfileId,
				clubId,
				createdAt: now
			});
			const roomId = await ctx.db.insert('rooms', { contextType: 'project', projectId });
			await ctx.db.insert('projectMembers', {
				projectId,
				profileId: memberProfileId,
				roleId: memberRoleId,
				doneDate: now,
				createdAt: now
			});

			return { roomId, memberProfileId };
		});
		const member = base.withIdentity({ subject: 'member-user' });
		const observer = base.withIdentity({ subject: 'observer-user' });

		const memberSummaries = await member.query(api.chat.listRoomSummaries, {});
		const observerSummaries = await observer.query(api.chat.listRoomSummaries, {});

		expect(memberSummaries).toContainEqual(
			expect.objectContaining({
				roomId: ids.roomId,
				canSend: false,
				sendBlockedReason: 'archived'
			})
		);
		expect(observerSummaries).toContainEqual(
			expect.objectContaining({
				roomId: ids.roomId,
				canSend: false,
				sendBlockedReason: 'archived'
			})
		);
		await expect(
			member.mutation(api.chat.sendMessage, { roomId: ids.roomId, content: 'Blocked' })
		).rejects.toThrow('You can no longer send messages in this chat');
		await expect(
			observer.mutation(api.chat.sendMessage, { roomId: ids.roomId, content: 'Blocked' })
		).rejects.toThrow('You can no longer send messages in this chat');
	});

	it('lets a Done-but-not-archived project member keep sending', async () => {
		const base = convexTest(schema, modules);
		const ids = await base.run(async (ctx) => {
			const now = Date.now();
			const roleId = await ctx.db.insert('projectRoles', {
				key: 'contributor',
				name: 'Contributor',
				permissions: ['project:read'],
				order: 0,
				createdAt: now
			});
			const doneProfileId = await ctx.db.insert('profiles', {
				authUserId: 'done-user',
				username: 'done',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const activeProfileId = await ctx.db.insert('profiles', {
				authUserId: 'active-user',
				username: 'active',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const projectId = await ctx.db.insert('projects', {
				name: 'Partially done project',
				dueDate: now,
			visibility: 'clubs',
				createdByProfileId: doneProfileId,
				createdAt: now,
				updatedAt: now
			});
			const roomId = await ctx.db.insert('rooms', { contextType: 'project', projectId });
			await ctx.db.insert('projectMembers', {
				projectId,
				profileId: doneProfileId,
				roleId,
				doneDate: now,
				createdAt: now
			});
			await ctx.db.insert('projectMembers', {
				projectId,
				profileId: activeProfileId,
				roleId,
				createdAt: now
			});

			return { roomId, doneProfileId };
		});
		const doneMember = base.withIdentity({ subject: 'done-user' });

		const summaries = await doneMember.query(api.chat.listRoomSummaries, {});
		const sent = await doneMember.mutation(api.chat.sendMessage, {
			roomId: ids.roomId,
			content: 'Still able to chat'
		});

		expect(summaries).toContainEqual(
			expect.objectContaining({
				roomId: ids.roomId,
				canSend: true,
				sendBlockedReason: null
			})
		);
		expect(sent).toMatchObject({ content: 'Still able to chat', profileId: ids.doneProfileId });
	});

	it('includes project guide observers without project membership', async () => {
		const base = convexTest(schema, modules);
		const ids = await base.run(async (ctx) => {
			const now = Date.now();
			const guideRoleId = await ctx.db.insert('clubRoles', {
				key: 'guide',
				name: 'Guide',
				permissions: ['project:read'],
				order: 0,
				createdAt: now
			});
			const viewerProfileId = await ctx.db.insert('profiles', {
				authUserId: 'viewer-user',
				username: 'viewer',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const otherProfileId = await ctx.db.insert('profiles', {
				authUserId: 'other-user',
				username: 'other',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const clubId = await ctx.db.insert('clubs', {
				name: 'Observer club',
				discoverable: false,
				createdByProfileId: viewerProfileId,
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('clubMembers', {
				clubId,
				profileId: viewerProfileId,
				roleId: guideRoleId,
				createdAt: now
			});
			const projectId = await ctx.db.insert('projects', {
				name: 'Observed project',
				dueDate: now,
			visibility: 'clubs',
				createdByProfileId: otherProfileId,
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('projectAttributions', {
				projectId,
				profileId: otherProfileId,
				clubId,
				createdAt: now
			});
			const roomId = await ctx.db.insert('rooms', {
				contextType: 'project',
				projectId
			});

			return { projectId, roomId, viewerProfileId };
		});
		const viewer = base.withIdentity({ subject: 'viewer-user' });

		const summaries = await viewer.query(api.chat.listRoomSummaries, {});
		const projectMember = await base.run((ctx) =>
			ctx.db
				.query('projectMembers')
				.withIndex('by_project_and_profile', (q) =>
					q.eq('projectId', ids.projectId).eq('profileId', ids.viewerProfileId)
				)
				.first()
		);
		const sent = await viewer.mutation(api.chat.sendMessage, {
			roomId: ids.roomId,
			content: 'Observer message'
		});

		expect(projectMember).toBeNull();
		expect(summaries).toContainEqual(
			expect.objectContaining({
				canSend: true,
				contextType: 'project',
				roomId: ids.roomId,
				roomName: 'Observed project'
			})
		);
		expect(sent).toMatchObject({
			content: 'Observer message',
			profileId: ids.viewerProfileId,
			roomId: ids.roomId
		});
	});

	it('includes club application applicants and reviewers', async () => {
		const base = convexTest(schema, modules);
		const ids = await base.run(async (ctx) => {
			const now = Date.now();
			const applicantProfileId = await ctx.db.insert('profiles', {
				authUserId: 'applicant-user',
				username: 'applicant',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const reviewerProfileId = await ctx.db.insert('profiles', {
				authUserId: 'reviewer-user',
				username: 'reviewer',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const applicationId = await ctx.db.insert('clubApplications', {
				applicantProfileId,
				status: 'pending',
				name: 'Application chat',
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('applicationReviews', {
				applicationId,
				reviewerProfileId,
				score: 8,
				note: 'Looks good',
				createdAt: now,
				updatedAt: now
			});
			const roomId = await ctx.db.insert('rooms', {
				contextType: 'clubApplication',
				clubApplicationId: applicationId
			});

			return { roomId };
		});
		const applicant = base.withIdentity({ subject: 'applicant-user' });
		const reviewer = base.withIdentity({ subject: 'reviewer-user' });

		const applicantSummaries = await applicant.query(api.chat.listRoomSummaries, {});
		const reviewerSummaries = await reviewer.query(api.chat.listRoomSummaries, {});

		expect(applicantSummaries).toContainEqual(
			expect.objectContaining({
				contextType: 'clubApplication',
				roomId: ids.roomId,
				roomName: 'Application chat'
			})
		);
		expect(reviewerSummaries).toContainEqual(
			expect.objectContaining({
				contextType: 'clubApplication',
				roomId: ids.roomId,
				roomName: 'Application chat'
			})
		);
	});
});
