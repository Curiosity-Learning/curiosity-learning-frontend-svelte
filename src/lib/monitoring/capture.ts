import * as Sentry from '@sentry/sveltekit';
import {
	sanitizeOperationalIdentifiers,
	type OperationalArea,
	type OperationalIdentifiers,
	type OperationalLevel
} from './payload';

export type OperationalErrorContext = {
	area: OperationalArea;
	operation: string;
	level?: OperationalLevel;
	identifiers?: OperationalIdentifiers;
};

const EXPECTED_ERROR_PATTERN =
	/(permission denied|authentication required|not authenticated|invalid credentials|not verified|already exists|already registered|not found|is required|must be|cannot|can't|not allowed|not ready|was canceled|too large|unsupported|expired|rate limit|too many|\b4\d{2}\b)/i;

const errorMessage = (error: unknown) => {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	if (error && typeof error === 'object' && 'message' in error) {
		return String(error.message);
	}
	return String(error);
};

export const isExpectedOperationalError = (error: unknown) =>
	EXPECTED_ERROR_PATTERN.test(errorMessage(error));

export const captureOperationalError = (error: unknown, context: OperationalErrorContext) => {
	Sentry.withScope((scope) => {
		scope.setLevel(context.level ?? 'error');
		scope.setTag('operational.area', context.area);
		scope.setTag('operational.operation', context.operation);
		scope.setContext('operational', sanitizeOperationalIdentifiers(context.identifiers));
		Sentry.captureException(error);
	});
};

export const captureUnexpectedOperationalError = (
	error: unknown,
	context: OperationalErrorContext
) => {
	if (isExpectedOperationalError(error)) {
		return false;
	}
	captureOperationalError(error, context);
	return true;
};
