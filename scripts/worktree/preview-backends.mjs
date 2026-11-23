// Pure decisions about Convex preview backends (CL-810), kept free of I/O so they can be unit
// tested. cli.mjs does the fetching (Convex API, `gh pr list`, `git ls-remote`) and the deleting.
//
// How a preview is named: scripts/vercel-build.sh runs
//   npx convex deploy --preview-name "$VERCEL_GIT_COMMIT_REF"
// and VERCEL_GIT_COMMIT_REF is the git branch name. Convex stores that value unchanged as the
// deployment's `previewIdentifier` (e.g. `ron/cl-807-parent-email-and-sign-in-link-wording`) and
// derives the display reference from it (`preview/ron-cl-807-…`). So a branch's preview backend
// is the preview deployment whose previewIdentifier equals the branch name.

/** Deployments that must never be deleted, whatever the API says about them. */
export const PROTECTED_DEPLOYMENTS = ['good-echidna-357', 'dependable-albatross-999'];

/** True only for Convex preview deployments that are safe to consider for deletion. */
export function isDeletablePreview(d) {
	return (
		!!d &&
		d.deploymentType === 'preview' &&
		!PROTECTED_DEPLOYMENTS.includes(d.name) &&
		typeof d.previewIdentifier === 'string' &&
		d.previewIdentifier.length > 0
	);
}

/** The preview backend(s) Vercel created for `branch` (normally zero or one). */
export function previewsForBranch(deployments, branch) {
	if (!branch) return [];
	return deployments.filter((d) => isDeletablePreview(d) && d.previewIdentifier === branch);
}

/**
 * Collapse every PR that used `branch` as its head into one state. A branch can have several PRs
 * (e.g. one closed, then a new one merged); any open PR still needs the preview.
 * @param {{ headRefName: string, state: string }[]} prs  output of `gh pr list --state all`
 * @returns {'OPEN' | 'MERGED' | 'CLOSED' | 'NONE'}
 */
export function prStateForBranch(prs, branch) {
	const states = prs.filter((p) => p.headRefName === branch).map((p) => p.state);
	if (states.includes('OPEN')) return 'OPEN';
	if (states.includes('MERGED')) return 'MERGED';
	if (states.includes('CLOSED')) return 'CLOSED';
	return 'NONE';
}

/**
 * Should this branch's preview backend be deleted?
 * - `worktree:remove` passes only the PR state: delete when the PR is merged or closed.
 * - `worktree:prune` also passes `branchOnOrigin`: a preview whose branch is gone from origin
 *   (and has no open PR) is deleted too. A branch that still exists with no PR is kept.
 * @param {{ prState: 'OPEN' | 'MERGED' | 'CLOSED' | 'NONE', branchOnOrigin?: boolean }} input
 * @returns {{ remove: boolean, reason: string }}
 */
export function previewDecision({ prState, branchOnOrigin }) {
	if (prState === 'OPEN') return { remove: false, reason: 'PR is open' };
	if (prState === 'MERGED') return { remove: true, reason: 'PR merged' };
	if (prState === 'CLOSED') return { remove: true, reason: 'PR closed' };
	if (branchOnOrigin === false) return { remove: true, reason: 'branch gone from origin, no PR' };
	if (branchOnOrigin === true) return { remove: false, reason: 'branch exists, no PR yet' };
	return { remove: false, reason: 'no PR yet' };
}

/**
 * Plan for `worktree:prune`: one entry per preview backend, with the decision and its reason.
 * @param {any[]} deployments  Convex list_deployments output
 * @param {{ headRefName: string, state: string }[]} prs
 * @param {Set<string>} originBranches  branch names that exist on origin
 */
export function planPreviewPrune(deployments, prs, originBranches) {
	return deployments.filter(isDeletablePreview).map((d) => {
		const branch = d.previewIdentifier;
		const prState = prStateForBranch(prs, branch);
		return {
			deployment: d,
			branch,
			prState,
			...previewDecision({ prState, branchOnOrigin: originBranches.has(branch) })
		};
	});
}
