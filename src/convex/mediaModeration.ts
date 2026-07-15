import { v } from 'convex/values';

export const MEDIA_MODERATION_STATUSES = [
	'clean',
	'flagged',
	'blocked',
	'skipped-video'
] as const;
export type MediaModerationStatus = (typeof MEDIA_MODERATION_STATUSES)[number];

export const mediaModerationStatusValidator = v.union(
	v.literal('clean'),
	v.literal('flagged'),
	v.literal('blocked'),
	v.literal('skipped-video')
);

export const mediaModerationLabelValidator = v.object({
	name: v.string(),
	confidence: v.number(),
	parentName: v.optional(v.string())
});

export const mediaModerationResultValidator = v.object({
	status: mediaModerationStatusValidator,
	labels: v.array(mediaModerationLabelValidator),
	maxConfidence: v.optional(v.number())
});

export type MediaModerationLabel = {
	name: string;
	confidence: number;
	parentName?: string;
};

export type MediaModerationResult = {
	status: MediaModerationStatus;
	labels: MediaModerationLabel[];
	maxConfidence?: number;
};

/**
 * Categories that constitute a clear violation regardless of confidence tier
 * once they clear the BLOCK_CONFIDENCE_THRESHOLD. These map to Rekognition's
 * top-level moderation categories (and their common aliases across API
 * versions) for explicit nudity / sexual activity content.
 */
const CLEAR_VIOLATION_CATEGORY_NAMES = new Set(
	[
		'explicit nudity',
		'explicit',
		'nudity',
		'sexual activity',
		'sexual situations',
		'graphic male nudity',
		'graphic female nudity',
		'sexual intercourse',
		'sexual content'
	].map((name) => name.toLowerCase())
);

export const BLOCK_CONFIDENCE_THRESHOLD = 80;
export const FLAG_CONFIDENCE_THRESHOLD = 50;

// Rekognition's DetectModerationLabels byte-payload API rejects images over
// 5MB. Larger images cannot be screened automatically and are flagged for
// human review instead.
export const MAX_SCREENABLE_IMAGE_BYTES = 5 * 1024 * 1024;

const isClearViolationLabel = (label: MediaModerationLabel) => {
	const name = label.name.toLowerCase();
	const parentName = label.parentName?.toLowerCase();
	return CLEAR_VIOLATION_CATEGORY_NAMES.has(name) || Boolean(parentName && CLEAR_VIOLATION_CATEGORY_NAMES.has(parentName));
};

/**
 * Pure decision function: given the raw moderation labels returned by
 * Rekognition (or any equivalent moderation provider), decide whether the
 * upload should be blocked, flagged for human review, or considered clean.
 *
 * Policy:
 * - Any clear-violation category (explicit nudity / sexual activity, etc.)
 *   at confidence >= BLOCK_CONFIDENCE_THRESHOLD (80) => 'blocked'.
 * - Any label at confidence >= FLAG_CONFIDENCE_THRESHOLD (50) (including
 *   clear-violation categories below the block threshold, and any other
 *   suggestive/moderation category) => 'flagged'.
 * - No labels at or above the flag threshold => 'clean'.
 */
export const decideMediaModerationStatus = (
	labels: MediaModerationLabel[]
): MediaModerationResult => {
	const relevantLabels = labels.filter((label) => label.confidence >= FLAG_CONFIDENCE_THRESHOLD);

	if (!relevantLabels.length) {
		return {
			status: 'clean',
			labels: [],
			maxConfidence: undefined
		};
	}

	const maxConfidence = Math.max(...relevantLabels.map((label) => label.confidence));

	const hasClearViolation = relevantLabels.some(
		(label) => isClearViolationLabel(label) && label.confidence >= BLOCK_CONFIDENCE_THRESHOLD
	);

	return {
		status: hasClearViolation ? 'blocked' : 'flagged',
		labels: relevantLabels,
		maxConfidence
	};
};
