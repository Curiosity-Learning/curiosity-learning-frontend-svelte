import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			runtime: 'nodejs22.x'
		}),
		version: {
			// Poll `_app/version.json` so a tab left open across a deploy learns about the new
			// build; the next navigation then becomes a full-page load (CL-806).
			pollInterval: 5 * 60 * 1000
		},
		alias: {
			$convex: './src/convex'
		}
	}
};

export default config;
