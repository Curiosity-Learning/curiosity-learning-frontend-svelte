import { describe, expect, it, vi } from 'vitest';
import { runMediaPipeline } from './mediaPipeline';

describe('mediaPipeline', () => {
	it('accepts S3 metadata without a sha256 checksum', async () => {
		const result = await runMediaPipeline({
			asset: {
				acceptedContentTypes: ['image/png'],
				maxBytes: 5 * 1024 * 1024,
				enableCompression: false,
				enableSafetyScreening: false,
				originalFilename: 'poster.png',
				clientContentType: 'image/png'
			},
			storageMetadata: {
				storageProvider: 's3',
				bucket: 'curiosity-media',
				objectKey: 'dev/media-assets/owners/user/assets/asset/raw/r1/poster.png',
				detectedContentType: 'image/png',
				contentType: 'image/png',
				size: 1024
			}
		});

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}

		expect(result.descriptor.objectKey).toContain('/poster.png');
		expect(result.descriptor.sha256).toBeNull();
	});

	it('fails cleanly when storage metadata is missing', async () => {
		const result = await runMediaPipeline({
			asset: {
				acceptedContentTypes: ['video/mp4'],
				maxBytes: 20 * 1024 * 1024,
				enableCompression: false,
				enableSafetyScreening: false,
				originalFilename: 'clip.mp4',
				clientContentType: 'video/mp4'
			},
			storageMetadata: null
		});

		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}

		expect(result.failure.code).toBe('missing_storage_metadata');
	});

	it('marks a clean image ready when safety screening finds no labels', async () => {
		const result = await runMediaPipeline({
			asset: {
				acceptedContentTypes: ['image/png'],
				maxBytes: 5 * 1024 * 1024,
				enableCompression: false,
				enableSafetyScreening: true,
				originalFilename: 'poster.png',
				clientContentType: 'image/png'
			},
			storageMetadata: {
				storageProvider: 's3',
				bucket: 'curiosity-media',
				objectKey: 'dev/media-assets/owners/user/assets/asset/raw/r1/poster.png',
				detectedContentType: 'image/png',
				contentType: 'image/png',
				size: 1024
			},
			moderateImage: async () => []
		});

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}

		expect(result.descriptor.moderation?.status).toBe('clean');
	});

	it('flags an image for review without blocking the upload', async () => {
		const result = await runMediaPipeline({
			asset: {
				acceptedContentTypes: ['image/png'],
				maxBytes: 5 * 1024 * 1024,
				enableCompression: false,
				enableSafetyScreening: true,
				originalFilename: 'poster.png',
				clientContentType: 'image/png'
			},
			storageMetadata: {
				storageProvider: 's3',
				bucket: 'curiosity-media',
				objectKey: 'dev/media-assets/owners/user/assets/asset/raw/r1/poster.png',
				detectedContentType: 'image/png',
				contentType: 'image/png',
				size: 1024
			},
			moderateImage: async () => [{ name: 'Suggestive', confidence: 65 }]
		});

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}

		expect(result.descriptor.moderation?.status).toBe('flagged');
	});

	it('flags an oversized image for review instead of screening it', async () => {
		const moderateImage = vi.fn(async () => []);
		const result = await runMediaPipeline({
			asset: {
				acceptedContentTypes: ['image/png'],
				maxBytes: 20 * 1024 * 1024,
				enableCompression: false,
				enableSafetyScreening: true,
				originalFilename: 'poster.png',
				clientContentType: 'image/png'
			},
			storageMetadata: {
				storageProvider: 's3',
				bucket: 'curiosity-media',
				objectKey: 'dev/media-assets/owners/user/assets/asset/raw/r1/poster.png',
				detectedContentType: 'image/png',
				contentType: 'image/png',
				size: 6 * 1024 * 1024
			},
			moderateImage
		});

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}

		expect(result.descriptor.moderation?.status).toBe('flagged');
		expect(moderateImage).not.toHaveBeenCalled();
	});

	it('blocks an image upload with the generic user-facing message on clear violations', async () => {
		const result = await runMediaPipeline({
			asset: {
				acceptedContentTypes: ['image/png'],
				maxBytes: 5 * 1024 * 1024,
				enableCompression: false,
				enableSafetyScreening: true,
				originalFilename: 'poster.png',
				clientContentType: 'image/png'
			},
			storageMetadata: {
				storageProvider: 's3',
				bucket: 'curiosity-media',
				objectKey: 'dev/media-assets/owners/user/assets/asset/raw/r1/poster.png',
				detectedContentType: 'image/png',
				contentType: 'image/png',
				size: 1024
			},
			moderateImage: async () => [{ name: 'Explicit Nudity', confidence: 92 }]
		});

		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}

		expect(result.failure.code).toBe('blocked_by_safety_screening');
		expect(result.failure.message).toBe(
			'This image/video could not be uploaded. If you believe this is an error, please try a different file.'
		);
		expect(result.descriptor?.moderation?.status).toBe('blocked');
	});

	it('marks video uploads as skipped-video without calling the image moderator', async () => {
		const moderateImage = async () => {
			throw new Error('should not be called for video uploads');
		};

		const result = await runMediaPipeline({
			asset: {
				acceptedContentTypes: ['video/mp4'],
				maxBytes: 20 * 1024 * 1024,
				enableCompression: false,
				enableSafetyScreening: true,
				originalFilename: 'clip.mp4',
				clientContentType: 'video/mp4'
			},
			storageMetadata: {
				storageProvider: 's3',
				bucket: 'curiosity-media',
				objectKey: 'dev/media-assets/owners/user/assets/asset/raw/r1/clip.mp4',
				detectedContentType: 'video/mp4',
				contentType: 'video/mp4',
				size: 2048
			},
			moderateImage
		});

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}

		expect(result.descriptor.moderation?.status).toBe('skipped-video');
	});

	it('records client-compressed outcome when the client reports compression', async () => {
		const result = await runMediaPipeline({
			asset: {
				acceptedContentTypes: ['image/png'],
				maxBytes: 5 * 1024 * 1024,
				enableCompression: true,
				enableSafetyScreening: false,
				originalFilename: 'poster.png',
				clientContentType: 'image/png',
				clientReportedImageCompression: true
			},
			storageMetadata: {
				storageProvider: 's3',
				bucket: 'curiosity-media',
				objectKey: 'dev/media-assets/owners/user/assets/asset/raw/r1/poster.png',
				detectedContentType: 'image/png',
				contentType: 'image/png',
				size: 1024
			}
		});

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}

		const compressStep = result.steps.find((step) => step.step === 'compress-image');
		expect(compressStep?.status).toBe('passed');
	});

	it('records skipped outcome for compress-image when the client did not report compression', async () => {
		const result = await runMediaPipeline({
			asset: {
				acceptedContentTypes: ['image/png'],
				maxBytes: 5 * 1024 * 1024,
				enableCompression: true,
				enableSafetyScreening: false,
				originalFilename: 'poster.png',
				clientContentType: 'image/png'
			},
			storageMetadata: {
				storageProvider: 's3',
				bucket: 'curiosity-media',
				objectKey: 'dev/media-assets/owners/user/assets/asset/raw/r1/poster.png',
				detectedContentType: 'image/png',
				contentType: 'image/png',
				size: 1024
			}
		});

		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}

		const compressStep = result.steps.find((step) => step.step === 'compress-image');
		expect(compressStep?.status).toBe('skipped');
	});
});
