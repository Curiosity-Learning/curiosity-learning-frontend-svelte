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
