import * as Sentry from '@sentry/sveltekit';

export type OperationalArea = 'admin' | 'auth' | 'backend' | 'convex-query' | 'email' | 'media';

export type OperationalErrorContext = {
	area: OperationalArea;
	operation: string;
	level?: 'error' | 'warning';
	identifiers?: Record<string, string | number | boolean | null | undefined>;
};

const SAFE_IDENTIFIER_KEYS = new Set([
	'applicationId',
	'assetId',
	'attemptCount',
	'emailType',
	'failureCode',
	'functionName',
	'httpStatus',
	'provider',
	'status'
]);

const safeIdentifiers = (
	identifiers: OperationalErrorContext['identifiers']
): Record<string, string | number | boolean | null> =>
	Object.fromEntries(
		Object.entries(identifiers ?? {}).filter(
			(entry): entry is [string, string | number | boolean | null] =>
				SAFE_IDENTIFIER_KEYS.has(entry[0]) && entry[1] !== undefined
		)
	);

export const captureOperationalError = (error: unknown, context: OperationalErrorContext) => {
	Sentry.withScope((scope) => {
		scope.setLevel(context.level ?? 'error');
		scope.setTag('operational.area', context.area);
		scope.setTag('operational.operation', context.operation);
		scope.setContext('operational', safeIdentifiers(context.identifiers));
		Sentry.captureException(error);
	});
};
