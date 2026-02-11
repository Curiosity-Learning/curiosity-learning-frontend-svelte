import { defineConfig } from '@playwright/test';

// Fast local mode: assumes a dev server is already running.
// Point tests at it via `E2E_BASE_URL` (default in tests is http://localhost:4173).
export default defineConfig({
	testDir: 'e2e'
});
