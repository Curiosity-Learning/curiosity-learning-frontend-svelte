import { describe, expect, it } from 'vitest';
import {
	isDeletablePreview,
	planPreviewPrune,
	prStateForBranch,
	previewDecision,
	previewsForBranch
} from './preview-backends.mjs';

const preview = (name, branch) => ({
	name,
	deploymentType: 'preview',
	previewIdentifier: branch,
	reference: `preview/${branch.replace(/\//g, '-')}`
});
const deployments = [
	preview('merged-1', 'ron/cl-807-parent-email'),
	preview('open-1', 'ron/cl-801-view-as-child-bar'),
	preview('nopr-1', 'ron/coc-move-club'),
	preview('gone-1', 'ron/deleted-branch'),
	preview('closed-1', 'ron/closed-branch'),
	{ name: 'dependable-albatross-999', deploymentType: 'prod', reference: 'production' },
	{ name: 'good-echidna-357', deploymentType: 'dev', reference: 'dev/ron-berlinski' },
	{ name: 'hidden-duck-125', deploymentType: 'dev', reference: 'dev/wt/mac/ron-cl-810' }
];
const prs = [
	{ headRefName: 'ron/cl-807-parent-email', state: 'MERGED' },
	{ headRefName: 'ron/cl-801-view-as-child-bar', state: 'OPEN' },
	{ headRefName: 'ron/closed-branch', state: 'CLOSED' }
];

describe('isDeletablePreview', () => {
	it('only accepts preview deployments, never prod or shared dev', () => {
		expect(deployments.filter(isDeletablePreview).map((d) => d.name)).toEqual([
			'merged-1',
			'open-1',
			'nopr-1',
			'gone-1',
			'closed-1'
		]);
	});

	it('refuses a protected name even if the API calls it a preview', () => {
		expect(isDeletablePreview(preview('dependable-albatross-999', 'main'))).toBe(false);
		expect(isDeletablePreview(preview('good-echidna-357', 'main'))).toBe(false);
	});
});

describe('previewsForBranch', () => {
	it('matches the branch name exactly (the --preview-name Vercel passes)', () => {
		expect(previewsForBranch(deployments, 'ron/cl-807-parent-email').map((d) => d.name)).toEqual([
			'merged-1'
		]);
		expect(previewsForBranch(deployments, 'ron/cl-807')).toEqual([]);
		expect(previewsForBranch(deployments, '')).toEqual([]);
	});
});

describe('prStateForBranch', () => {
	it('an open PR wins over an older closed or merged one', () => {
		const many = [
			{ headRefName: 'b', state: 'CLOSED' },
			{ headRefName: 'b', state: 'OPEN' },
			{ headRefName: 'b', state: 'MERGED' }
		];
		expect(prStateForBranch(many, 'b')).toBe('OPEN');
		expect(prStateForBranch(many.slice(0, 1).concat(many[2]), 'b')).toBe('MERGED');
		expect(prStateForBranch(many.slice(0, 1), 'b')).toBe('CLOSED');
		expect(prStateForBranch(many, 'other')).toBe('NONE');
	});
});

describe('previewDecision', () => {
	it('deletes after merge or close, keeps open PRs', () => {
		expect(previewDecision({ prState: 'MERGED' }).remove).toBe(true);
		expect(previewDecision({ prState: 'CLOSED' }).remove).toBe(true);
		expect(previewDecision({ prState: 'OPEN', branchOnOrigin: false }).remove).toBe(false);
	});

	it('without a PR, deletes only when the branch is gone from origin', () => {
		expect(previewDecision({ prState: 'NONE' }).remove).toBe(false);
		expect(previewDecision({ prState: 'NONE', branchOnOrigin: true }).remove).toBe(false);
		expect(previewDecision({ prState: 'NONE', branchOnOrigin: false }).remove).toBe(true);
	});
});

describe('planPreviewPrune', () => {
	it('marks merged, closed and branch-gone previews; keeps open and no-PR branches', () => {
		const origin = new Set([
			'main',
			'ron/cl-807-parent-email',
			'ron/cl-801-view-as-child-bar',
			'ron/coc-move-club'
		]);
		const plan = Object.fromEntries(
			planPreviewPrune(deployments, prs, origin).map((p) => [p.deployment.name, p.remove])
		);
		expect(plan).toEqual({
			'merged-1': true,
			'open-1': false,
			'nopr-1': false,
			'gone-1': true,
			'closed-1': true
		});
	});
});
