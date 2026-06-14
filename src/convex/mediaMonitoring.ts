const EXPECTED_MEDIA_FAILURE_CODES = new Set([
	'empty_file',
	'file_too_large',
	'unsupported_media_signature',
	'unsupported_media_type'
]);

export const isOperationalMediaFailure = (failureCode: string) =>
	!EXPECTED_MEDIA_FAILURE_CODES.has(failureCode);
