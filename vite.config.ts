import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';
import { sentrySvelteKit } from '@sentry/sveltekit';

export default defineConfig({
	server: {
		allowedHosts: ['arrased-semiurban-jean.ngrok-free.dev']
	},
	plugins: [
		tailwindcss(),
		sentrySvelteKit({
			org: 'curiosity-learning',
			project: 'javascript-sveltekit',
			authToken: process.env.SENTRY_AUTH_TOKEN,
			autoUploadSourceMaps: Boolean(process.env.SENTRY_AUTH_TOKEN),
			autoInstrument: false
		}),
		sveltekit()
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
