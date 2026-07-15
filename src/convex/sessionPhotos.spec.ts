import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import type { Id } from './_generated/dataModel';

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
				'session_activity:read',
				'session_photo:create'
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
		const otherGuideProfileId = await ctx.db.insert('profiles', {
			authUserId: 'other-guide-user',
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
			createdAt: now
		});
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: otherGuideProfileId,
			roleId: guideRoleId,
			createdAt: now
		});
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: learnerProfileId,
			roleId: learnerRoleId,
			createdAt: now
		});
		return { clubId, guideProfileId, otherGuideProfileId, learnerProfileId };
	});

	return { t, ...ids };
};

const insertSession = async (
	t: Awaited<ReturnType<typeof seedSessionFixture>>['t'],
	clubId: Awaited<ReturnType<typeof seedSessionFixture>>['clubId'],
	guideProfileId: Awaited<ReturnType<typeof seedSessionFixture>>['guideProfileId'],
	overrides: { startTime: number; endTime: number; cancelled?: boolean }
) => {
	return await t.run(async (ctx) => {
		const now = Date.now();
		const sessionId = await ctx.db.insert('sessions', {
			clubId,
			startTime: overrides.startTime,
			endTime: overrides.endTime,
			createdByProfileId: guideProfileId,
			cancelled: overrides.cancelled,
			createdAt: now,
			updatedAt: now
		});
		return sessionId;
	});
};

const insertReadyImageAsset = async (
	t: Awaited<ReturnType<typeof seedSessionFixture>>['t'],
	ownerUserId: string
) => {
	return await t.run(async (ctx) => {
		const now = Date.now();
		return await ctx.db.insert('mediaAssets', {
			ownerUserId,
			mediaKind: 'image',
			status: 'ready',
			acceptedContentTypes: ['image/jpeg'],
			maxBytes: 10_000_000,
			enableCompression: true,
			enableSafetyScreening: true,
			storageProvider: 's3',
			sourceBucket: 'test-bucket',
			sourceObjectKey: 'test-object-key',
			sourceObjectRevision: 1,
			contentType: 'image/jpeg',
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

describe('sessions.addPhoto', () => {
	it('allows a guide to add a photo during the session window', async () => {
		const { t, clubId, guideProfileId } = await seedSessionFixture();
		const sessionId = await insertSession(t, clubId, guideProfileId, {
			startTime: Date.now() - HOUR,
			endTime: Date.now() + HOUR
		});
		const assetId = await insertReadyImageAsset(t, 'guide-user');

		const photo = await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.addPhoto, { sessionId, mediaAssetId: assetId });

		expect(photo?.mediaAssetId).toBe(assetId);
		expect(photo?.sessionId).toBe(sessionId);
	});

	it('allows adding a photo up to 12 hours after the session ends', async () => {
		const { t, clubId, guideProfileId } = await seedSessionFixture();
		const sessionId = await insertSession(t, clubId, guideProfileId, {
			startTime: Date.now() - 20 * HOUR,
			endTime: Date.now() - 10 * HOUR
		});
		const assetId = await insertReadyImageAsset(t, 'guide-user');

		const photo = await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.addPhoto, { sessionId, mediaAssetId: assetId });

		expect(photo?.mediaAssetId).toBe(assetId);
	});

	it('rejects adding a photo before the session starts', async () => {
		const { t, clubId, guideProfileId } = await seedSessionFixture();
		const sessionId = await insertSession(t, clubId, guideProfileId, {
			startTime: Date.now() + HOUR,
			endTime: Date.now() + 2 * HOUR
		});
		const assetId = await insertReadyImageAsset(t, 'guide-user');

		await expect(
			t
				.withIdentity({ subject: 'guide-user' })
				.mutation(api.sessions.addPhoto, { sessionId, mediaAssetId: assetId })
		).rejects.toThrow('Photos can only be added during the session or within 12 hours after it ends');
	});

	it('rejects adding a photo more than 12 hours after the session ends', async () => {
		const { t, clubId, guideProfileId } = await seedSessionFixture();
		const sessionId = await insertSession(t, clubId, guideProfileId, {
			startTime: Date.now() - 20 * HOUR,
			endTime: Date.now() - 13 * HOUR
		});
		const assetId = await insertReadyImageAsset(t, 'guide-user');

		await expect(
			t
				.withIdentity({ subject: 'guide-user' })
				.mutation(api.sessions.addPhoto, { sessionId, mediaAssetId: assetId })
		).rejects.toThrow('Photos can only be added during the session or within 12 hours after it ends');
	});

	it('rejects a learner adding a photo', async () => {
		const { t, clubId, guideProfileId } = await seedSessionFixture();
		const sessionId = await insertSession(t, clubId, guideProfileId, {
			startTime: Date.now() - HOUR,
			endTime: Date.now() + HOUR
		});
		const assetId = await insertReadyImageAsset(t, 'learner-user');

		await expect(
			t
				.withIdentity({ subject: 'learner-user' })
				.mutation(api.sessions.addPhoto, { sessionId, mediaAssetId: assetId })
		).rejects.toThrow('Permission denied');
	});

	it('rejects adding a photo to a cancelled session', async () => {
		const { t, clubId, guideProfileId } = await seedSessionFixture();
		const sessionId = await insertSession(t, clubId, guideProfileId, {
			startTime: Date.now() - HOUR,
			endTime: Date.now() + HOUR,
			cancelled: true
		});
		const assetId = await insertReadyImageAsset(t, 'guide-user');

		await expect(
			t
				.withIdentity({ subject: 'guide-user' })
				.mutation(api.sessions.addPhoto, { sessionId, mediaAssetId: assetId })
		).rejects.toThrow('Cannot add photos to a cancelled session');
	});

	it('rejects attaching a non-ready media asset', async () => {
		const { t, clubId, guideProfileId } = await seedSessionFixture();
		const sessionId = await insertSession(t, clubId, guideProfileId, {
			startTime: Date.now() - HOUR,
			endTime: Date.now() + HOUR
		});
		const assetId = await t.run(async (ctx) => {
			const now = Date.now();
			return await ctx.db.insert('mediaAssets', {
				ownerUserId: 'guide-user',
				status: 'processing',
				acceptedContentTypes: ['image/jpeg'],
				maxBytes: 10_000_000,
				enableCompression: true,
				enableSafetyScreening: true,
				storageProvider: 's3',
				sourceObjectRevision: 1,
				pipelineVersion: 1,
				attemptCount: 1,
				stepResults: [],
				createdAt: now,
				updatedAt: now
			});
		});

		await expect(
			t
				.withIdentity({ subject: 'guide-user' })
				.mutation(api.sessions.addPhoto, { sessionId, mediaAssetId: assetId as Id<'mediaAssets'> })
		).rejects.toThrow('Photo is not ready yet');
	});

	it('enforces a maximum of 4 photos per session', async () => {
		const { t, clubId, guideProfileId } = await seedSessionFixture();
		const sessionId = await insertSession(t, clubId, guideProfileId, {
			startTime: Date.now() - HOUR,
			endTime: Date.now() + HOUR
		});

		for (let i = 0; i < 4; i += 1) {
			const assetId = await insertReadyImageAsset(t, 'guide-user');
			await t
				.withIdentity({ subject: 'guide-user' })
				.mutation(api.sessions.addPhoto, { sessionId, mediaAssetId: assetId });
		}

		const fifthAssetId = await insertReadyImageAsset(t, 'guide-user');
		await expect(
			t.withIdentity({ subject: 'guide-user' }).mutation(api.sessions.addPhoto, {
				sessionId,
				mediaAssetId: fifthAssetId
			})
		).rejects.toThrow('A session can have at most 4 photos');
	});
});

describe('sessions.deletePhoto', () => {
	it('allows the uploading guide to delete their photo within the window', async () => {
		const { t, clubId, guideProfileId } = await seedSessionFixture();
		const sessionId = await insertSession(t, clubId, guideProfileId, {
			startTime: Date.now() - HOUR,
			endTime: Date.now() + HOUR
		});
		const assetId = await insertReadyImageAsset(t, 'guide-user');
		const photo = await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.addPhoto, { sessionId, mediaAssetId: assetId });

		const result = await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.deletePhoto, { sessionPhotoId: photo!._id });

		expect(result.success).toBe(true);
	});

	it('rejects another guide deleting a photo they did not upload', async () => {
		const { t, clubId, guideProfileId } = await seedSessionFixture();
		const sessionId = await insertSession(t, clubId, guideProfileId, {
			startTime: Date.now() - HOUR,
			endTime: Date.now() + HOUR
		});
		const assetId = await insertReadyImageAsset(t, 'guide-user');
		const photo = await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.addPhoto, { sessionId, mediaAssetId: assetId });

		await expect(
			t
				.withIdentity({ subject: 'other-guide-user' })
				.mutation(api.sessions.deletePhoto, { sessionPhotoId: photo!._id })
		).rejects.toThrow('Only the uploading guide can remove this photo');
	});

	it('rejects deleting a photo after the window has locked', async () => {
		const { t, clubId, guideProfileId } = await seedSessionFixture();
		const sessionId = await insertSession(t, clubId, guideProfileId, {
			startTime: Date.now() - HOUR,
			endTime: Date.now() + HOUR
		});
		const assetId = await insertReadyImageAsset(t, 'guide-user');
		const photo = await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.addPhoto, { sessionId, mediaAssetId: assetId });

		await t.run(async (ctx) => {
			await ctx.db.patch(sessionId, {
				endTime: Date.now() - 13 * HOUR
			});
		});

		await expect(
			t
				.withIdentity({ subject: 'guide-user' })
				.mutation(api.sessions.deletePhoto, { sessionPhotoId: photo!._id })
		).rejects.toThrow('Photos can no longer be modified for this session');
	});
});

describe('sessions.listPhotos', () => {
	it('is readable by learners (view is not window-limited)', async () => {
		const { t, clubId, guideProfileId } = await seedSessionFixture();
		const sessionId = await insertSession(t, clubId, guideProfileId, {
			startTime: Date.now() - HOUR,
			endTime: Date.now() + HOUR
		});
		const assetId = await insertReadyImageAsset(t, 'guide-user');
		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.sessions.addPhoto, { sessionId, mediaAssetId: assetId });

		// Lock the upload window after the photo was added; viewing should remain unaffected.
		await t.run(async (ctx) => {
			await ctx.db.patch(sessionId, {
				endTime: Date.now() - 13 * HOUR
			});
		});

		const photos = await t
			.withIdentity({ subject: 'learner-user' })
			.query(api.sessions.listPhotos, { sessionId });

		expect(photos).toHaveLength(1);
		expect(photos[0].canDelete).toBe(false);
	});
});
