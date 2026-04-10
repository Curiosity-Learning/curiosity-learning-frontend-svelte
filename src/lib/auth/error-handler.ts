/**
 * Auth error normalization and translation.
 * Converts raw server errors into user-friendly messages.
 */

export type AuthErrorType =
	| 'invalid-credentials'
	| 'email-not-verified'
	| 'email-already-exists'
	| 'invalid-email'
	| 'password-too-weak'
	| 'passwords-mismatch'
	| 'invalid-code'
	| 'code-expired'
	| 'rate-limited'
	| 'network-error'
	| 'unknown-error';

export interface NormalizedAuthError {
	type: AuthErrorType;
	message: string;
	userMessage: string; // i18n key
	details?: string; // Additional context
}

/**
 * Normalize and classify an auth error from Better Auth or server response
 */
export function normalizeAuthError(error: unknown): NormalizedAuthError {
	const errorMessage = getErrorMessage(error).toLowerCase().trim();

	// Server/network errors
	if (errorMessage.includes('500') || errorMessage.includes('internal') || errorMessage.includes('server')) {
		return {
			type: 'unknown-error',
			message: errorMessage,
			userMessage: 'auth.errors.serverError'
		};
	}

	// Rate limiting
	if (errorMessage.includes('too many') || errorMessage.includes('rate limit')) {
		return {
			type: 'rate-limited',
			message: errorMessage,
			userMessage: 'auth.errors.rateLimited'
		};
	}

	// Email verification
	if (errorMessage.includes('not verified') || errorMessage.includes('unverified')) {
		return {
			type: 'email-not-verified',
			message: errorMessage,
			userMessage: 'auth.errors.emailNotVerified'
		};
	}

	// Email already exists
	if (errorMessage.includes('already exists') || errorMessage.includes('already registered')) {
		return {
			type: 'email-already-exists',
			message: errorMessage,
			userMessage: 'auth.errors.emailAlreadyExists'
		};
	}

	// Invalid email format
	if (errorMessage.includes('invalid email')) {
		return {
			type: 'invalid-email',
			message: errorMessage,
			userMessage: 'auth.errors.invalidEmail'
		};
	}

	// Invalid credentials
	if (
		errorMessage.includes('invalid') ||
		errorMessage.includes('incorrect') ||
		errorMessage.includes('wrong') ||
		errorMessage.includes('credentials')
	) {
		return {
			type: 'invalid-credentials',
			message: errorMessage,
			userMessage: 'auth.errors.invalidCredentials'
		};
	}

	// Password too weak
	if (
		errorMessage.includes('password') &&
		(errorMessage.includes('weak') || errorMessage.includes('strength') || errorMessage.includes('require'))
	) {
		return {
			type: 'password-too-weak',
			message: errorMessage,
			userMessage: 'auth.errors.passwordTooWeak'
		};
	}

	// Mismatch (caught earlier but included for completeness)
	if (errorMessage.includes('mismatch') || errorMessage.includes('match')) {
		return {
			type: 'passwords-mismatch',
			message: errorMessage,
			userMessage: 'auth.errors.passwordsMismatch'
		};
	}

	// Verification code errors
	if (errorMessage.includes('invalid') && errorMessage.includes('code')) {
		return {
			type: 'invalid-code',
			message: errorMessage,
			userMessage: 'auth.errors.invalidVerificationCode'
		};
	}

	if (errorMessage.includes('code') && (errorMessage.includes('expire') || errorMessage.includes('expired'))) {
		return {
			type: 'code-expired',
			message: errorMessage,
			userMessage: 'auth.errors.verificationCodeExpired'
		};
	}

	// Network issues
	if (
		errorMessage.includes('network') ||
		errorMessage.includes('offline') ||
		errorMessage.includes('fetch') ||
		errorMessage.includes('timeout')
	) {
		return {
			type: 'network-error',
			message: errorMessage,
			userMessage: 'auth.errors.networkError'
		};
	}

	// Default case
	return {
		type: 'unknown-error',
		message: errorMessage || 'Unknown error',
		userMessage: 'auth.errors.unknownError'
	};
}

/**
 * Extract error message from various error types
 */
function getErrorMessage(error: unknown): string {
	if (typeof error === 'string') return error;

	if (error instanceof Error) return error.message;

	if (error && typeof error === 'object') {
		// Better Auth error format
		if ('message' in error && typeof error.message === 'string') {
			return error.message;
		}

		// Convex error format
		if ('error' in error && typeof error.error === 'string') {
			return error.error;
		}

		// Generic object with error property
		if ('error' in error && error.error instanceof Error) {
			return error.error.message;
		}
	}

	return String(error);
}

/**
 * Check if error is authentication-related
 */
export function isAuthError(error: unknown): boolean {
	const normalized = normalizeAuthError(error);
	return normalized.type !== 'unknown-error' || getErrorMessage(error).length > 0;
}
