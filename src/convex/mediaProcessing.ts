"use node";

import { v } from 'convex/values';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DetectModerationLabelsCommand, RekognitionClient } from '@aws-sdk/client-rekognition';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { Jimp, JimpMime } from 'jimp';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import {
	buildProcessingFailure,
	buildValidationFailure,
	getMediaKindForContentType,
	type MediaPipelineStepResult,
	type SupportedContentType
} from './mediaPipeline';
import {
	mapModerationLabelsToDecision,
	resolveUploadContentType,
	sampleFrameTimestamps,
	validateDurationSeconds
} from './mediaProcessingHelpers';

const execFileAsync = promisify(execFile);
const AWS_MODERATION_PROVIDER = 'aws-rekognition';

const appendStep = (
	steps: MediaPipelineStepResult[],
	step: string,
	stage: 'validation' | 'processing',
	status: 'passed' | 'failed' | 'skipped',
	message: string
) => {
	steps.push({
		step,
		stage,
		status,
		message
	});
};

const getFfmpegBinary = () => {
	if (!ffmpegPath) {
		throw new Error('ffmpeg-static is not available on this platform.');
	}

	return ffmpegPath;
};

const getFfprobeBinary = () => {
	if (!ffprobe.path) {
		throw new Error('ffprobe-static is not available on this platform.');
	}

	return ffprobe.path;
};

const probeVideoDuration = async (filePath: string) => {
	const { stdout } = await execFileAsync(getFfprobeBinary(), [
		'-v',
		'error',
		'-show_entries',
		'format=duration',
		'-of',
		'json',
		filePath
	]);
	const parsed = JSON.parse(stdout);
	const durationSeconds = Number(parsed?.format?.duration ?? NaN);
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		throw new Error('Video duration could not be determined.');
	}

	return durationSeconds;
};

const compressVideo = async (
	buffer: Buffer
): Promise<{
	buffer: Uint8Array;
	contentType: 'video/mp4';
	durationSeconds: number;
}> => {
	const tempDir = await mkdtemp(join(tmpdir(), 'cl-media-video-'));
	const inputPath = join(tempDir, 'input.bin');
	const outputPath = join(tempDir, 'output.mp4');

	try {
		await writeFile(inputPath, buffer);
		await execFileAsync(getFfmpegBinary(), [
			'-y',
			'-i',
			inputPath,
			'-map',
			'0:v:0?',
			'-map',
			'0:a:0?',
			'-c:v',
			'libx264',
			'-preset',
			'veryfast',
			'-crf',
			'30',
			'-c:a',
			'aac',
			'-b:a',
			'96k',
			'-movflags',
			'+faststart',
			outputPath
		]);
		const compressed = await readFile(outputPath);
		const durationSeconds = await probeVideoDuration(outputPath);

		return {
			buffer: compressed,
			contentType: 'video/mp4',
			durationSeconds
		};
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
};

const extractVideoFrames = async ({
	buffer,
	durationSeconds
}: {
	buffer: Buffer;
	durationSeconds: number;
}) => {
	const tempDir = await mkdtemp(join(tmpdir(), 'cl-media-frames-'));
	const inputPath = join(tempDir, 'input.mp4');

	try {
		await writeFile(inputPath, buffer);
		const timestamps = sampleFrameTimestamps(durationSeconds);
		const frames: Buffer[] = [];

		for (const [index, timestamp] of timestamps.entries()) {
			const framePath = join(tempDir, `frame-${index}.jpg`);
			await execFileAsync(getFfmpegBinary(), [
				'-y',
				'-ss',
				`${timestamp}`,
				'-i',
				inputPath,
				'-frames:v',
				'1',
				'-q:v',
				'2',
				framePath
			]);
			frames.push(await readFile(framePath));
		}

		return frames;
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
};

const compressImage = async (
	buffer: Buffer,
	sourceContentType: SupportedContentType
): Promise<{
	buffer: Uint8Array;
	contentType: SupportedContentType;
	skipped: boolean;
}> => {
	try {
		const image = await Jimp.read(buffer);
		const hasAlpha = image.hasAlpha();

		if (hasAlpha) {
			return {
				buffer: Buffer.from(await image.getBuffer(JimpMime.png)),
				contentType: 'image/png',
				skipped: false
			};
		}

		return {
			buffer: Buffer.from(await image.getBuffer(JimpMime.jpeg)),
			contentType: 'image/jpeg',
			skipped: false
		};
	} catch {
		return {
			buffer,
			contentType: sourceContentType,
			skipped: true
		};
	}
};

const buildRekognitionClient = () => {
	const region = process.env.AWS_REGION;
	if (!region) {
		throw new Error('AWS_REGION must be configured when media safety screening is enabled.');
	}

	return new RekognitionClient({ region });
};

const detectModerationLabels = async (client: RekognitionClient, bytes: Uint8Array) => {
	const response = await client.send(
		new DetectModerationLabelsCommand({
			Image: { Bytes: bytes },
			MinConfidence: 75
		})
	);

	return response.ModerationLabels ?? [];
};

const screenImage = async (bytes: Uint8Array) => {
	const client = buildRekognitionClient();
	return mapModerationLabelsToDecision({
		labels: await detectModerationLabels(client, bytes)
	});
};

const screenVideo = async ({
	buffer,
	durationSeconds
}: {
	buffer: Uint8Array;
	durationSeconds: number;
}) => {
	const client = buildRekognitionClient();
	const frames = await extractVideoFrames({ buffer: Buffer.from(buffer), durationSeconds });

	for (const frame of frames) {
		const labels = await detectModerationLabels(client, frame);
		const decision = mapModerationLabelsToDecision({ labels });
		if (decision.decision === 'rejected') {
			return decision;
		}
	}

	return {
		decision: 'approved' as const,
		summary: 'No flagged content detected.'
	};
};

export const processUpload = internalAction({
	args: {
		assetId: v.id('mediaAssets')
	},
	handler: async (ctx, args) => {
		const asset = await ctx.runQuery(internal.media.getAssetForProcessing, {
			assetId: args.assetId
		});
		if (!asset || asset.status !== 'processing' || !asset.sourceStorageId) {
			return null;
		}

		const steps: MediaPipelineStepResult[] = [];
		const sourceBlob = await ctx.storage.get(asset.sourceStorageId);
		if (!sourceBlob) {
			appendStep(
				steps,
				'validate-storage-metadata',
				'validation',
				'failed',
				'Upload metadata could not be found in storage.'
			);
			await ctx.runMutation(internal.media.failProcessedUpload, {
				assetId: args.assetId,
				stepResults: steps,
				failure: buildValidationFailure(
					'missing_storage_metadata',
					'Upload metadata could not be read from storage.'
				)
			});
			return null;
		}

		const sourceBuffer = Buffer.from(await sourceBlob.arrayBuffer());
		appendStep(
			steps,
			'validate-storage-metadata',
			'validation',
			'passed',
			'Stored upload metadata was loaded.'
		);

		const detectedContentType = await resolveUploadContentType({
			buffer: sourceBuffer,
			storedContentType: asset.storageMetadata?.contentType ?? sourceBlob.type ?? null,
			clientContentType: asset.clientContentType ?? null,
			acceptedContentTypes: asset.acceptedContentTypes
		});

		if (!detectedContentType) {
			appendStep(
				steps,
				'validate-media-type',
				'validation',
				'failed',
				'File type is not allowed for this upload.'
			);
			await ctx.runMutation(internal.media.failProcessedUpload, {
				assetId: args.assetId,
				stepResults: steps,
				failure: buildValidationFailure(
					'unsupported_media_type',
					'The uploaded file type is not allowed for this upload.'
				)
			});
			return null;
		}

		const mediaKind = getMediaKindForContentType(detectedContentType);
		appendStep(
			steps,
			'validate-media-type',
			'validation',
			'passed',
			`Accepted ${mediaKind} upload (${detectedContentType}).`
		);

		if (sourceBuffer.byteLength <= 0) {
			appendStep(
				steps,
				'validate-file-size',
				'validation',
				'failed',
				'Empty files cannot be processed.'
			);
			await ctx.runMutation(internal.media.failProcessedUpload, {
				assetId: args.assetId,
				stepResults: steps,
				failure: buildValidationFailure('empty_file', 'The uploaded file is empty.')
			});
			return null;
		}

		if (sourceBuffer.byteLength > asset.maxBytes) {
			appendStep(
				steps,
				'validate-file-size',
				'validation',
				'failed',
				'File exceeds the configured size limit.'
			);
			await ctx.runMutation(internal.media.failProcessedUpload, {
				assetId: args.assetId,
				stepResults: steps,
				failure: buildValidationFailure(
					'file_too_large',
					`Uploads must be ${Math.round(asset.maxBytes / (1024 * 1024))}MB or smaller.`
				)
			});
			return null;
		}

		appendStep(
			steps,
			'validate-file-size',
			'validation',
			'passed',
			'File size is within the configured limit.'
		);

		let durationSeconds: number | undefined;
		let processedBuffer: Uint8Array = sourceBuffer;
		let processedContentType: SupportedContentType = detectedContentType;

		try {
			if (mediaKind === 'video') {
				const videoResult = await compressVideo(sourceBuffer);
				durationSeconds = videoResult.durationSeconds;
				const durationFailure = validateDurationSeconds({
					durationSeconds,
					maxDurationSeconds: asset.maxDurationSeconds ?? undefined
				});
				if (durationFailure) {
					appendStep(
						steps,
						'validate-video-duration',
						'validation',
						'failed',
						durationFailure.message
					);
					await ctx.runMutation(internal.media.failProcessedUpload, {
						assetId: args.assetId,
						stepResults: steps,
						failure: durationFailure
					});
					return null;
				}

				appendStep(
					steps,
					'validate-video-duration',
					'validation',
					'passed',
					'Video duration is within the configured limit.'
				);

				if (asset.enableCompression) {
					processedBuffer = videoResult.buffer;
					processedContentType = videoResult.contentType;
					appendStep(
						steps,
						'compress-video',
						'processing',
						'passed',
						'Video compression completed.'
					);
				} else {
					appendStep(
						steps,
						'compress-video',
						'processing',
						'skipped',
						'Video compression disabled for this upload.'
					);
				}
			} else if (asset.enableCompression) {
				const imageResult = await compressImage(sourceBuffer, detectedContentType);
				processedBuffer = imageResult.buffer;
				processedContentType = imageResult.contentType;
				appendStep(
					steps,
					'compress-image',
					'processing',
					imageResult.skipped ? 'skipped' : 'passed',
					imageResult.skipped
						? 'Image compression was skipped for an unsupported image format.'
						: 'Image compression completed.'
				);
			} else {
				appendStep(
					steps,
					'compress-image',
					'processing',
					'skipped',
					'Image compression disabled for this upload.'
				);
			}
		} catch (error) {
			appendStep(
				steps,
				mediaKind === 'video' ? 'compress-video' : 'compress-image',
				'processing',
				'failed',
				'Media processing failed.'
			);
			await ctx.runMutation(internal.media.failProcessedUpload, {
				assetId: args.assetId,
				stepResults: steps,
				failure: buildProcessingFailure(
					'media_processing_failed',
					error instanceof Error ? error.message : 'Media processing failed.',
					true
				)
			});
			return null;
		}

		let moderationProvider: string | undefined;
		let moderationSummary: string | undefined;

		try {
			if (asset.enableSafetyScreening) {
				const moderation =
					mediaKind === 'image'
						? await screenImage(processedBuffer)
						: await screenVideo({
								buffer: processedBuffer,
								durationSeconds: durationSeconds ?? 0
							});
				moderationProvider = AWS_MODERATION_PROVIDER;
				moderationSummary = moderation.summary;

				if (moderation.decision === 'rejected') {
					appendStep(
						steps,
						'safety-screening',
						'processing',
						'failed',
						'Media safety screening rejected this upload.'
					);
					await ctx.storage.delete(asset.sourceStorageId);
					await ctx.runMutation(internal.media.failProcessedUpload, {
						assetId: args.assetId,
						stepResults: steps,
						failure: moderation.failure,
						clearSourceStorage: true,
						moderationStatus: 'rejected',
						moderationProvider,
						moderationSummary
					});
					return null;
				}

				appendStep(
					steps,
					'safety-screening',
					'processing',
					'passed',
					'Media safety screening approved this upload.'
				);
			} else {
				appendStep(
					steps,
					'safety-screening',
					'processing',
					'skipped',
					'Media safety screening disabled for this upload.'
				);
			}
		} catch (error) {
			appendStep(
				steps,
				'safety-screening',
				'processing',
				'failed',
				'Media safety screening failed.'
			);
			await ctx.runMutation(internal.media.failProcessedUpload, {
				assetId: args.assetId,
				stepResults: steps,
				failure: buildProcessingFailure(
					'media_safety_screening_failed',
					error instanceof Error ? error.message : 'Media safety screening failed.',
					true
				)
			});
			return null;
		}

		try {
			const processedStorageId = await ctx.storage.store(
				new Blob([Buffer.from(processedBuffer)], { type: processedContentType })
			);
			await ctx.storage.delete(asset.sourceStorageId);
			await ctx.runMutation(internal.media.completeProcessedUpload, {
				assetId: args.assetId,
				storageId: processedStorageId,
				contentType: processedContentType,
				mediaKind,
				sizeBytes: processedBuffer.byteLength,
				originalSizeBytes: sourceBuffer.byteLength,
				processedSizeBytes: processedBuffer.byteLength,
				durationSeconds,
				sha256: createHash('sha256').update(processedBuffer).digest('hex'),
				stepResults: steps,
				moderationProvider,
				moderationSummary
			});
		} catch (error) {
			await ctx.runMutation(internal.media.failProcessedUpload, {
				assetId: args.assetId,
				stepResults: steps,
				failure: buildProcessingFailure(
					'processed_storage_write_failed',
					error instanceof Error ? error.message : 'Processed media could not be stored.',
					true
				)
			});
		}

		return null;
	}
});
