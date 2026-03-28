import { afterEach, describe, expect, it } from 'vitest';
import {
	buildMediaObjectKey,
	resolveMediaAssetFileUrl,
	resolveMediaObjectUrl
} from './mediaStorage';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
	process.env = { ...ORIGINAL_ENV };
});

describe('mediaStorage helpers', () => {
	it('builds stable object keys with env, owner, asset, and revision segments', () => {
		const objectKey = buildMediaObjectKey({
			envPrefix: 'preview',
			objectPrefix: 'media-assets',
			ownerUserId: 'user_123',
			assetId: 'asset_456',
			revision: 2,
			originalFilename: 'My Summer Photo.JPG'
		});

		expect(objectKey).toContain('preview/media-assets/owners/user-123/assets/asset_456/raw/r2/');
		expect(objectKey.endsWith('my-summer-photo.jpg')).toBe(true);
	});

	it('resolves ready asset URLs from the configured public base URL', () => {
		process.env.MEDIA_S3_REGION = 'eu-central-1';
		process.env.MEDIA_S3_BUCKET = 'curiosity-media';
		process.env.MEDIA_S3_ACCESS_KEY_ID = 'key';
		process.env.MEDIA_S3_SECRET_ACCESS_KEY = 'secret';
		process.env.MEDIA_S3_PUBLIC_BASE_URL = 'https://cdn.example.com/public-media';

		const fileUrl = resolveMediaAssetFileUrl({
			status: 'ready',
			storageProvider: 's3',
			sourceBucket: 'curiosity-media',
			sourceObjectKey: 'preview/media-assets/raw-file.png'
		});

		expect(fileUrl).toBe('https://cdn.example.com/public-media/preview/media-assets/raw-file.png');
	});

	it('falls back to the default S3 URL shape when no public base URL is configured', () => {
		const url = resolveMediaObjectUrl({
			bucket: 'curiosity-media',
			objectKey: 'prod/media-assets/owners/user/assets/asset/raw/r1/file.png',
			config: {
				region: 'us-east-1',
				forcePathStyle: false
			}
		});

		expect(url).toBe(
			'https://curiosity-media.s3.us-east-1.amazonaws.com/prod/media-assets/owners/user/assets/asset/raw/r1/file.png'
		);
	});
});
