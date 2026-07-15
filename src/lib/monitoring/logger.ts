import * as Sentry from '@sentry/sveltekit';
import { dev } from '$app/environment';
import {
	sanitizeOperationalIdentifiers,
	type OperationalArea,
	type OperationalIdentifiers
} from './payload';

export type OperationalLogContext = {
	area: OperationalArea;
	operation: string;
	identifiers?: OperationalIdentifiers;
};

const withOperationalScope = (context: OperationalLogContext, run: () => void) => {
	Sentry.withScope((scope) => {
		scope.setTag('operational.area', context.area);
		scope.setTag('operational.operation', context.operation);
		scope.setContext('operational', sanitizeOperationalIdentifiers(context.identifiers));
		run();
	});
};

/** GDPR-safe structured log — no user email, name, or auth identifiers. */
export const logOperational = (
	level: 'debug' | 'info' | 'warn' | 'error',
	message: string,
	context?: OperationalLogContext
) => {
	const identifiers = context ? sanitizeOperationalIdentifiers(context.identifiers) : {};

	if (dev) {
		const consoleMethod = level === 'debug' ? 'log' : level;
		console[consoleMethod](
			`[${context?.area ?? 'app'}:${context?.operation ?? 'log'}]`,
			message,
			identifiers
		);
	}

	if (!Sentry.isEnabled()) return;

	if (context) {
		withOperationalScope(context, () => {
			Sentry.logger[level](message, identifiers);
		});
		return;
	}

	Sentry.logger[level](message, identifiers);
};

export const addOperationalBreadcrumb = (
	message: string,
	context: OperationalLogContext,
	level: 'debug' | 'info' | 'warning' | 'error' = 'info'
) => {
	if (!Sentry.isEnabled()) return;

	Sentry.addBreadcrumb({
		category: `operational.${context.area}`,
		message,
		level,
		data: sanitizeOperationalIdentifiers(context.identifiers)
	});
};
