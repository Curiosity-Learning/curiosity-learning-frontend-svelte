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
			roomName: 'Updated club'
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
				doneDate: now,
				createdByProfileId: viewerProfileId,
				createdAt: now,
				updatedAt: now
			});
			const removedProjectId = await ctx.db.insert('projects', {
				name: 'Removed project',
				dueDate: now,
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
				createdByProfileId: otherProfileId,
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('projectClubs', {
				projectId,
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
