import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Signed-in role suite (CL-816). Runs against an app that is already up: this worktree's dev
// server by default, or any URL in E2E_BASE_URL (e.g. a Vercel branch preview, together with
// VERCEL_AUTOMATION_BYPASS_SECRET). Test-account passwords come from `.env.e2e`.
//
//   npm run test:e2e:roles
//   E2E_BASE_URL=https://<preview>.vercel.app VERCEL_AUTOMATION_BYPASS_SECRET=… npm run test:e2e:roles

const loadEnvFile = (file: string) => {
	if (fs.existsSync(file)) process.loadEnvFile(file);
};
loadEnvFile('.env.e2e');

// A worktree's `.env.local` names its own host and port (see docs/worktrees.md).
const worktreeUrl = () => {
	if (!fs.existsSync('.env.local')) return null;
	const env = Object.fromEntries(
		fs
			.readFileSync('.env.local', 'utf8')
			.split('\n')
			.map((line) => line.match(/^\s*([A-Z_]+)\s*=\s*([^#\s]*)/))
			.filter((match): match is RegExpMatchArray => match !== null)
			.map((match) => [match[1], match[2]])
	);
	return env.WORKTREE_HOST && env.WORKTREE_PORT
		? `http://${env.WORKTREE_HOST}:${env.WORKTREE_PORT}`
		: null;
};

const baseURL = process.env.E2E_BASE_URL ?? worktreeUrl() ?? 'http://localhost:5173';

export default defineConfig({
	testDir: 'e2e/roles',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: 0,
	workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 4,
	timeout: 60_000,
	expect: { timeout: 15_000 },
	reporter: [['list']],
	use: {
		...devices['Desktop Chrome'],
		baseURL,
		// Traces record request headers, so one taken during the Vercel bypass would write the
		// secret to disk. Off by default; E2E_TRACE=1 turns them on, never with the secret set.
		trace:
			process.env.E2E_TRACE === '1' && !process.env.VERCEL_AUTOMATION_BYPASS_SECRET
				? 'retain-on-failure'
				: 'off'
	},
	projects: [
		{ name: 'setup', testMatch: /auth\.setup\.ts$/ },
		{ name: 'roles', testMatch: /\.test\.ts$/, dependencies: ['setup'] }
	]
});
