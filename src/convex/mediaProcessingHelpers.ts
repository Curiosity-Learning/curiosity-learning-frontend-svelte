import { fileTypeFromBuffer } from 'file-type';
import type { ModerationLabel } from '@aws-sdk/client-rekognition';
import {
	type SupportedContentType,
	buildRejectedUploadFailure,
	buildValidationFailure,
	getEffectiveContentType,
	isSupportedContentType,
	resolveAcceptedContentType
} from './mediaPipeline';

export const detectBufferContentType = async (buffer: Uint8Array) => {
	const result = await fileTypeFromBuffer(buffer);
	return result?.mime ?? null;
};

export const resolveUploadContentType = async ({
	buffer,
	storedContentType,
	clientContentType,
	acceptedContentTypes
}: {
	buffer: Uint8Array;
	storedContentType?: string | null;
	clientContentType?: string | null;
	acceptedContentTypes: readonly SupportedContentType[];
}) => {
	const detectedFromBytes = await detectBufferContentType(buffer);
	const effectiveContentType =
		detectedFromBytes ??
		getEffectiveContentType({
			storedContentType,
			clientContentType
		});

	return resolveAcceptedContentType({
		contentType: effectiveContentType,
		acceptedContentTypes
	});
};

export const validateDurationSeconds = ({
	durationSeconds,
	maxDurationSeconds
}: {
	durationSeconds: number;
	maxDurationSeconds?: number;
}) => {
	if (
		maxDurationSeconds != null &&
		Number.isFinite(durationSeconds) &&
		durationSeconds > maxDurationSeconds
	) {
		return buildValidationFailure(
			'video_too_long',
			`Videos must be ${maxDurationSeconds} seconds or shorter.`
		);
	}

	return null;
};

export const summarizeModerationLabels = (labels: ModerationLabel[]) =>
	labels
		.map((label) => `${label.Name ?? 'Unknown'} (${Math.round(label.Confidence ?? 0)}%)`)
		.slice(0, 3)
		.join(', ');

export const mapModerationLabelsToDecision = ({
	labels
}: {
	labels: ModerationLabel[];
}) => {
	if (!labels.length) {
		return {
			decision: 'approved' as const,
			summary: 'No flagged content detected.'
		};
	}

	return {
		decision: 'rejected' as const,
		summary: summarizeModerationLabels(labels),
		failure: buildRejectedUploadFailure()
	};
};

export const sampleFrameTimestamps = (durationSeconds: number) => {
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		return [0];
	}

	if (durationSeconds <= 6) {
		return [0, Math.max(0, durationSeconds / 2)];
	}

	const lastFrame = Math.max(0, durationSeconds - 1);
	return [...new Set([0, durationSeconds / 3, (durationSeconds * 2) / 3, lastFrame])];
};

export const isSupportedUploadMime = (contentType: string | null) =>
	Boolean(contentType && isSupportedContentType(contentType));
