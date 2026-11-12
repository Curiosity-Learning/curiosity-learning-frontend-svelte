const USERNAME_PATTERN = /^[a-z0-9_]+$/;
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 30;

export const normalizeUsername = (value: string) => value.trim().toLowerCase();

/**
 * Best-effort conversion of an arbitrary string (e.g. an email-derived default) into a valid
 * username suggestion. Returns '' when nothing usable remains, so callers can fall back to an
 * empty field instead of pre-filling a value the validator would reject.
 */
export const sanitizeUsernameSuggestion = (value: string) => {
	const sanitized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, MAX_USERNAME_LENGTH);
	return sanitized.length >= MIN_USERNAME_LENGTH ? sanitized : '';
};

export const getUsernameValidationError = (username: string) => {
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
	return '';
};
