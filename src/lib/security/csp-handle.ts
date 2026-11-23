import type { Handle } from '@sveltejs/kit';
import {
	CSP_REPORT_ONLY_HEADER,
	CSP_REPORTING_GROUP,
	extendCspHeader,
	isCspReportingSensitiveUrl,
	type resolveRuntimeCsp
} from './csp';

/**
 * Extends the report-only CSP that SvelteKit sets on rendered pages with runtime hosts and the
 * Sentry report endpoint. Responses without the header (endpoints, assets) pass through as-is.
 *
 * Pages with a secret in the URL (see isCspReportingSensitiveUrl) get no report endpoint: no
 * report-uri and no Reporting-Endpoints. The static `report-to csp-endpoint` stays in the policy
 * so browsers do not warn about a report-only policy without reporting, but with the group
 * undefined they have nowhere to send. Those pages also send `Referrer-Policy: strict-origin`,
 * so the next page's reports cannot carry the token in `referrer` either.
 */
export const createCspHandle =
	(runtimeCsp: ReturnType<typeof resolveRuntimeCsp>): Handle =>
	async ({ event, resolve }) => {
		const response = await resolve(event);
		const sensitive = isCspReportingSensitiveUrl(event.url);
		if (sensitive) {
			// Every response, redirects included: the page a redirect lands on must not see the
			// token in document.referrer either.
			try {
				response.headers.set('referrer-policy', 'strict-origin');
			} catch {
				// Immutable headers (e.g. Response.redirect): leave the response as it is.
			}
		}
		const header = response.headers.get(CSP_REPORT_ONLY_HEADER);
		if (!header) return response;
		const csp = sensitive ? { ...runtimeCsp, reportUri: null } : runtimeCsp;
		try {
			response.headers.set(CSP_REPORT_ONLY_HEADER, extendCspHeader(header, csp));
			if (sensitive) {
				response.headers.delete('reporting-endpoints');
			} else if (csp.reportUri) {
				response.headers.set('reporting-endpoints', `${CSP_REPORTING_GROUP}="${csp.reportUri}"`);
			}
		} catch {
			// Immutable headers: keep SvelteKit's baseline policy rather than failing the request.
		}
		return response;
	};
