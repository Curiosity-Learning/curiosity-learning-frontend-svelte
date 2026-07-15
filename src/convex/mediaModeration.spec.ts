import { describe, expect, it } from 'vitest';
import { decideMediaModerationStatus } from './mediaModeration';

describe('decideMediaModerationStatus', () => {
	it('marks clean when there are no labels', () => {
		const result = decideMediaModerationStatus([]);
		expect(result.status).toBe('clean');
		expect(result.labels).toEqual([]);
		expect(result.maxConfidence).toBeUndefined();
	});

	it('marks clean when all labels are below the flag threshold', () => {
		const result = decideMediaModerationStatus([
			{ name: 'Explicit Nudity', confidence: 49.9 },
			{ name: 'Rude Gestures', confidence: 10 }
		]);
		expect(result.status).toBe('clean');
	});

	it('flags borderline suggestive content between 50 and 80 confidence', () => {
		const result = decideMediaModerationStatus([{ name: 'Suggestive', confidence: 65 }]);
		expect(result.status).toBe('flagged');
		expect(result.maxConfidence).toBe(65);
		expect(result.labels).toHaveLength(1);
	});

	it('flags a clear-violation category when confidence is below the block threshold', () => {
		const result = decideMediaModerationStatus([
			{ name: 'Explicit Nudity', confidence: 79.9 }
		]);
		expect(result.status).toBe('flagged');
	});

	it('blocks a clear-violation category at or above the block threshold', () => {
		const result = decideMediaModerationStatus([{ name: 'Explicit Nudity', confidence: 80 }]);
		expect(result.status).toBe('blocked');
		expect(result.maxConfidence).toBe(80);
	});

	it('blocks Sexual Activity at high confidence', () => {
		const result = decideMediaModerationStatus([
			{ name: 'Sexual Activity', confidence: 95, parentName: 'Explicit Nudity' }
		]);
		expect(result.status).toBe('blocked');
	});

	it('blocks based on parent category when child label name is not itself listed', () => {
		const result = decideMediaModerationStatus([
			{ name: 'Some New Sub-Label', confidence: 90, parentName: 'Explicit Nudity' }
		]);
		expect(result.status).toBe('blocked');
	});

	it('does not block a non-violation category even at very high confidence', () => {
		const result = decideMediaModerationStatus([{ name: 'Violence', confidence: 99 }]);
		expect(result.status).toBe('flagged');
	});

	it('picks the maximum confidence across multiple labels', () => {
		const result = decideMediaModerationStatus([
			{ name: 'Suggestive', confidence: 55 },
			{ name: 'Rude Gestures', confidence: 72 }
		]);
		expect(result.status).toBe('flagged');
		expect(result.maxConfidence).toBe(72);
	});

	it('blocks when any label clears the block threshold even if others are lower', () => {
		const result = decideMediaModerationStatus([
			{ name: 'Suggestive', confidence: 55 },
			{ name: 'Explicit Nudity', confidence: 85 }
		]);
		expect(result.status).toBe('blocked');
		expect(result.maxConfidence).toBe(85);
	});

	it('ignores labels below the flag threshold when computing maxConfidence', () => {
		const result = decideMediaModerationStatus([
			{ name: 'Suggestive', confidence: 60 },
			{ name: 'Irrelevant', confidence: 20 }
		]);
		expect(result.maxConfidence).toBe(60);
		expect(result.labels).toHaveLength(1);
	});
});
