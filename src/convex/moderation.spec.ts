import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

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

/**
 * Minimal project + update + comment fixture (mirrors updates.spec.ts's seedFixture, trimmed to
 * just what moderation takedown tests need): one club, one project attributed to it, one
 * contributor member, one update, and one comment on that update.
 */
const seedProjectWithUpdateAndComment = async (t: ReturnType<typeof convexTest>) => {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const authorProfileId = await ctx.db.insert('profiles', {
			authUserId: 'author',
			username: 'author',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const contributorRoleId = await ctx.db.insert('projectRoles', {
			key: 'contributor',
			name: 'Contributor',
			permissions: ['project:read', 'project:update'],
			order: 0,
			createdAt: now
		});
		const clubId = await ctx.db.insert('clubs', {
			name: 'Fixture club',
			discoverable: false,
			createdByProfileId: authorProfileId,
			createdAt: now,
			updatedAt: now
		});
		const projectId = await ctx.db.insert('projects', {
			name: 'Fixture project',
			dueDate: now + 7 * 24 * 60 * 60 * 1000,
			visibility: 'global',
			createdByProfileId: authorProfileId,
			createdAt: now,
			updatedAt: now
		});
		await ctx.db.insert('projectAttributions', {
			projectId,
			profileId: authorProfileId,
			clubId,
			createdAt: now
		});
		await ctx.db.insert('projectMembers', {
			projectId,
			profileId: authorProfileId,
			roleId: contributorRoleId,
			firstName: 'author',
			username: 'author',
			createdAt: now
		});
		const updateId = await ctx.db.insert('updates', {
			projectId,
			content: 'Original update content',
			createdByProfileId: authorProfileId,
			createdAt: now,
			updatedAt: now
		});
		const commentId = await ctx.db.insert('updateComments', {
			updateId,
			authorProfileId,
			content: 'Original comment content',
			createdAt: now
		});
		return { authorProfileId, clubId, projectId, updateId, commentId };
	});
};

describe('moderation.listQueue', () => {
	it('rejects a non-admin caller', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'regular-user');
		await expect(
			t.withIdentity({ subject: 'regular-user' }).query(api.moderation.listQueue, {})
		).rejects.toThrow('Not authorized');
	});

	it('combines open reports and flagged media, newest first', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const reporterProfileId = await seedProfile(t, 'reporter');

		const { reportId, mediaAssetId } = await t.run(async (ctx) => {
			const now = Date.now();
			const reportId = await ctx.db.insert('reports', {
				reporterProfileId,
				category: 'other',
				targetType: 'club',
				targetId: 'some-club-id',
				status: 'open',
				createdAt: now
			});
			const mediaAssetId = await ctx.db.insert('mediaAssets', {
				ownerUserId: 'some-user',
				mediaKind: 'image',
				status: 'ready',
				acceptedContentTypes: ['image/png'],
				maxBytes: 1000,
				enableCompression: false,
				enableSafetyScreening: true,
				storageProvider: 's3',
				sourceObjectRevision: 1,
				moderation: { status: 'flagged', labels: [{ name: 'Suggestive', confidence: 60 }] },
				pipelineVersion: 1,
				attemptCount: 1,
				stepResults: [],
				createdAt: now + 1,
				updatedAt: now + 1
			});
			return { reportId, mediaAssetId };
		});

		const queue = await t.withIdentity({ subject: 'admin-user' }).query(api.moderation.listQueue, {});
		expect(queue).toHaveLength(2);
		expect(queue[0]).toMatchObject({ kind: 'flagged_media', mediaAssetId });
		expect(queue[1]).toMatchObject({ kind: 'report', reportId });
	});

	it('excludes reviewed flagged media', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);

		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert('mediaAssets', {
				ownerUserId: 'some-user',
				mediaKind: 'image',
				status: 'ready',
				acceptedContentTypes: ['image/png'],
				maxBytes: 1000,
				enableCompression: false,
				enableSafetyScreening: true,
				storageProvider: 's3',
				sourceObjectRevision: 1,
				moderation: { status: 'flagged', labels: [] },
				moderationReviewedAt: now,
				pipelineVersion: 1,
				attemptCount: 1,
				stepResults: [],
				createdAt: now,
				updatedAt: now
			});
		});

		const queue = await t.withIdentity({ subject: 'admin-user' }).query(api.moderation.listQueue, {});
		expect(queue).toHaveLength(0);
	});
});

describe('moderation report transitions', () => {
	it('dismiss moves an open report to dismissed', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const reporterProfileId = await seedProfile(t, 'reporter');
		const reportId = await t.run((ctx) =>
			ctx.db.insert('reports', {
				reporterProfileId,
				category: 'other',
				targetType: 'club',
				targetId: 'x',
				status: 'open',
				createdAt: Date.now()
			})
		);

		await t.withIdentity({ subject: 'admin-user' }).mutation(api.moderation.dismissReport, { reportId });

		const report = await t.run((ctx) => ctx.db.get(reportId));
		expect(report?.status).toBe('dismissed');
		expect(report?.resolvedByProfileId).toBe(adminProfileId);
	});

	it('escalate moves an open report to escalated', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const reporterProfileId = await seedProfile(t, 'reporter');
		const reportId = await t.run((ctx) =>
			ctx.db.insert('reports', {
				reporterProfileId,
				category: 'safeguarding',
				targetType: 'user',
				targetId: 'x',
				status: 'open',
				createdAt: Date.now()
			})
		);

		await t
			.withIdentity({ subject: 'admin-user' })
			.mutation(api.moderation.escalateReport, { reportId, note: 'needs follow-up' });

		const report = await t.run((ctx) => ctx.db.get(reportId));
		expect(report?.status).toBe('escalated');
		expect(report?.resolutionNote).toBe('needs follow-up');
	});

	it('rejects transitions on a non-open report', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const reporterProfileId = await seedProfile(t, 'reporter');
		const reportId = await t.run((ctx) =>
			ctx.db.insert('reports', {
				reporterProfileId,
				category: 'other',
				targetType: 'club',
				targetId: 'x',
				status: 'dismissed',
				createdAt: Date.now()
			})
		);

		await expect(
			t.withIdentity({ subject: 'admin-user' }).mutation(api.moderation.dismissReport, { reportId })
		).rejects.toThrow('Report is not open');
	});
});

describe('moderation takedown hides content from member-facing reads', () => {
	it('takedownUpdate hides the update from updates.listByProject', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const { authorProfileId, projectId, updateId } = await seedProjectWithUpdateAndComment(t);

		let listed = await t
			.withIdentity({ subject: 'author' })
			.query(api.updates.listByProject, { projectId });
		expect(listed.map((u) => u._id)).toContain(updateId);

		await t.withIdentity({ subject: 'admin-user' }).mutation(api.moderation.takedownUpdate, {
			updateId,
			reason: 'inappropriate'
		});

		listed = await t.withIdentity({ subject: 'author' }).query(api.updates.listByProject, { projectId });
		expect(listed.map((u) => u._id)).not.toContain(updateId);
		void authorProfileId;
	});

	it('takedownUpdate marks a matching open report as actioned', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const reporterProfileId = await seedProfile(t, 'reporter');
		const { updateId } = await seedProjectWithUpdateAndComment(t);

		const reportId = await t.run((ctx) =>
			ctx.db.insert('reports', {
				reporterProfileId,
				category: 'inappropriate_content',
				targetType: 'project_update',
				targetId: updateId,
				status: 'open',
				createdAt: Date.now()
			})
		);

		await t.withIdentity({ subject: 'admin-user' }).mutation(api.moderation.takedownUpdate, { updateId });

		const report = await t.run((ctx) => ctx.db.get(reportId));
		expect(report?.status).toBe('actioned');
	});

	it('takedownComment hides the comment from updateComments.listComments', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const { commentId, updateId } = await seedProjectWithUpdateAndComment(t);

		let comments = await t
			.withIdentity({ subject: 'author' })
			.query(api.updateComments.listComments, { updateId });
		expect(comments.map((c) => c.commentId)).toContain(commentId);

		await t
			.withIdentity({ subject: 'admin-user' })
			.mutation(api.moderation.takedownComment, { commentId });

		comments = await t
			.withIdentity({ subject: 'author' })
			.query(api.updateComments.listComments, { updateId });
		expect(comments.map((c) => c.commentId)).not.toContain(commentId);
	});

	it('takedownProject hides the project from projects.getById for everyone, including members', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const { projectId } = await seedProjectWithUpdateAndComment(t);

		await t
			.withIdentity({ subject: 'admin-user' })
			.mutation(api.moderation.takedownProject, { projectId });

		await expect(
			t.withIdentity({ subject: 'author' }).query(api.projects.getById, { projectId })
		).rejects.toThrow('Permission denied');
	});

	it('takedownProject marks open reports on the project\'s updates as actioned (not a report keyed by the project id)', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const reporterProfileId = await seedProfile(t, 'reporter');
		const { projectId, updateId } = await seedProjectWithUpdateAndComment(t);

		// The real-world shape: reports against a project's content always carry the *update* id
		// (targetType 'project_update'), never the project id itself — there is no 'project'
		// targetType in the schema.
		const updateReportId = await t.run((ctx) =>
			ctx.db.insert('reports', {
				reporterProfileId,
				category: 'inappropriate_content',
				targetType: 'project_update',
				targetId: updateId,
				status: 'open',
				createdAt: Date.now()
			})
		);

		await t
			.withIdentity({ subject: 'admin-user' })
			.mutation(api.moderation.takedownProject, { projectId });

		const updateReport = await t.run((ctx) => ctx.db.get(updateReportId));
		expect(updateReport?.status).toBe('actioned');
		expect(updateReport?.resolvedByProfileId).toBe(adminProfileId);
	});

	it('takedownMessage sets removedByModeration without deleting the row', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const senderProfileId = await seedProfile(t, 'sender');

		const { roomId, messageId } = await t.run(async (ctx) => {
			const roomId = await ctx.db.insert('rooms', {
				contextType: 'club',
				clubId: (await ctx.db.insert('clubs', {
					name: 'c',
					discoverable: false,
					createdByProfileId: senderProfileId,
					createdAt: Date.now(),
					updatedAt: Date.now()
				})) as Id<'clubs'>
			});
			const messageId = await ctx.db.insert('messages', {
				roomId,
				profileId: senderProfileId,
				content: 'hello everyone'
			});
			return { roomId, messageId };
		});

		await t
			.withIdentity({ subject: 'admin-user' })
			.mutation(api.moderation.takedownMessage, { messageId, reason: 'spam' });

		const message = await t.run((ctx) => ctx.db.get(messageId));
		expect(message?.content).toBe('hello everyone');
		expect(message?.removedByModeration?.byProfileId).toBe(adminProfileId);
		void roomId;
	});
});

describe('moderation.dismissFlaggedMedia', () => {
	it('clears the asset from the queue by stamping a review', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);

		const mediaAssetId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert('mediaAssets', {
				ownerUserId: 'some-user',
				mediaKind: 'image',
				status: 'ready',
				acceptedContentTypes: ['image/png'],
				maxBytes: 1000,
				enableCompression: false,
				enableSafetyScreening: true,
				storageProvider: 's3',
				sourceObjectRevision: 1,
				moderation: { status: 'flagged', labels: [] },
				pipelineVersion: 1,
				attemptCount: 1,
				stepResults: [],
				createdAt: now,
				updatedAt: now
			});
		});

		await t
			.withIdentity({ subject: 'admin-user' })
			.mutation(api.moderation.dismissFlaggedMedia, { mediaAssetId, note: 'false positive' });

		const queue = await t.withIdentity({ subject: 'admin-user' }).query(api.moderation.listQueue, {});
		expect(queue.find((item) => item.kind === 'flagged_media')).toBeUndefined();
	});
});

describe('user suspension', () => {
	it('suspendUser blocks a representative mutation (updates.create) and dispatches a notification', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const { projectId } = await seedProjectWithUpdateAndComment(t);
		const authorProfileId = await t.run(async (ctx) => {
			const profile = await ctx.db
				.query('profiles')
				.withIndex('by_auth_user_id', (q) => q.eq('authUserId', 'author'))
				.unique();
			return profile!._id;
		});

		await t
			.withIdentity({ subject: 'admin-user' })
			.mutation(api.moderation.suspendUser, { profileId: authorProfileId, reason: 'ToS violation' });

		const profile = await t.run((ctx) => ctx.db.get(authorProfileId));
		expect(profile?.suspendedAt).toBeDefined();
		expect(profile?.suspendedReason).toBe('ToS violation');

		await expect(
			t.withIdentity({ subject: 'author' }).mutation(api.updates.create, {
				projectId,
				content: 'trying to post while suspended'
			})
		).rejects.toThrow('Account suspended');

		const notifications = await t.run((ctx) =>
			ctx.db
				.query('notifications')
				.withIndex('by_profile', (q) => q.eq('profileId', authorProfileId))
				.collect()
		);
		expect(notifications.some((n) => n.title.includes('suspended'))).toBe(true);
	});

	it('unsuspendUser clears the suspension and allows the mutation again', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const { projectId } = await seedProjectWithUpdateAndComment(t);
		const authorProfileId = await t.run(async (ctx) => {
			const profile = await ctx.db
				.query('profiles')
				.withIndex('by_auth_user_id', (q) => q.eq('authUserId', 'author'))
				.unique();
			return profile!._id;
		});

		await t
			.withIdentity({ subject: 'admin-user' })
			.mutation(api.moderation.suspendUser, { profileId: authorProfileId, reason: 'x' });
		await t
			.withIdentity({ subject: 'admin-user' })
			.mutation(api.moderation.unsuspendUser, { profileId: authorProfileId });

		const profile = await t.run((ctx) => ctx.db.get(authorProfileId));
		expect(profile?.suspendedAt).toBeUndefined();

		const update = await t.withIdentity({ subject: 'author' }).mutation(api.updates.create, {
			projectId,
			content: 'posting again after unsuspend'
		});
		expect(update?.content).toBe('posting again after unsuspend');
	});

	it('a suspended user can still submit a report', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);
		const reporterProfileId = await seedProfile(t, 'reporter');

		await t
			.withIdentity({ subject: 'admin-user' })
			.mutation(api.moderation.suspendUser, { profileId: reporterProfileId, reason: 'x' });

		const result = await t.withIdentity({ subject: 'reporter' }).mutation(api.reports.submitReport, {
			category: 'other',
			targetType: 'club',
			targetId: 'some-club'
		});
		expect(result.ok).toBe(true);
	});

	it('rejects a non-admin caller for suspendUser', async () => {
		const t = convexTest(schema, modules);
		const targetProfileId = await seedProfile(t, 'target');
		await seedProfile(t, 'regular-user');

		await expect(
			t
				.withIdentity({ subject: 'regular-user' })
				.mutation(api.moderation.suspendUser, { profileId: targetProfileId, reason: 'x' })
		).rejects.toThrow('Not authorized');
	});
});

describe('moderation.searchUsers / adminUpdateClub admin gating', () => {
	it('rejects a non-admin caller for searchUsers', async () => {
		const t = convexTest(schema, modules);
		await seedProfile(t, 'regular-user');
		await expect(
			t.withIdentity({ subject: 'regular-user' }).query(api.moderation.searchUsers, {
				usernamePrefix: 'a'
			})
		).rejects.toThrow('Not authorized');
	});

	it('adminUpdateClub updates name/description/discoverable and logs an action', async () => {
		const t = convexTest(schema, modules);
		const adminProfileId = await seedProfile(t, 'admin-user');
		await makeAdmin(t, adminProfileId);

		const clubId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert('clubs', {
				name: 'Old name',
				discoverable: true,
				createdByProfileId: adminProfileId,
				createdAt: now,
				updatedAt: now
			});
		});

		await t.withIdentity({ subject: 'admin-user' }).mutation(api.moderation.adminUpdateClub, {
			clubId,
			name: 'New name',
			discoverable: false
		});

		const club = await t.run((ctx) => ctx.db.get(clubId));
		expect(club?.name).toBe('New name');
		expect(club?.discoverable).toBe(false);

		const actions = await t
			.withIdentity({ subject: 'admin-user' })
			.query(api.moderation.listRecentActions, {});
		expect(actions.some((a) => a.action === 'update_club')).toBe(true);
	});
});
