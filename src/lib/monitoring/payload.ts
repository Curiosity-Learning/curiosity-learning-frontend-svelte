import { redactText } from './redaction';

export type OperationalArea = 'admin' | 'auth' | 'backend' | 'convex-query' | 'email' | 'media';
export type OperationalLevel = 'error' | 'warning';

export type OperationalIdentifiers = Record<string, string | number | boolean | null | undefined>;

export type OperationalReportPayload = {
	area: OperationalArea;
	operation: string;
	level?: OperationalLevel;
	message: string;
	name?: string;
	stack?: string;
	identifiers?: OperationalIdentifiers;
};

const OPERATION_PATTERN = /^[a-z0-9][a-z0-9:._-]{0,79}$/;
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
const OPERATIONAL_AREAS = new Set<OperationalArea>([
	'admin',
	'auth',
	'backend',
	'convex-query',
	'email',
	'media'
]);

const truncate = (value: string, maxLength: number) =>
	value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

export const sanitizeOperationalIdentifiers = (
	identifiers: OperationalIdentifiers | undefined
): Record<string, string | number | boolean | null> =>
	Object.fromEntries(
		Object.entries(identifiers ?? {}).filter(
			(entry): entry is [string, string | number | boolean | null] =>
				SAFE_IDENTIFIER_KEYS.has(entry[0]) && entry[1] !== undefined
		)
	);

export const parseOperationalReportPayload = (value: unknown): OperationalReportPayload | null => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}

	const input = value as Record<string, unknown>;
	if (
		typeof input.area !== 'string' ||
		!OPERATIONAL_AREAS.has(input.area as OperationalArea) ||
		typeof input.operation !== 'string' ||
		!OPERATION_PATTERN.test(input.operation) ||
		typeof input.message !== 'string' ||
		!input.message.trim()
	) {
		return null;
	}

	const level = input.level === 'warning' ? 'warning' : 'error';
	const identifiers =
		input.identifiers && typeof input.identifiers === 'object' && !Array.isArray(input.identifiers)
			? sanitizeOperationalIdentifiers(input.identifiers as OperationalIdentifiers)
			: {};

	return {
		area: input.area as OperationalArea,
		operation: input.operation,
		level,
		message: truncate(redactText(input.message.trim()), 1000),
		name:
			typeof input.name === 'string' && input.name.trim()
				? truncate(redactText(input.name.trim()), 120)
				: undefined,
		stack:
			typeof input.stack === 'string' && input.stack.trim()
				? truncate(redactText(input.stack.trim()), 8000)
				: undefined,
		identifiers
	};
};
