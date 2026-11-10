#!/usr/bin/env node
// Worktree tooling: every linked git worktree gets its own Convex dev backend (with a copy of the
// shared dev data and env vars), its own dev-server port and its own *.localhost hostname, so
// several features can run side by side without overwriting each other's backend or cookies.
//
// The main checkout keeps using the shared dev backend (SHARED_DEPLOYMENT below) on :5173.
//
//   node scripts/worktree/cli.mjs setup [--refresh-data] [--no-data]
//   node scripts/worktree/cli.mjs ensure          fast no-op when the worktree is already set up
//   node scripts/worktree/cli.mjs status          worktrees, their backends, and orphaned backends
//   node scripts/worktree/cli.mjs add <branch> [base-ref]
//   node scripts/worktree/cli.mjs remove [path]   delete the worktree's backend and the worktree
//   node scripts/worktree/cli.mjs prune [--yes]   delete backends whose worktree no longer exists
//   node scripts/worktree/cli.mjs refresh-data    replace this backend's data with a fresh dev copy
//
// Design notes and the why: docs/worktrees.md.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipTo, zipDir } from './zip.mjs';

const TEAM_SLUG = 'curiosity-learning';
const PROJECT_SLUG = 'curiosity-learning-flutter-to-svelte';
const SHARED_DEPLOYMENT = 'good-echidna-357';
const REF_PREFIX = 'dev/wt-';
const LEGACY_REF_PREFIX = 'dev/ronberlinski-worktree/';
const PORT_MIN = 5200;
const PORT_MAX = 5899;
const SETUP_VERSION = '1';
const API = 'https://api.convex.dev';

// Keys this script owns in a worktree's .env.local. Everything else is copied from the main
// checkout's env files or left alone if the developer added it by hand.
const MANAGED_KEYS = [
	'CONVEX_DEPLOYMENT',
	'CONVEX_DEPLOY_KEY',
	'PUBLIC_CONVEX_URL',
	'PUBLIC_CONVEX_SITE_URL',
	'BETTER_AUTH_URL',
	'WORKTREE_PORT',
	'WORKTREE_HOST',
	'WORKTREE_SETUP_VERSION'
];

// ---------------------------------------------------------------------------------------------
// small helpers

const log = (msg = '') => console.log(msg);
const step = (msg) => console.log(`\n▸ ${msg}`);
const fail = (msg) => {
	console.error(`\n✖ ${msg}`);
	process.exit(1);
};

function git(args, cwd = process.cwd()) {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	}).trim();
}

function slugify(value, max = 40) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, max)
		.replace(/-+$/g, '');
}

function repoInfo(cwd = process.cwd()) {
	const root = git(['rev-parse', '--show-toplevel'], cwd);
	const gitDir = path.resolve(root, git(['rev-parse', '--git-dir'], root));
	const commonDir = path.resolve(root, git(['rev-parse', '--git-common-dir'], root));
	const mainRoot = path.dirname(commonDir);
	return { root, gitDir, mainRoot, isWorktree: gitDir !== commonDir };
}

function listWorktrees(cwd) {
	const out = git(['worktree', 'list', '--porcelain'], cwd);
	const trees = [];
	let cur = null;
	for (const line of out.split('\n')) {
		if (line.startsWith('worktree ')) {
			cur = { path: line.slice(9) };
			trees.push(cur);
		} else if (cur && line.startsWith('branch ')) {
			cur.branch = line.slice(7).replace('refs/heads/', '');
		} else if (cur && line === 'prunable') {
			cur.prunable = true;
		}
	}
	return trees;
}

// Minimal dotenv reader: KEY=value, optional quotes, optional trailing " # comment" when unquoted.
function readEnv(file) {
	const env = {};
	if (!fs.existsSync(file)) return env;
	for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
		const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
		if (!m) continue;
		let value = m[2].trim();
		if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
		else value = value.replace(/\s+#.*$/, '');
		env[m[1]] = value;
	}
	return env;
}

// Rewrite an env file: drop the given keys' lines, then append `updates`. Comments, ordering and
// any hand-added keys survive.
function writeEnvWithout(file, dropKeys, updates = {}, header = '') {
	const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
	const drop = new Set([...dropKeys, ...Object.keys(updates)]);
	const kept = lines.filter((l) => {
		const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
		if (m && drop.has(m[1])) return false;
		return !(header && l.trim() === header);
	});
	while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
	const block = Object.entries(updates).map(([k, v]) => `${k}=${v}`);
	const out = [
		...kept,
		...(kept.length && block.length ? [''] : []),
		...(block.length && header ? [header] : []),
		...block
	];
	fs.writeFileSync(file, out.join('\n') + '\n', { mode: 0o600 });
}

function convexBin(root) {
	const bin = path.join(root, 'node_modules', '.bin', 'convex');
	if (!fs.existsSync(bin)) fail(`Convex CLI not found at ${bin}. Run npm install first.`);
	return bin;
}

// Run the Convex CLI against an explicit target so a command can never fall through to whatever
// .env.local happens to say. `selector` is either a dev deployment name (local runs, via the CLI
// login) or `{ deployKey, previewName? }` (Vercel builds, via deploy keys).
function convex(root, args, { selector, capture = false, allowFail = false, input } = {}) {
	const env = { ...process.env };
	delete env.CONVEX_DEPLOY_KEY;
	if (typeof selector === 'string') env.CONVEX_DEPLOYMENT = `dev:${selector}`;
	else if (selector?.deployKey) {
		delete env.CONVEX_DEPLOYMENT;
		env.CONVEX_DEPLOY_KEY = selector.deployKey;
		if (selector.previewName) args = [...args, '--preview-name', selector.previewName];
	}
	const res = spawnSync(convexBin(root), args, {
		cwd: root,
		env,
		input,
		encoding: 'utf8',
		stdio: capture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit']
	});
	if (res.status !== 0 && !allowFail) {
		if (capture) process.stderr.write(res.stderr || '');
		fail(`convex ${args.join(' ')} failed (exit ${res.status}).`);
	}
	return res;
}

// --- Convex management API (uses the CLI's login token from ~/.convex/config.json) -----------

function accessToken() {
	if (process.env.CONVEX_ACCESS_TOKEN) return process.env.CONVEX_ACCESS_TOKEN;
	const file = path.join(os.homedir(), '.convex', 'config.json');
	if (!fs.existsSync(file)) fail('Not logged in to Convex. Run `npx convex login` first.');
	return JSON.parse(fs.readFileSync(file, 'utf8')).accessToken;
}

async function api(method, pathname) {
	const res = await fetch(`${API}${pathname}`, {
		method,
		headers: { Authorization: `Bearer ${accessToken()}` }
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status} ${text.slice(0, 300)}`);
	return text ? JSON.parse(text) : null;
}

async function projectId() {
	const teams = await api('GET', '/api/teams');
	const team = teams.find((t) => t.slug === TEAM_SLUG);
	if (!team) throw new Error(`Convex team ${TEAM_SLUG} not visible to this login.`);
	const projects = await api('GET', `/v1/teams/${team.id}/list_projects`);
	const project = projects.find((p) => p.slug === PROJECT_SLUG);
	if (!project) throw new Error(`Convex project ${PROJECT_SLUG} not found.`);
	return project.id;
}

async function listDeployments() {
	return api('GET', `/v1/projects/${await projectId()}/list_deployments`);
}

async function deleteDeployment(name) {
	if (name === SHARED_DEPLOYMENT) throw new Error('Refusing to delete the shared dev deployment.');
	await api('POST', `/v1/deployments/${name}/delete`);
}

const isWorktreeRef = (ref = '') => ref.startsWith(REF_PREFIX) || ref.startsWith(LEGACY_REF_PREFIX);
const siteUrlFor = (cloudUrl) => cloudUrl.replace(/\.convex\.cloud\/?$/, '.convex.site');

// ---------------------------------------------------------------------------------------------
// ports: deterministic per worktree name, probing past ports other worktrees already claimed

function claimedPorts(mainRoot, selfRoot) {
	const ports = new Set([5173, 4173, 4174]);
	for (const wt of listWorktrees(mainRoot)) {
		if (path.resolve(wt.path) === path.resolve(selfRoot)) continue;
		const p = Number(readEnv(path.join(wt.path, '.env.local')).WORKTREE_PORT);
		if (p) ports.add(p);
	}
	return ports;
}

function pickPort(slug, mainRoot, selfRoot, current) {
	const taken = claimedPorts(mainRoot, selfRoot);
	if (current && !taken.has(current)) return current;
	const span = PORT_MAX - PORT_MIN + 1;
	const start = parseInt(createHash('sha1').update(slug).digest('hex').slice(0, 8), 16) % span;
	for (let i = 0; i < span; i++) {
		const port = PORT_MIN + ((start + i) % span);
		if (!taken.has(port)) return port;
	}
	fail('No free worktree port left.');
}

// ---------------------------------------------------------------------------------------------
// setup pieces

function ensureNodeModules(root) {
	if (fs.existsSync(path.join(root, 'node_modules', '.package-lock.json'))) return;
	step('Installing npm dependencies');
	const res = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
		cwd: root,
		stdio: 'inherit',
		env: { ...process.env, WORKTREE_SKIP_SETUP: '1' }
	});
	if (res.status !== 0) fail('npm install failed.');
}

// The worktree's .env starts as the main checkout's .env (local-only app settings such as the
// Mapbox token and CloudFront keys), minus anything that selects a backend or an origin.
function syncLocalEnvFiles(root, mainRoot) {
	const src = path.join(mainRoot, '.env');
	const dest = path.join(root, '.env');
	if (fs.existsSync(src)) {
		fs.copyFileSync(src, dest);
		fs.chmodSync(dest, 0o600);
		writeEnvWithout(dest, MANAGED_KEYS);
	}
	// Carry over extra keys from the main .env.local (e.g. PUBLIC_ADMIN_URL) without its backend.
	const mainLocal = readEnv(path.join(mainRoot, '.env.local'));
	const extras = Object.fromEntries(
		Object.entries(mainLocal).filter(([k]) => !MANAGED_KEYS.includes(k))
	);
	const localFile = path.join(root, '.env.local');
	const current = readEnv(localFile);
	const missing = Object.fromEntries(Object.entries(extras).filter(([k]) => !(k in current)));
	if (Object.keys(missing).length) writeEnvWithout(localFile, [], missing);
}

async function findOrCreateDeployment(root, slug, current) {
	const all = await listDeployments();
	const shared = all.find((d) => d.name === SHARED_DEPLOYMENT);
	if (!shared) throw new Error(`Shared dev deployment ${SHARED_DEPLOYMENT} not found.`);

	if (current && current !== SHARED_DEPLOYMENT) {
		const existing = all.find((d) => d.name === current);
		if (existing) return { deployment: existing, created: false };
		log(`  ${current} no longer exists; creating a new backend.`);
	}

	const ref = `${REF_PREFIX}${slug}`;
	const byRef = all.find((d) => d.reference === ref);
	if (byRef) return { deployment: byRef, created: false };

	step(`Creating Convex dev backend ${ref}`);
	convex(root, ['deployment', 'create', `${TEAM_SLUG}:${PROJECT_SLUG}:${ref}`, '--type', 'dev'], {
		capture: true
	});
	const created = (await listDeployments()).find((d) => d.reference === ref);
	if (!created) throw new Error(`Created ${ref} but cannot find it in the project.`);
	return { deployment: created, created: true };
}

// Copy every env var from the shared dev backend, then override the ones that must point at this
// worktree. `env get` per key keeps multi-line values (the CloudFront private key) intact.
function syncBackendEnv(root, name, overrides) {
	step('Copying backend env vars from the shared dev backend');
	const listed = convex(root, ['env', 'list'], {
		selector: SHARED_DEPLOYMENT,
		capture: true
	}).stdout;
	const names = [...new Set([...listed.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]))];
	const values = {};
	for (const key of names) {
		values[key] = convex(root, ['env', 'get', key], {
			selector: SHARED_DEPLOYMENT,
			capture: true
		}).stdout.replace(/\n$/, '');
	}
	Object.assign(values, overrides);
	let n = 0;
	for (const [key, value] of Object.entries(values)) {
		// stdin keeps values out of argv (no secrets in `ps`, no "-----BEGIN" parsed as a flag)
		convex(root, ['env', 'set', key], { selector: name, capture: true, input: value });
		n++;
	}
	log(`  ${n} vars set (${Object.keys(overrides).join(', ')} point at this worktree).`);
}

function pushFunctions(root, name) {
	step('Pushing this branch’s functions and schema');
	convex(root, ['dev', '--once', '--typecheck', 'disable', '--codegen', 'disable'], {
		selector: name
	});
}

function findTableFiles(dir, table) {
	const hits = [];
	const walk = (d) => {
		for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, entry.name);
			if (!entry.isDirectory()) continue;
			if (entry.name === table && fs.existsSync(path.join(p, 'documents.jsonl')))
				hits.push(path.join(p, 'documents.jsonl'));
			walk(p);
		}
	};
	walk(dir);
	return hits;
}

// Convex export writes floats as `123.0`; a plain JSON round trip would turn them into `123`,
// which import then reads as an integer. Keep every number's original source text.
function serialize(value) {
	if (value && typeof value === 'object' && 'rawNumber' in value) return value.rawNumber;
	if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
	if (value && typeof value === 'object')
		return `{${Object.entries(value)
			.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v)}`)
			.join(',')}}`;
	return JSON.stringify(value);
}

function stripField(file, field) {
	const lines = fs.readFileSync(file, 'utf8').split('\n');
	const out = lines.map((l) => {
		if (!l.trim()) return l;
		const doc = JSON.parse(l, (_k, v, ctx) =>
			typeof v === 'number' ? { rawNumber: ctx.source } : v
		);
		delete doc[field];
		return serialize(doc);
	});
	fs.writeFileSync(file, out.join('\n'));
}

// Shared dev often runs code from a branch that is not merged yet, so its data can carry fields
// this branch's schema does not have. Drop exactly those fields (reported) and retry, instead of
// leaving the worktree with an empty database.
function copyDevData(root, target, source = SHARED_DEPLOYMENT) {
	step(`Copying data from the shared dev backend (${SHARED_DEPLOYMENT})`);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-wt-'));
	const zip = path.join(dir, 'dev.zip');
	const tree = path.join(dir, 'snapshot');
	const dropped = [];
	try {
		convex(root, ['export', '--path', zip], { selector: source, capture: true });
		unzipTo(zip, tree);
		for (let attempt = 0; attempt < 25; attempt++) {
			if (attempt > 0) {
				zipDir(tree, zip);
			}
			const res = convex(root, ['import', '--replace-all', '-y', zip], {
				selector: target,
				capture: true,
				allowFail: true
			});
			if (res.status === 0) {
				log('  Done: same users, clubs and test accounts as shared dev.');
				if (dropped.length)
					log(`  Dropped fields this branch’s schema does not have: ${dropped.join(', ')}`);
				return true;
			}
			const out = `${res.stdout}\n${res.stderr}`;
			const m = out.match(
				/table "([^"]+)" because it does not match the schema: Object contains extra field `([^`]+)`/
			);
			const files = m ? findTableFiles(tree, m[1]) : [];
			if (!files.length) {
				log(
					`  ⚠ Data copy failed, so this backend starts empty:\n${out.trim().split('\n').slice(-8).join('\n')}`
				);
				log('  Fix the cause, then retry with: npm run worktree:refresh-data');
				return false;
			}
			files.forEach((f) => stripField(f, m[2]));
			dropped.push(`${m[1]}.${m[2]}`);
		}
		log('  ⚠ Gave up after 25 schema mismatches; backend starts empty.');
		return false;
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

// One setup at a time per worktree: T3's worktree-create script and Claude Code's SessionStart
// hook can both fire for a fresh worktree. The lock lives in the worktree's private git dir.
function withLock(gitDir, fn) {
	const lock = path.join(gitDir, 'cl-worktree-setup.lock');
	const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
	const deadline = Date.now() + 10 * 60_000;
	for (;;) {
		try {
			fs.mkdirSync(lock);
			fs.writeFileSync(path.join(lock, 'pid'), String(process.pid));
			break;
		} catch {
			const pid = Number(fs.readFileSync(path.join(lock, 'pid'), 'utf8').trim() || 0);
			let alive = false;
			try {
				alive = pid > 0 && process.kill(pid, 0);
			} catch {
				alive = false;
			}
			if (!alive) {
				fs.rmSync(lock, { recursive: true, force: true });
				continue;
			}
			if (Date.now() > deadline) fail('Another worktree setup has held the lock for 10 minutes.');
			log('  Waiting for another worktree setup to finish…');
			sleep(3000);
		}
	}
	const release = () => fs.rmSync(lock, { recursive: true, force: true });
	process.on('exit', release);
	return Promise.resolve(fn()).finally(release);
}

// ---------------------------------------------------------------------------------------------
// commands

async function setup(flags) {
	const { gitDir, isWorktree } = repoInfo();
	if (!isWorktree) {
		log(
			`Main checkout: uses the shared dev backend (${SHARED_DEPLOYMENT}) on :5173. Nothing to set up.`
		);
		return;
	}
	return withLock(gitDir, () => setupLocked(flags));
}

async function setupLocked(flags) {
	const { root, mainRoot } = repoInfo();

	const localFile = path.join(root, '.env.local');
	const before = readEnv(localFile);
	const currentName = (before.CONVEX_DEPLOYMENT || '').replace(/^[a-z]+:/, '').replace(/\s.*$/, '');
	const slug = slugify(path.basename(root)) || 'worktree';
	if (
		flags.has('--if-needed') &&
		before.WORKTREE_SETUP_VERSION === SETUP_VERSION &&
		currentName &&
		currentName !== SHARED_DEPLOYMENT
	) {
		log('  Already set up by a parallel run.');
		return;
	}

	log(`Setting up worktree ${root}`);
	ensureNodeModules(root);
	syncLocalEnvFiles(root, mainRoot);

	const { deployment, created } = await findOrCreateDeployment(root, slug, currentName);
	const name = deployment.name;
	const cloudUrl = deployment.deploymentUrl;
	const siteUrl = siteUrlFor(cloudUrl);
	const port = pickPort(slug, mainRoot, root, Number(before.WORKTREE_PORT) || undefined);
	const host = `${slug}.localhost`;
	const appUrl = `http://${host}:${port}`;

	writeEnvWithout(
		localFile,
		MANAGED_KEYS,
		{
			CONVEX_DEPLOYMENT: `dev:${name} # team: ${TEAM_SLUG}, project: ${PROJECT_SLUG}`,
			PUBLIC_CONVEX_URL: cloudUrl,
			PUBLIC_CONVEX_SITE_URL: siteUrl,
			BETTER_AUTH_URL: appUrl,
			WORKTREE_HOST: host,
			WORKTREE_PORT: String(port),
			WORKTREE_SETUP_VERSION: SETUP_VERSION
		},
		'# --- worktree backend (managed by scripts/worktree/cli.mjs; rerun npm run worktree:setup) ---'
	);

	const needsEnv =
		created ||
		currentName !== name ||
		before.BETTER_AUTH_URL !== appUrl ||
		flags.has('--refresh-env');
	if (needsEnv) {
		syncBackendEnv(root, name, {
			BETTER_AUTH_URL: appUrl,
			PUBLIC_CONVEX_SITE_URL: siteUrl,
			ALLOW_LAN_TRUSTED_ORIGINS: 'false'
		});
	}

	pushFunctions(root, name);

	let data = 'kept';
	if (flags.has('--no-data')) data = 'skipped';
	else if (created || currentName !== name || flags.has('--refresh-data')) {
		data = copyDevData(root, name) ? 'copied from shared dev' : 'EMPTY (copy failed, see above)';
	}

	log(`
✔ Worktree ready
  App:       ${appUrl}   (npm run dev)
  Backend:   ${name}  ${created ? '(new)' : '(existing)'}
  Dashboard: https://dashboard.convex.dev/d/${name}
  Data:      ${data}
  Functions: npx convex dev  (watches and pushes to this worktree's backend only)`);
}

async function ensure() {
	if (process.env.WORKTREE_SKIP_SETUP === '1') return;
	let info;
	try {
		info = repoInfo();
	} catch {
		return;
	}
	if (!info.isWorktree) return;
	const env = readEnv(path.join(info.root, '.env.local'));
	const ready =
		env.WORKTREE_SETUP_VERSION === SETUP_VERSION &&
		env.CONVEX_DEPLOYMENT &&
		!env.CONVEX_DEPLOYMENT.includes(SHARED_DEPLOYMENT) &&
		fs.existsSync(path.join(info.root, 'node_modules', '.package-lock.json'));
	if (ready) return;
	log('This worktree has no backend of its own yet; running worktree setup.');
	await setup(new Set(['--if-needed']));
}

async function status() {
	const { mainRoot } = repoInfo();
	const trees = listWorktrees(mainRoot);
	const deployments = await listDeployments();
	const used = new Set();
	log('Worktrees:');
	for (const wt of trees) {
		const env = readEnv(path.join(wt.path, '.env.local'));
		const name = (env.CONVEX_DEPLOYMENT || '').replace(/^[a-z]+:/, '').replace(/\s.*$/, '');
		if (name) used.add(name);
		const where = !name ? 'not set up' : name === SHARED_DEPLOYMENT ? `${name} (SHARED dev)` : name;
		const url = env.WORKTREE_PORT ? `http://${env.WORKTREE_HOST}:${env.WORKTREE_PORT}` : '';
		log(`  ${wt.branch || '(detached)'}\n    ${wt.path}\n    backend: ${where}  ${url}`);
	}
	const orphans = deployments.filter((d) => isWorktreeRef(d.reference) && !used.has(d.name));
	log(
		`\nWorktree backends with no worktree (npm run worktree:prune deletes them): ${orphans.length}`
	);
	for (const d of orphans) log(`  ${d.name}  ${d.reference}`);
}

async function prune(flags) {
	const { mainRoot } = repoInfo();
	const used = new Set(
		listWorktrees(mainRoot)
			.map((wt) => readEnv(path.join(wt.path, '.env.local')).CONVEX_DEPLOYMENT || '')
			.map((v) => v.replace(/^[a-z]+:/, '').replace(/\s.*$/, ''))
	);
	const orphans = (await listDeployments()).filter(
		(d) => isWorktreeRef(d.reference) && !used.has(d.name)
	);
	if (!orphans.length) return log('No orphaned worktree backends.');
	for (const d of orphans) log(`  ${d.name}  ${d.reference}`);
	if (!flags.has('--yes'))
		return log('\nDry run. Rerun with --yes to delete these backends (their data is lost).');
	for (const d of orphans) {
		await deleteDeployment(d.name);
		log(`  deleted ${d.name}`);
	}
}

async function add(args) {
	const [branch, base = 'origin/main'] = args;
	if (!branch) fail('Usage: npm run worktree:add -- <branch> [base-ref]');
	const { mainRoot } = repoInfo();
	const dir = path.join(
		path.dirname(mainRoot),
		`${path.basename(mainRoot)}-worktrees`,
		slugify(branch, 60)
	);
	const exists =
		spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: mainRoot })
			.status === 0;
	if (!exists) spawnSync('git', ['fetch', 'origin', 'main'], { cwd: mainRoot, stdio: 'inherit' });
	const res = spawnSync(
		'git',
		['worktree', 'add', ...(exists ? [dir, branch] : ['-b', branch, dir, base])],
		{
			cwd: mainRoot,
			stdio: 'inherit'
		}
	);
	if (res.status !== 0) fail('git worktree add failed.');
	process.chdir(dir);
	await setup(new Set());
}

async function remove(args) {
	const target = path.resolve(args[0] || repoInfo().root);
	const { mainRoot } = repoInfo(fs.existsSync(target) ? target : process.cwd());
	if (path.resolve(target) === path.resolve(mainRoot))
		fail('That is the main checkout, not a worktree.');
	const name = (readEnv(path.join(target, '.env.local')).CONVEX_DEPLOYMENT || '')
		.replace(/^[a-z]+:/, '')
		.replace(/\s.*$/, '');
	if (name && name !== SHARED_DEPLOYMENT) {
		await deleteDeployment(name);
		log(`Deleted Convex backend ${name}.`);
	}
	const res = spawnSync('git', ['worktree', 'remove', target], { cwd: mainRoot, stdio: 'inherit' });
	if (res.status !== 0)
		fail('git worktree remove failed (uncommitted changes?). The backend is already gone.');
	log(`Removed worktree ${target}. The branch is kept.`);
}

async function refreshData() {
	const { root, isWorktree } = repoInfo();
	if (!isWorktree) fail('Only for worktrees; the main checkout already uses shared dev.');
	const name = (readEnv(path.join(root, '.env.local')).CONVEX_DEPLOYMENT || '')
		.replace(/^[a-z]+:/, '')
		.replace(/\s.*$/, '');
	if (!name || name === SHARED_DEPLOYMENT) fail('Run npm run worktree:setup first.');
	copyDevData(root, name);
}

// Vercel preview builds. Runs as `npx convex deploy --cmd …` (see scripts/vercel-build.sh), after
// this branch's functions are on its preview backend and PUBLIC_CONVEX_URL points at it:
//   1. point the preview backend's auth at the branch's stable Vercel URL,
//   2. on the branch's first build, copy the shared dev data in (needs CONVEX_DEV_SEED_KEY),
//   3. build the app with PUBLIC_CONVEX_SITE_URL derived for this preview.
async function previewBuild() {
	const root = process.cwd();
	const previewName = process.env.VERCEL_GIT_COMMIT_REF;
	const deployKey = process.env.CONVEX_DEPLOY_KEY;
	const cloudUrl = process.env.PUBLIC_CONVEX_URL;
	if (!previewName || !deployKey?.startsWith('preview:') || !cloudUrl) {
		fail(
			'preview-build needs VERCEL_GIT_COMMIT_REF, a preview CONVEX_DEPLOY_KEY and PUBLIC_CONVEX_URL.'
		);
	}
	const target = { deployKey, previewName };
	const siteUrl = siteUrlFor(cloudUrl);
	const appUrl = `https://${process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL}`;

	step(`Preview backend ${cloudUrl} for branch ${previewName}; app URL ${appUrl}`);
	for (const [key, value] of Object.entries({
		BETTER_AUTH_URL: appUrl,
		PUBLIC_CONVEX_SITE_URL: siteUrl
	})) {
		convex(root, ['env', 'set', key], { selector: target, capture: true, input: value });
	}

	const seedKey = process.env.CONVEX_DEV_SEED_KEY;
	const probe = convex(root, ['data', 'profiles', '--limit', '1'], {
		selector: target,
		capture: true,
		allowFail: true
	});
	if (!seedKey) log('  CONVEX_DEV_SEED_KEY not set; preview data is not seeded.');
	else if (probe.status === 0 && /no documents/i.test(`${probe.stdout}${probe.stderr}`))
		copyDevData(root, target, { deployKey: seedKey });
	else
		log(
			'  Preview already has data; keeping it (delete the preview in the Convex dashboard to reseed).'
		);

	step('Building the app');
	const res = spawnSync('npm', ['run', 'build'], {
		cwd: root,
		stdio: 'inherit',
		env: { ...process.env, PUBLIC_CONVEX_SITE_URL: siteUrl, BETTER_AUTH_URL: appUrl }
	});
	process.exit(res.status ?? 1);
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const positional = rest.filter((a) => !a.startsWith('--'));
const commands = {
	setup: () => setup(flags),
	ensure,
	status,
	prune: () => prune(flags),
	add: () => add(positional),
	remove: () => remove(positional),
	'refresh-data': refreshData,
	'preview-build': previewBuild
};
if (!commands[cmd]) {
	log(
		fs
			.readFileSync(new URL(import.meta.url), 'utf8')
			.split('\n')
			.slice(1, 15)
			.join('\n')
			.replace(/^\/\/ ?/gm, '')
	);
	process.exit(cmd ? 2 : 0);
}
commands[cmd]().catch((err) => fail(err.message));
