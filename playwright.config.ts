import { defineConfig } from '@playwright/test';

const E2E_AUTH_SECRET = 'playwright-local-secret-value-2026';

export default defineConfig({
	webServer: {
		// Don't rely on Vite loading `.env` during `vite preview`.
		// Inject a stable Better Auth secret so the preview server can boot for the suite.
		command: `BETTER_AUTH_SECRET=${E2E_AUTH_SECRET} BETTER_AUTH_URL=http://localhost:4173 npm run build && BETTER_AUTH_SECRET=${E2E_AUTH_SECRET} BETTER_AUTH_URL=http://localhost:4173 npm run preview -- --host 0.0.0.0 --port 4173`,
		url: 'http://localhost:4173',
		reuseExistingServer: true,
		timeout: 120_000
	},
	testDir: 'e2e'
});
