import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/monitoring/capture', () => ({ captureUnexpectedOperationalError: vi.fn() }));

import { normalizeAuthError } from './error-handler';

// Messages as Better Auth sends them (BASE_ERROR_CODES and the username plugin).
describe('normalizeAuthError sign-in failures', () => {
	it('treats a wrong password for an email sign-in as invalid credentials', () => {
		const result = normalizeAuthError({
			code: 'INVALID_EMAIL_OR_PASSWORD',
			message: 'Invalid email or password',
			status: 401
		});
		expect(result.type).toBe('invalid-credentials');
		expect(result.userMessage).toBe('auth.errors.invalidCredentials');
	});

	it('treats a wrong password for a username sign-in as invalid credentials', () => {
		const result = normalizeAuthError({
			code: 'INVALID_USERNAME_OR_PASSWORD',
			message: 'Invalid username or password',
			status: 401
		});
		expect(result.type).toBe('invalid-credentials');
		expect(result.userMessage).toBe('auth.errors.invalidCredentials');
	});

	it('still reports a malformed email as an invalid email', () => {
		for (const message of ['Invalid email', 'Invalid email.', 'Invalid email address']) {
			const result = normalizeAuthError({ code: 'INVALID_EMAIL', message, status: 400 });
			expect(result.type).toBe('invalid-email');
			expect(result.userMessage).toBe('auth.errors.invalidEmail');
		}
	});
});
