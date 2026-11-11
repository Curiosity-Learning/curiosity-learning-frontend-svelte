#!/usr/bin/env node
// `npm run dev`: in a worktree, run Vite on the worktree's own port so it matches the
// BETTER_AUTH_URL its backend trusts (http://<worktree>.localhost:<port>). In the main checkout
// this is plain `vite dev`.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const env = {};
if (fs.existsSync('.env.local')) {
	for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
		const m = line.match(/^(WORKTREE_PORT|WORKTREE_HOST)=(.*)$/);
		if (m) env[m[1]] = m[2].trim();
	}
}

let args = process.argv.slice(2);
if (env.WORKTREE_PORT) {
	// Drop any --port/--strictPort the caller passed: another port would break sign-in.
	const out = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--port') i++;
		else if (!args[i].startsWith('--port=') && args[i] !== '--strictPort') out.push(args[i]);
	}
	args = ['--port', env.WORKTREE_PORT, '--strictPort', ...out];
	console.log(
		`\n  Worktree app: http://${env.WORKTREE_HOST}:${env.WORKTREE_PORT}  (use this URL, not localhost, so sign-in works)\n`
	);
}

const vite = path.join('node_modules', '.bin', 'vite');
const child = spawn(vite, ['dev', ...args], { stdio: 'inherit' });
child.on('exit', (code, signal) =>
	signal ? process.kill(process.pid, signal) : process.exit(code ?? 0)
);
