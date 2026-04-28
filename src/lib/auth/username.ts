const USERNAME_PATTERN = /^[a-z0-9_]+$/;
const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 30;

export const normalizeUsername = (value: string) => value.trim().toLowerCase();

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
