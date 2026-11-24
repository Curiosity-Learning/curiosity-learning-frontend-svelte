import adapterVercel from '@sveltejs/adapter-vercel';
import adapterStatic from '@sveltejs/adapter-static';
import { cspDirectives } from './src/lib/security/csp.js';

// CL-819 spike (throwaway branch): `npm run build:capacitor-spike` sets CAPACITOR_SPIKE_BUILD=1
// and builds a separate, bundled single-page app (src/capacitor-spike/routes, SSR off) into
// build-capacitor/, which capacitor.config.ts ships inside the native apps. The normal web build
// is unchanged when the variable is unset.
const capacitorSpike = process.env.CAPACITOR_SPIKE_BUILD === '1';

/** @type {import('@sveltejs/kit').Config} */
const config = capacitorSpike
	? {
			kit: {
				adapter: adapterStatic({
					pages: 'build-capacitor',
					assets: 'build-capacitor',
					fallback: 'index.html',
					strict: true
				}),
				outDir: '.svelte-kit-capacitor',
				files: {
					routes: 'src/capacitor-spike/routes',
					// No such files: the spike runs without the web app's hooks (Sentry, CSP, proxy).
					hooks: {
						client: 'src/capacitor-spike/no-hooks.client',
						server: 'src/capacitor-spike/no-hooks.server',
						universal: 'src/capacitor-spike/no-hooks'
					}
				},
				alias: {
					$convex: './src/convex'
				}
			}
		}
	: {
			kit: {
				adapter: adapterVercel({
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
