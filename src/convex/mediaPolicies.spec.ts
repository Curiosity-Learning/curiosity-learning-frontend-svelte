import { describe, expect, it } from 'vitest';
import { canAttachToProjectUpdate } from './mediaPolicies';

describe('project update media policy', () => {
	it('accepts approved uploads that satisfy the project update policy', () => {
		expect(
			canAttachToProjectUpdate({
				status: 'ready',
				moderationStatus: 'approved',
				storageId: 'storage_1' as never,
				acceptedContentTypes: ['video/mp4'],
				maxBytes: 10 * 1024 * 1024,
				maxDurationSeconds: 120,
				enableCompression: true,
				enableSafetyScreening: true
			})
		).toBe(true);
	});

	it('rejects uploads that skipped safety screening', () => {
		expect(
			canAttachToProjectUpdate({
				status: 'ready',
				moderationStatus: 'approved',
				storageId: 'storage_1' as never,
				acceptedContentTypes: ['video/mp4'],
				maxBytes: 10 * 1024 * 1024,
				maxDurationSeconds: 120,
				enableCompression: true,
				enableSafetyScreening: false
			})
		).toBe(false);
	});
});
