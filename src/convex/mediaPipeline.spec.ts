import { describe, expect, it } from 'vitest';
import {
	MAX_SUPPORTED_UPLOAD_BYTES,
	assetSatisfiesUploadConstraints,
	normalizeUploadConstraints
} from './mediaPipeline';

describe('media pipeline constraints', () => {
	it('normalizes optional maxDurationSeconds for video uploads', () => {
		const constraints = normalizeUploadConstraints({
			acceptedContentTypes: ['video/mp4'],
			maxBytes: MAX_SUPPORTED_UPLOAD_BYTES,
			maxDurationSeconds: 120,
			enableCompression: true,
			enableSafetyScreening: true
		});

		expect(constraints.maxDurationSeconds).toBe(120);
		expect(constraints.enableCompression).toBe(true);
		expect(constraints.enableSafetyScreening).toBe(true);
	});

	it('rejects duration limits for image-only uploads', () => {
		expect(() =>
			normalizeUploadConstraints({
				acceptedContentTypes: ['image/jpeg'],
				maxBytes: 1024,
				maxDurationSeconds: 30
			})
		).toThrow(/maxDurationSeconds can only be set/i);
	});

	it('checks that an asset satisfies a stricter policy', () => {
		const required = normalizeUploadConstraints({
			acceptedContentTypes: ['image/jpeg', 'video/mp4'],
			maxBytes: 10 * 1024 * 1024,
			maxDurationSeconds: 120,
			enableCompression: true,
			enableSafetyScreening: true
		});

		expect(
			assetSatisfiesUploadConstraints(
				{
					acceptedContentTypes: ['video/mp4'],
					maxBytes: 5 * 1024 * 1024,
					maxDurationSeconds: 90,
					enableCompression: true,
					enableSafetyScreening: true
				},
				required
			)
		).toBe(true);

		expect(
			assetSatisfiesUploadConstraints(
				{
					acceptedContentTypes: ['video/mp4'],
					maxBytes: 5 * 1024 * 1024,
					maxDurationSeconds: undefined,
					enableCompression: true,
					enableSafetyScreening: true
				},
				required
			)
		).toBe(false);
	});
});
