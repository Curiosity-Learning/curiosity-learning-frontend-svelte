import { describe, expect, it } from 'vitest';
import type { ModerationLabel } from '@aws-sdk/client-rekognition';
import {
	detectBufferContentType,
	mapModerationLabelsToDecision,
	validateDurationSeconds
} from './mediaProcessingHelpers';

const PNG_BYTES = Uint8Array.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
	0x44, 0x52
]);

const JPEG_BYTES = Uint8Array.from([
	0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
	0x07, 0x07
]);

describe('media processing helpers', () => {
	it('detects MIME types from file bytes', async () => {
		await expect(detectBufferContentType(PNG_BYTES)).resolves.toBe('image/png');
		await expect(detectBufferContentType(JPEG_BYTES)).resolves.toBe('image/jpeg');
	});

	it('enforces optional max video duration', () => {
		expect(
			validateDurationSeconds({
				durationSeconds: 90,
				maxDurationSeconds: 120
			})
		).toBeNull();

		expect(
			validateDurationSeconds({
				durationSeconds: 121,
				maxDurationSeconds: 120
			})?.code
		).toBe('video_too_long');
	});

	it('maps moderation labels into a binary decision', () => {
		expect(mapModerationLabelsToDecision({ labels: [] }).decision).toBe('approved');

		const labels = [
			{
				Name: 'Explicit Nudity',
				Confidence: 99
			}
		] satisfies ModerationLabel[];

		const result = mapModerationLabelsToDecision({ labels });
		expect(result.decision).toBe('rejected');
		expect(result.failure?.code).toBe('media_rejected');
	});
});
