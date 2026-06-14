import { describe, expect, it } from 'vitest';
import { hasValidMonitoringSecret, parseMonitoringReportBody } from './monitoring-report';

describe('backend monitoring reports', () => {
	it('requires an exact shared secret', () => {
		expect(hasValidMonitoringSecret('correct-secret', 'correct-secret')).toBe(true);
		expect(hasValidMonitoringSecret('wrong-secret', 'correct-secret')).toBe(false);
		expect(hasValidMonitoringSecret(null, 'correct-secret')).toBe(false);
	});

	it('accepts only allowlisted context and redacts sensitive text', () => {
		expect(
			parseMonitoringReportBody(
				JSON.stringify({
					area: 'email',
					operation: 'resend:send',
					message: 'Failed for parent@example.com',
					identifiers: {
						emailType: 'parent-consent',
						recipient: 'parent@example.com'
					}
				})
			)
		).toMatchObject({
			area: 'email',
			operation: 'resend:send',
			message: 'Failed for [Redacted email]',
			identifiers: { emailType: 'parent-consent' }
		});
	});

	it('rejects invalid and oversized reports', () => {
		expect(parseMonitoringReportBody('{}')).toBeNull();
		expect(parseMonitoringReportBody('x'.repeat(17 * 1024))).toBeNull();
	});
});
