import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

/**
 * Seeds a project with a club (contributor role has `project:update`), a configurable set of
 * project members, and returns handles for building test-specific media assets. Mirrors
 * `projectInvites.spec.ts`'s `seedFixture`.
 */
const seedFixture = async (options?: {
	memberSpecs?: Array<{ authUserId: string; doneDate?: number; leftAt?: number }>;
}) => {
	const memberSpecs = options?.memberSpecs ?? [{ authUserId: 'alice' }];
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const now = Date.now();
		const contributorRoleId = await ctx.db.insert('projectRoles', {
			key: 'contributor',
			name: 'Contributor',
			permissions: ['project:read', 'project:update'],
			order: 0,
			createdAt: now
		});
		const guideRoleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: ['project:read', 'project:update', 'project:create'],
			order: 0,
			createdAt: now
		});

		const profileIds: Record<string, Id<'profiles'>> = {};
		for (const spec of memberSpecs) {
			const profileId = await ctx.db.insert('profiles', {
				authUserId: spec.authUserId,
				username: spec.authUserId,
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
			profileIds[spec.authUserId] = profileId;
		}

		const clubOwnerProfileId = profileIds[memberSpecs[0].authUserId];
		const clubId = await ctx.db.insert('clubs', {
			name: 'Fixture club',
			discoverable: false,
			createdByProfileId: clubOwnerProfileId,
			createdAt: now,
			updatedAt: now
		});
		// Note: intentionally NOT giving anyone a club-level Guide role by default here, so that
		// membership-state guards (`assertNotDoneMember`/`assertNotLeftMember`) are what's under
		// test rather than `isProjectPermissionAllowed`'s club-role fallback. Tests that need to
		// exercise the club-role bypass path add the Guide membership explicitly.
		void guideRoleId;

		const projectId = await ctx.db.insert('projects', {
			name: 'Fixture project',
			dueDate: now + 7 * 24 * 60 * 60 * 1000,
			visibility: 'clubs',
			createdByProfileId: clubOwnerProfileId,
			createdAt: now,
			updatedAt: now
		});
		await ctx.db.insert('projectAttributions', {
			projectId,
			profileId: clubOwnerProfileId,
			clubId,
			createdAt: now
		});

		const memberIds: Record<string, Id<'projectMembers'>> = {};
		for (const spec of memberSpecs) {
			const memberId = await ctx.db.insert('projectMembers', {
				projectId,
				profileId: profileIds[spec.authUserId],
				roleId: contributorRoleId,
				doneDate: spec.doneDate,
				leftAt: spec.leftAt,
				firstName: spec.authUserId,
				username: spec.authUserId,
				createdAt: now
			});
			memberIds[spec.authUserId] = memberId;
		}

		return { projectId, clubId, guideRoleId, profileIds, memberIds };
	});

	return { t, ...ids };
};

const insertMediaAsset = async (
	t: Awaited<ReturnType<typeof seedFixture>>['t'],
	overrides: {
		ownerUserId: string;
		mediaKind?: 'image' | 'video';
		status?: 'ready' | 'processing' | 'pending_upload' | 'failed' | 'canceled';
	}
) => {
	return await t.run(async (ctx) => {
		const now = Date.now();
		return await ctx.db.insert('mediaAssets', {
			ownerUserId: overrides.ownerUserId,
			mediaKind: overrides.mediaKind ?? 'image',
			status: overrides.status ?? 'ready',
			acceptedContentTypes: ['image/jpeg'],
			maxBytes: 10_000_000,
			enableCompression: true,
			enableSafetyScreening: true,
			storageProvider: 's3',
			sourceBucket: 'test-bucket',
			sourceObjectKey: 'test-object-key',
			sourceObjectRevision: 1,
			contentType: overrides.mediaKind === 'video' ? 'video/mp4' : 'image/jpeg',
			sizeBytes: 1000,
			pipelineVersion: 1,
			attemptCount: 1,
			stepResults: [],
			createdAt: now,
			updatedAt: now,
			readyAt: now
		});
	});
};

describe('updates.create', () => {
	it('allows an active member to post a text-only update', async () => {
		const { t, projectId } = await seedFixture();

		const update = await t
			.withIdentity({ subject: 'alice' })
			.mutation(api.updates.create, { projectId, content: 'Made great progress today.' });

		expect(update?.content).toBe('Made great progress today.');
	});

	it('trims content before storing and enforces the max length', async () => {
		const { t, projectId } = await seedFixture();

		const update = await t
			.withIdentity({ subject: 'alice' })
			.mutation(api.updates.create, { projectId, content: '  Trimmed update.  ' });

		expect(update?.content).toBe('Trimmed update.');
	});

	it('rejects empty (or whitespace-only) text', async () => {
		const { t, projectId } = await seedFixture();

		await expect(
			t.withIdentity({ subject: 'alice' }).mutation(api.updates.create, {
				projectId,
				content: '   '
			})
		).rejects.toThrow('Update text is required.');
	});

	it('rejects text over 1000 characters', async () => {
		const { t, projectId } = await seedFixture();
		const longContent = 'a'.repeat(1001);

		await expect(
			t.withIdentity({ subject: 'alice' }).mutation(api.updates.create, {
				projectId,
				content: longContent
			})
		).rejects.toThrow('Updates must be 1000 characters or fewer.');
	});

	it('allows exactly 1000 characters', async () => {
		const { t, projectId } = await seedFixture();
		const maxContent = 'a'.repeat(1000);

		const update = await t
			.withIdentity({ subject: 'alice' })
			.mutation(api.updates.create, { projectId, content: maxContent });

		expect(update?.content).toHaveLength(1000);
	});

	it('rejects a Done member posting an update', async () => {
		const { t, projectId } = await seedFixture({
			memberSpecs: [{ authUserId: 'alice', doneDate: Date.now() }]
		});

		await expect(
			t.withIdentity({ subject: 'alice' }).mutation(api.updates.create, {
				projectId,
				content: 'Trying to post after being done.'
			})
		).rejects.toThrow('Done members cannot edit this project');
	});

	it('rejects a Left member posting an update, even with a club Guide role', async () => {
		const { t, projectId, clubId, guideRoleId, profileIds } = await seedFixture({
			memberSpecs: [{ authUserId: 'alice', leftAt: Date.now() }]
		});
		// Give alice a Guide role in the attributed club, which would otherwise grant
		// `project:update` via `isProjectPermissionAllowed`'s club-role fallback — this is the
		// bypass `assertNotLeftMember` exists to close.
		await t.run(async (ctx) => {
			await ctx.db.insert('clubMembers', {
				clubId,
				profileId: profileIds.alice,
				roleId: guideRoleId,
				createdAt: Date.now()
			});
		});

		await expect(
			t.withIdentity({ subject: 'alice' }).mutation(api.updates.create, {
				projectId,
				content: 'Trying to post after leaving.'
			})
		).rejects.toThrow('You have left this project and cannot post updates.');
	});

	it('rejects more than 4 media assets', async () => {
		const { t, projectId } = await seedFixture();
		const assetIds = await Promise.all(
			Array.from({ length: 5 }, () => insertMediaAsset(t, { ownerUserId: 'alice' }))
		);

		await expect(
			t.withIdentity({ subject: 'alice' }).mutation(api.updates.create, {
				projectId,
				content: 'Too many attachments.',
				mediaAssetIds: assetIds
			})
		).rejects.toThrow('Updates can have at most 4 attachments.');
	});

	it('rejects a non-ready media asset', async () => {
		const { t, projectId } = await seedFixture();
		const assetId = await insertMediaAsset(t, { ownerUserId: 'alice', status: 'processing' });

		await expect(
			t.withIdentity({ subject: 'alice' }).mutation(api.updates.create, {
				projectId,
				content: 'Attaching a not-ready asset.',
				mediaAssetIds: [assetId]
			})
		).rejects.toThrow('Only ready media assets can be attached');
	});

	it('rejects a media asset not owned by the poster', async () => {
		const { t, projectId } = await seedFixture();
		const assetId = await insertMediaAsset(t, { ownerUserId: 'someone-else' });

		await expect(
			t.withIdentity({ subject: 'alice' }).mutation(api.updates.create, {
				projectId,
				content: 'Attaching someone else’s asset.',
				mediaAssetIds: [assetId]
			})
		).rejects.toThrow('Media asset not found');
	});

	it('persists attached image and video assets and lists them back', async () => {
		const { t, projectId } = await seedFixture();
		const imageAssetId = await insertMediaAsset(t, { ownerUserId: 'alice', mediaKind: 'image' });
		const videoAssetId = await insertMediaAsset(t, { ownerUserId: 'alice', mediaKind: 'video' });

		const update = await t.withIdentity({ subject: 'alice' }).mutation(api.updates.create, {
			projectId,
			content: 'Update with media.',
			mediaAssetIds: [imageAssetId, videoAssetId]
		});

		const listed = await t
			.withIdentity({ subject: 'alice' })
			.query(api.updates.listByProject, { projectId });

		const stored = listed.find((entry) => entry._id === update?._id);
		expect(stored?.mediaAssetIds).toEqual(expect.arrayContaining([imageAssetId, videoAssetId]));
		expect(stored?.mediaAssetIds).toHaveLength(2);
	});
});
