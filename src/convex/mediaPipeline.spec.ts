import { describe, expect, it } from 'vitest';
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
});
