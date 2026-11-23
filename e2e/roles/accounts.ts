// The signed-in role suite (CL-816) runs against the `cl-e2e-*` test accounts that live in the
// shared dev data. Worktree backends and Vercel preview backends start from a copy of that data
// with the same document ids, so the ids below are stable everywhere the suite runs.
//
// Passwords are not committed: each comes from an env var (see `.env.e2e.example`). The config
// loads `.env.e2e` from the repo root when it exists.

import path from 'node:path';

export type RoleKey = 'learner' | 'guide' | 'parent' | 'child' | 'clubLess' | 'reviewer';

export type RoleAccount = {
	role: RoleKey;
	/** Email address, or a username for child accounts (username sign-in). */
	identifier: string;
	passwordEnv: string;
	/** Where the app sends this account right after signing in without a `next`. */
	landingPath: RegExp;
};

export const ids = {
	/** Lisbon club (k17bjr…): adult1 and adult2 are Learners, child1 too. No sessions. */
	lisbonClub: 'k17bjr1y7bgdgk3e0vwj12qxr98achzk',
	/** Lisbon club (k179z…): parent1 is its Guide. */
	parent1LisbonClub: 'k179z4vzp4qeqnbnw88zprsgws8d2ct5',
	/** Amsterdam club: adult2 is a Guide, cl_e2e_kid_club a Learner. Has sessions and a project. */
	amsterdamClub: 'k17agxxrytvfnbrvkyrrhegy8n83vbxs',
	/** A past Amsterdam session. */
	amsterdamSession: 'mh7f4c9yrmakfnehq7fawh1qy98ahd2t',
	adult1Profile: 'kn77jawjn3rca06e1xw5vf84yd8d21dz',
	adult2Profile: 'kn7a2arf8ccpddxpsked3jznpd8d20nz',
	kidClubProfile: 'kn7czmr3vk4e1dv736ag77z36n8hm1cf',
	kidAppliedProfile: 'kn729fhtmmbhs18p3eckgbvgan8hnh94',
	parent2Profile: 'kn70tvcvfh05nmzmh42ajpj51x8hmb7t'
} as const;

const clubHome = (clubId: string) => new RegExp(`/club/${clubId}$`);

export const accounts: Record<RoleKey, RoleAccount> = {
	// A Learner in the Lisbon club (and a global admin on dev data; club pages ignore that).
	learner: {
		role: 'learner',
		identifier: 'cl-e2e-adult1@mailinator.com',
		passwordEnv: 'E2E_PASSWORD_LEARNER',
		landingPath: clubHome(ids.lisbonClub)
	},
	// Guide of the Amsterdam club. Their active club is Lisbon, where they are a Learner.
	guide: {
		role: 'guide',
		identifier: 'cl-e2e-adult2@mailinator.com',
		passwordEnv: 'E2E_PASSWORD_GUIDE',
		landingPath: clubHome(ids.lisbonClub)
	},
	// A parent with no club of their own, linked to cl_e2e_kid_club.
	parent: {
		role: 'parent',
		identifier: 'cl-e2e-parent2@mailinator.com',
		passwordEnv: 'E2E_PASSWORD_PARENT',
		landingPath: new RegExp(`/child/${ids.kidClubProfile}$`)
	},
	// A child account (username sign-in), Learner in the Amsterdam club.
	child: {
		role: 'child',
		identifier: 'cl_e2e_kid_club',
		passwordEnv: 'E2E_PASSWORD_CHILD',
		landingPath: clubHome(ids.amsterdamClub)
	},
	// A child with no club, a pending join request and a pending start-club application.
	clubLess: {
		role: 'clubLess',
		identifier: 'cl_e2e_kid_applied',
		passwordEnv: 'E2E_PASSWORD_CLUB_LESS',
		landingPath: /\/new-club$/
	},
	// Guide of a Lisbon club who has had application reviews assigned.
	reviewer: {
		role: 'reviewer',
		identifier: 'cl-e2e-parent1@mailinator.com',
		passwordEnv: 'E2E_PASSWORD_REVIEWER',
		landingPath: clubHome(ids.parent1LisbonClub)
	}
};

export const roleKeys = Object.keys(accounts) as RoleKey[];

export const passwordFor = (account: RoleAccount) => {
	const password = process.env[account.passwordEnv];
	if (!password) {
		throw new Error(
			`${account.passwordEnv} is not set. Copy .env.e2e.example to .env.e2e and fill in the ` +
				`password of ${account.identifier}.`
		);
	}
	return password;
};

export const authFile = (role: RoleKey) =>
	path.join(process.cwd(), 'playwright', '.auth', `${role}.json`);
