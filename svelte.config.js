import adapter from '@sveltejs/adapter-vercel';
import { cspDirectives } from './src/lib/security/csp.js';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			runtime: 'nodejs22.x'
		}),
		// Report-only first (CL-818): violations are reported to Sentry, nothing is blocked.
		// Runtime hosts and the report endpoint are added in src/hooks.server.ts.
		csp: {
			mode: 'auto',
			reportOnly: cspDirectives
		},
		alias: {
			$convex: './src/convex'
		}
	}
};

export default config;
