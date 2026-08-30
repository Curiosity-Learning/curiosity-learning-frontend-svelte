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

		// CEO review (CL-695 round 3, item 1): the applicant has no 1:1 counterpart from their own
		// point of view (they ARE the applicant), so their list entry keeps the plain application
		// name and no club-name fallback subtitle.
		expect(applicantSummaries).toContainEqual(
			expect.objectContaining({
				contextType: 'clubApplication',
				roomId: ids.roomId,
				roomName: 'Application chat',
				roomSubtitle: null
			})
		);
		// The reviewer's counterpart IS the applicant, so the list title becomes the applicant's
		// name (mirroring the chat header), with the application name as the fallback subtitle.
		expect(reviewerSummaries).toContainEqual(
			expect.objectContaining({
				contextType: 'clubApplication',
				roomId: ids.roomId,
				roomName: 'applicant',
				roomSubtitle: 'Application chat'
			})
		);
	});

	it('treats staff who wrote in an application room as real participants with their own chat list entry', async () => {
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
			const staffProfileId = await ctx.db.insert('profiles', {
				authUserId: 'staff-user',
				firstName: 'Staff',
				lastName: 'Person',
				globalRole: 'admin',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const otherStaffProfileId = await ctx.db.insert('profiles', {
				authUserId: 'other-staff-user',
				username: 'otherstaff',
				globalRole: 'admin',
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
			const roomId = await ctx.db.insert('rooms', {
				contextType: 'clubApplication',
				clubApplicationId: applicationId
			});

			return { applicantProfileId, staffProfileId, otherStaffProfileId, roomId };
		});
		const applicant = base.withIdentity({ subject: 'applicant-user' });
		const staff = base.withIdentity({ subject: 'staff-user' });
		const otherStaff = base.withIdentity({ subject: 'other-staff-user' });

		// Before anyone writes: staff are invisible — not participants, no chat list entry.
		let participants = await applicant.query(api.chat.getRoomParticipants, {
			roomId: ids.roomId
		});
		expect(
			participants.participants.some((p) => p.profileId === ids.staffProfileId)
		).toBe(false);
		expect(await staff.query(api.chat.listRoomSummaries, {})).toEqual([]);

		await staff.mutation(api.chat.sendMessage, { roomId: ids.roomId, content: 'Hello!' });
		await applicant.mutation(api.chat.sendMessage, { roomId: ids.roomId, content: 'Hi back!' });

		// The staff sender now appears in the applicant's participant list, labeled Staff; the
		// applicant (already context-derived) is not duplicated by their own messages.
		participants = await applicant.query(api.chat.getRoomParticipants, { roomId: ids.roomId });
		expect(participants.participants).toContainEqual(
			expect.objectContaining({ profileId: ids.staffProfileId, roleLabel: 'Staff' })
		);
		expect(
			participants.participants.filter((p) => p.profileId === ids.applicantProfileId)
		).toHaveLength(1);

		// The room lands in the writing admin's personal chat list, titled like a reviewer's view
		// (counterpart = applicant). An admin who never wrote still sees nothing.
		expect(await staff.query(api.chat.listRoomSummaries, {})).toContainEqual(
			expect.objectContaining({
				contextType: 'clubApplication',
				roomId: ids.roomId,
				roomName: 'applicant',
				roomSubtitle: 'Application chat',
				lastMessagePreview: 'Hi back!'
			})
		);
		expect(await otherStaff.query(api.chat.listRoomSummaries, {})).toEqual([]);
	});

	it('gives a join-request room the same title/subtitle as the chat header (CL-695 round 3)', async () => {
		const base = convexTest(schema, modules);
		const ids = await base.run(async (ctx) => {
			const now = Date.now();
			const guideRoleId = await ctx.db.insert('clubRoles', {
				key: 'guide',
				name: 'Guide',
				permissions: ['club_join_request:decide'],
				order: 0,
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
				firstName: 'Req',
				lastName: 'User',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const clubId = await ctx.db.insert('clubs', {
				name: 'Turtles Club',
				discoverable: false,
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
			const joinRequestId = await ctx.db.insert('joinRequests', {
				clubId,
				requesterProfileId,
				status: 'pending',
				createdAt: now
			});
			const roomId = await ctx.db.insert('rooms', {
				contextType: 'joinRequest',
				joinRequestId
			});

			return { roomId };
		});
		const guide = base.withIdentity({ subject: 'guide-user' });
		const requester = base.withIdentity({ subject: 'requester-user' });

		const guideSummaries = await guide.query(api.chat.listRoomSummaries, {});
		const requesterSummaries = await requester.query(api.chat.listRoomSummaries, {});

		// The requester has no counterpart from their own point of view — plain generic name, no
		// club subtitle (matches the header showing just the generic name, no subtext).
		expect(requesterSummaries).toContainEqual(
			expect.objectContaining({
				contextType: 'joinRequest',
				roomId: ids.roomId,
				roomName: 'Turtles Club join request',
				roomSubtitle: null
			})
		);
		// A Guide's counterpart is the requester: title becomes the requester's name, with the club
		// (generic room name) as the fallback subtitle — exactly what the chat header shows.
		expect(guideSummaries).toContainEqual(
			expect.objectContaining({
				contextType: 'joinRequest',
				roomId: ids.roomId,
				roomName: 'Req User',
				roomSubtitle: 'Turtles Club join request'
			})
		);
	});
});

describe('last read markers', () => {
	it('reports unread counts from the viewer read watermark', async () => {
		const { base, viewer, roomId, otherProfileId } = await seedClubChatFixture();

		// Never-opened room: inbound history since the viewer joined the club counts as unread
		// (the fixture's Welcome message postdates the viewer's membership).
		let summaries = await viewer.query(api.chat.listRoomSummaries, {});
		expect(summaries[0].unreadCount).toBe(1);

		await viewer.mutation(api.chat.markRoomRead, { roomId });
		summaries = await viewer.query(api.chat.listRoomSummaries, {});
		expect(summaries[0].unreadCount).toBe(0);

		await base.run(async (ctx) => {
			await ctx.db.insert('messages', { roomId, profileId: otherProfileId, content: 'New one' });
			// System messages (no profileId) count as unread too — decision notices should badge.
			await ctx.db.insert('messages', { roomId, content: 'System notice' });
		});
		summaries = await viewer.query(api.chat.listRoomSummaries, {});
		expect(summaries[0].unreadCount).toBe(2);
	});

	it('never counts the viewer own messages as unread', async () => {
		const { viewer, roomId } = await seedClubChatFixture();
		await viewer.mutation(api.chat.markRoomRead, { roomId });

		await viewer.mutation(api.chat.sendMessage, { roomId, content: 'My own message' });

		const summaries = await viewer.query(api.chat.listRoomSummaries, {});
		expect(summaries[0].unreadCount).toBe(0);
	});

	it('advances a single marker row per room instead of stacking rows', async () => {
		const { base, viewer, roomId, viewerProfileId } = await seedClubChatFixture();

		await viewer.mutation(api.chat.markRoomRead, { roomId });
		await viewer.mutation(api.chat.markRoomRead, { roomId });

		const markers = await base.run((ctx) =>
			ctx.db
				.query('roomReadMarkers')
				.withIndex('by_profile_and_room', (q) =>
					q.eq('profileId', viewerProfileId).eq('roomId', roomId)
				)
				.collect()
		);
		expect(markers).toHaveLength(1);
		expect(Object.keys(markers[0]).sort()).toEqual(
			['_creationTime', '_id', 'lastReadAt', 'profileId', 'roomId'].sort()
		);
	});

	it('caps unread counting at 100 for the 99+ badge', async () => {
		const { base, viewer, roomId, otherProfileId } = await seedClubChatFixture();
		await base.run(async (ctx) => {
			for (let index = 0; index < 110; index += 1) {
				await ctx.db.insert('messages', {
					roomId,
					profileId: otherProfileId,
					content: `Bulk ${index}`
				});
			}
		});

		const summaries = await viewer.query(api.chat.listRoomSummaries, {});
		expect(summaries[0].unreadCount).toBe(100);
	});

	it('rejects marking rooms the profile cannot read', async () => {
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

		await expect(outsider.mutation(api.chat.markRoomRead, { roomId })).rejects.toThrow(
			'You cannot access this chat'
		);
	});
});

// Last-read follow-up: with no read marker yet, unread counting floors at the viewer's
// context-join time (getRoomJoinedAt) instead of the beginning of history. Tests pin the join
// timestamp to an existing message's _creationTime: `gt` then excludes that message and
// everything before it, deterministically, with no wall-clock races.
describe('unread floor at context join', () => {
	it('club: messages from before the viewer joined never count as unread', async () => {
		const { base, viewer, roomId, clubId, viewerProfileId, otherProfileId, firstMessageId } =
			await seedClubChatFixture();

		await base.run(async (ctx) => {
			const welcome = await ctx.db.get(firstMessageId);
			const membership = await ctx.db
				.query('clubMembers')
				.withIndex('by_club_and_profile', (q) =>
					q.eq('clubId', clubId).eq('profileId', viewerProfileId)
				)
				.first();
			// Viewer joined exactly when Welcome was sent: Welcome is history, not unread.
			await ctx.db.patch(membership!._id, { createdAt: welcome!._creationTime });
			await ctx.db.insert('messages', { roomId, profileId: otherProfileId, content: 'After' });
		});
		let summaries = await viewer.query(api.chat.listRoomSummaries, {});
		expect(summaries[0].unreadCount).toBe(1);

		// Joined after everything currently in the room: nothing is unread.
		await base.run(async (ctx) => {
			const membership = await ctx.db
				.query('clubMembers')
				.withIndex('by_club_and_profile', (q) =>
					q.eq('clubId', clubId).eq('profileId', viewerProfileId)
				)
				.first();
			await ctx.db.patch(membership!._id, { createdAt: Date.now() + 60_000 });
		});
		summaries = await viewer.query(api.chat.listRoomSummaries, {});
		expect(summaries[0].unreadCount).toBe(0);
	});

	it('project: member and guide observer floors start at their own joins', async () => {
		const base = convexTest(schema, modules);
		const ids = await base.run(async (ctx) => {
			const now = Date.now();
			const projectRoleId = await ctx.db.insert('projectRoles', {
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
			const earlyProfileId = await ctx.db.insert('profiles', {
				authUserId: 'early-user',
				username: 'early',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const lateProfileId = await ctx.db.insert('profiles', {
				authUserId: 'late-user',
				username: 'late',
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
			const projectId = await ctx.db.insert('projects', {
				name: 'Long-running project',
				dueDate: now,
				visibility: 'clubs',
				createdByProfileId: earlyProfileId,
				createdAt: now,
				updatedAt: now
			});
			await ctx.db.insert('projectAttributions', {
				projectId,
				profileId: earlyProfileId,
				clubId,
				createdAt: now
			});
			const roomId = await ctx.db.insert('rooms', { contextType: 'project', projectId });
			await ctx.db.insert('projectMembers', {
				projectId,
				profileId: earlyProfileId,
				roleId: projectRoleId,
				createdAt: now
			});
			const oldMessageId = await ctx.db.insert('messages', {
				roomId,
				profileId: earlyProfileId,
				content: 'Old discussion'
			});
			const oldMessage = await ctx.db.get(oldMessageId);
			// Late member and observing Guide both join exactly at the old message's time.
			await ctx.db.insert('projectMembers', {
				projectId,
				profileId: lateProfileId,
				roleId: projectRoleId,
				createdAt: oldMessage!._creationTime
			});
			await ctx.db.insert('clubMembers', {
				clubId,
				profileId: observerProfileId,
				roleId: guideRoleId,
				createdAt: oldMessage!._creationTime
			});
			await ctx.db.insert('messages', {
				roomId,
				profileId: earlyProfileId,
				content: 'Fresh update'
			});
			return { roomId };
		});

		const late = base.withIdentity({ subject: 'late-user' });
		const observer = base.withIdentity({ subject: 'observer-user' });
		const early = base.withIdentity({ subject: 'early-user' });

		const lateSummary = (await late.query(api.chat.listRoomSummaries, {})).find(
			(entry) => entry.roomId === ids.roomId
		);
		const observerSummary = (await observer.query(api.chat.listRoomSummaries, {})).find(
			(entry) => entry.roomId === ids.roomId
		);
		const earlySummary = (await early.query(api.chat.listRoomSummaries, {})).find(
			(entry) => entry.roomId === ids.roomId
		);

		expect(lateSummary?.unreadCount).toBe(1);
		expect(observerSummary?.unreadCount).toBe(1);
		// The early member wrote everything themselves: nothing inbound, nothing unread.
		expect(earlySummary?.unreadCount).toBe(0);
	});

	it('join request: requester counts from request creation, Guides from club join', async () => {
		const base = convexTest(schema, modules);
		const ids = await base.run(async (ctx) => {
			const now = Date.now();
			const guideRoleId = await ctx.db.insert('clubRoles', {
				key: 'guide',
				name: 'Guide',
				permissions: ['club_join_request:decide'],
				order: 0,
				createdAt: now
			});
			const requesterProfileId = await ctx.db.insert('profiles', {
				authUserId: 'requester-user',
				username: 'requester',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const guideProfileId = await ctx.db.insert('profiles', {
				authUserId: 'guide-user',
				username: 'guide',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const clubId = await ctx.db.insert('clubs', {
				name: 'Turtles Club',
				discoverable: true,
				createdByProfileId: guideProfileId,
				createdAt: now,
				updatedAt: now
			});
			const joinRequestId = await ctx.db.insert('joinRequests', {
				clubId,
				requesterProfileId,
				status: 'pending',
				createdAt: now
			});
			const roomId = await ctx.db.insert('rooms', { contextType: 'joinRequest', joinRequestId });
			const firstAskId = await ctx.db.insert('messages', {
				roomId,
				profileId: requesterProfileId,
				content: 'May I join?'
			});
			const firstAsk = await ctx.db.get(firstAskId);
			// The Guide joined the club exactly when the first message landed: it predates them.
			await ctx.db.insert('clubMembers', {
				clubId,
				profileId: guideProfileId,
				roleId: guideRoleId,
				createdAt: firstAsk!._creationTime
			});
			await ctx.db.insert('messages', {
				roomId,
				profileId: guideProfileId,
				content: 'Tell us more'
			});
			await ctx.db.insert('messages', {
				roomId,
				profileId: requesterProfileId,
				content: 'I love turtles'
			});
			return { roomId };
		});

		const requester = base.withIdentity({ subject: 'requester-user' });
		const guide = base.withIdentity({ subject: 'guide-user' });

		const requesterSummary = (await requester.query(api.chat.listRoomSummaries, {})).find(
			(entry) => entry.roomId === ids.roomId
		);
		const guideSummary = (await guide.query(api.chat.listRoomSummaries, {})).find(
			(entry) => entry.roomId === ids.roomId
		);

		// Requester: the room exists for them — the Guide's reply is unread (own messages aren't).
		expect(requesterSummary?.unreadCount).toBe(1);
		// Guide: only the follow-up sent after they joined counts; the pre-join ask does not.
		expect(guideSummary?.unreadCount).toBe(1);
	});

	it('application: applicant counts from application creation, reviewers from assignment', async () => {
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
			const seasonId = await ctx.db.insert('seasons', {
				name: 'Autumn 2026',
				startDate: now,
				endDate: now,
				reviewWindowOpen: now,
				reviewWindowClose: now,
				feedbackDeadline: now,
				createdAt: now,
				updatedAt: now
			});
			const applicationId = await ctx.db.insert('clubApplications', {
				applicantProfileId,
				status: 'pending',
				name: 'Braga Curiosity Club',
				createdAt: now,
				updatedAt: now
			});
			const roomId = await ctx.db.insert('rooms', {
				contextType: 'clubApplication',
				clubApplicationId: applicationId
			});
			const introId = await ctx.db.insert('messages', {
				roomId,
				profileId: applicantProfileId,
				content: 'Here is my application'
			});
			const intro = await ctx.db.get(introId);
			// Reviewer assigned exactly when the intro landed: the intro predates their assignment.
			await ctx.db.insert('applicationReviewAssignments', {
				applicationId,
				reviewerProfileId,
				seasonId,
				assignedAt: intro!._creationTime
			});
			await ctx.db.insert('messages', {
				roomId,
				profileId: reviewerProfileId,
				content: 'Thanks, reviewing now'
			});
			await ctx.db.insert('messages', {
				roomId,
				profileId: applicantProfileId,
				content: 'Any questions?'
			});
			return { roomId };
		});

		const applicant = base.withIdentity({ subject: 'applicant-user' });
		const reviewer = base.withIdentity({ subject: 'reviewer-user' });

		const applicantSummary = (await applicant.query(api.chat.listRoomSummaries, {})).find(
			(entry) => entry.roomId === ids.roomId
		);
		const reviewerSummary = (await reviewer.query(api.chat.listRoomSummaries, {})).find(
			(entry) => entry.roomId === ids.roomId
		);

		// Applicant: the room exists for them — the reviewer's reply is unread.
		expect(applicantSummary?.unreadCount).toBe(1);
		// Reviewer: only the follow-up after their assignment counts, not the pre-assignment intro.
		expect(reviewerSummary?.unreadCount).toBe(1);
	});

	it('application: staff association starts with their first message in the room', async () => {
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
			const staffProfileId = await ctx.db.insert('profiles', {
				authUserId: 'staff-user',
				username: 'staff',
				globalRole: 'admin',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			const applicationId = await ctx.db.insert('clubApplications', {
				applicantProfileId,
				status: 'pending',
				name: 'Porto Curiosity Club',
				createdAt: now,
				updatedAt: now
			});
			const roomId = await ctx.db.insert('rooms', {
				contextType: 'clubApplication',
				clubApplicationId: applicationId
			});
			await ctx.db.insert('messages', {
				roomId,
				profileId: applicantProfileId,
				content: 'Before staff got involved'
			});
			await ctx.db.insert('messages', {
				roomId,
				profileId: staffProfileId,
				content: 'Staff here, taking over'
			});
			await ctx.db.insert('messages', {
				roomId,
				profileId: applicantProfileId,
				content: 'Great, thanks'
			});
			return { roomId };
		});

		const staff = base.withIdentity({ subject: 'staff-user' });
		const staffSummary = (await staff.query(api.chat.listRoomSummaries, {})).find(
			(entry) => entry.roomId === ids.roomId
		);

		// Only the applicant's reply AFTER the staff member first wrote counts as unread; the
		// pre-involvement message does not.
		expect(staffSummary?.unreadCount).toBe(1);
	});
});
