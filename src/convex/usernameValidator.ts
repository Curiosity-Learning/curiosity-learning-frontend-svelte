/**
 * Username validation utilities for Convex.
 * Usernames must contain only lowercase letters, underscores, and numbers.
 */

const USERNAME_PATTERN = /^[a-z0-9_]+$/;
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 30;

export const isValidUsername = (username: string): boolean => {
	if (!username) return false;
	if (username.length < MIN_USERNAME_LENGTH || username.length > MAX_USERNAME_LENGTH) {
		return false;
	}
	return USERNAME_PATTERN.test(username);
};

/**
 * Derives a valid username candidate from an email's local part. Email prefixes may contain
 * characters the username rules reject (dots, hyphens, plus signs), so they can't be used
 * verbatim as defaults. Returns undefined when nothing usable remains.
 */
export const sanitizeUsernameFromEmail = (email: string): string | undefined => {
	const sanitized = (email.split('@')[0] ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, MAX_USERNAME_LENGTH);
	return sanitized.length >= MIN_USERNAME_LENGTH ? sanitized : undefined;
};

export const getUsernameValidationError = (username: string): string | null => {
	if (!username) {
		return 'Username is required';
	}
	if (username.length < MIN_USERNAME_LENGTH) {
		return `Username must be at least ${MIN_USERNAME_LENGTH} characters long`;
	}
	if (username.length > MAX_USERNAME_LENGTH) {
		return `Username must be no more than ${MAX_USERNAME_LENGTH} characters`;
	}
	if (!USERNAME_PATTERN.test(username)) {
		return 'Username can only contain lowercase letters, numbers, and underscores';
	}
	return null;
};
