import type { Handle } from '@sveltejs/kit';
import {
	CSP_REPORT_ONLY_HEADER,
	CSP_REPORTING_GROUP,
	extendCspHeader,
	type resolveRuntimeCsp
} from './csp';

/**
 * Extends the report-only CSP that SvelteKit sets on rendered pages with runtime hosts and the
 * Sentry report endpoint. Responses without the header (endpoints, assets) pass through as-is.
 */
export const createCspHandle =
	(runtimeCsp: ReturnType<typeof resolveRuntimeCsp>): Handle =>
	async ({ event, resolve }) => {
		const response = await resolve(event);
		const header = response.headers.get(CSP_REPORT_ONLY_HEADER);
		if (!header) return response;
		try {
			response.headers.set(CSP_REPORT_ONLY_HEADER, extendCspHeader(header, runtimeCsp));
			if (runtimeCsp.reportUri) {
				response.headers.set(
					'reporting-endpoints',
					`${CSP_REPORTING_GROUP}="${runtimeCsp.reportUri}"`
				);
			}
		} catch {
			// Immutable headers: keep SvelteKit's baseline policy rather than failing the request.
		}
		return response;
	};
