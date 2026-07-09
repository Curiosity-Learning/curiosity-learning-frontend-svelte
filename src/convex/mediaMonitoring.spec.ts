import { describe, expect, it } from 'vitest';
import { isOperationalMediaFailure } from './mediaMonitoring';

describe('media monitoring failure classification', () => {
	it('ignores user-correctable validation failures', () => {
		expect(isOperationalMediaFailure('unsupported_media_type')).toBe(false);
		expect(isOperationalMediaFailure('file_too_large')).toBe(false);
	});

	it('ignores expected safety-screening blocks', () => {
		expect(isOperationalMediaFailure('blocked_by_safety_screening')).toBe(false);
	});

	it('alerts on operational pipeline failures', () => {
		expect(isOperationalMediaFailure('missing_storage_metadata')).toBe(true);
		expect(isOperationalMediaFailure('pipeline_failed')).toBe(true);
	});
});
