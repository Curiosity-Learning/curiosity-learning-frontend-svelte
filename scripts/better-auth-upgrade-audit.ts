// CL-815: the Better Auth 1.7 pre-deploy data check, run locally against `npx convex data`
// dumps of the betterAuth component, so it works on prod BEFORE the upgrade is deployed (the
// authUpgradeAudit:auditBetterAuthUpgrade action only exists once it is). Read-only: it only
// reads the two files. Prints ids and counts, never emails.
//
//   npx convex data account --component betterAuth --prod --limit 10000 --format jsonl > accounts.jsonl
//   npx convex data user --component betterAuth --prod --limit 10000 --format jsonl > users.jsonl
//   node scripts/better-auth-upgrade-audit.ts accounts.jsonl users.jsonl
//
// (Node 24 runs this TypeScript file directly.) Delete the two dumps afterwards: they contain
// password hashes and email addresses.

import { readFileSync } from 'node:fs';
import {
	summarizeBetterAuthUpgradeAudit,
	type AuditAccount,
	type AuditUser
} from '../src/convex/authUpgradeAuditModel.ts';

const readJsonLines = <T>(path: string): T[] =>
	readFileSync(path, 'utf8')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.startsWith('{'))
		.map((line) => JSON.parse(line) as T);

const [accountsPath, usersPath] = process.argv.slice(2);
if (!accountsPath || !usersPath) {
	console.error('Usage: node scripts/better-auth-upgrade-audit.ts <accounts.jsonl> <users.jsonl>');
	process.exit(1);
}
const accounts = readJsonLines<AuditAccount>(accountsPath);
const users = readJsonLines<AuditUser>(usersPath);
const LIMIT = 10000;
if (accounts.length >= LIMIT || users.length >= LIMIT) {
	console.error(
		`A dump hit the --limit of ${LIMIT}: page the dump (the CLI caps --limit at 10000) or use the action after the deploy.`
	);
	process.exit(1);
}
console.log(JSON.stringify(summarizeBetterAuthUpgradeAudit(accounts, users), null, 2));
