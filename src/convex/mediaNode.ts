'use node';

import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	S3Client
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { DetectModerationLabelsCommand, RekognitionClient } from '@aws-sdk/client-rekognition';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalAction } from './_generated/server';
import {
	loadMediaStorageConfig,
	type MediaStorageConfig,
	type MediaUploadDescriptor
} from './mediaStorage';
import { mediaUploadConstraintsValidator } from './mediaModel';
import { isOperationalMediaFailure } from './mediaMonitoring';
import {
	type MediaImageModerator,
	type SupportedContentType,
	type StoredMediaMetadata,
	runMediaPipeline
} from './mediaPipeline';
import type { MediaModerationLabel } from './mediaModeration';
import { toResolvedAsset } from './mediaShared';
import { reportConvexError } from './monitoring';

// Rekognition's DetectModerationLabels supports referencing an S3 object
// directly, but that requires the calling IAM principal to also have
// s3:GetObject on the target bucket. Our media bucket credentials
// (MEDIA_S3_*, the `curiosity-media-uploader` IAM user) are a separate IAM
// identity from the general AWS_* creds, and it turns out *neither*
// principal has both permissions: MEDIA_S3_* lacks rekognition:* entirely
// (confirmed via AccessDeniedException during CL-685 sanity-testing), while
// the generic AWS_* user has Rekognition access but was not verified against
// the S3 bucket. We therefore fetch object bytes with the S3-scoped
// credentials (MEDIA_S3_*, which we already authenticate with for storage
// operations) and call Rekognition with the separate AWS_* credentials that
// were confirmed (via the CL-685 feasibility probe) to have
// rekognition:DetectModerationLabels access.
const REKOGNITION_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const requireRekognitionEnv = (name: string) => {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is not set (Convex environment variable).`);
	}
	return value;
};

const createRekognitionClient = () =>
	new RekognitionClient({
		region: process.env.AWS_REGION?.trim() || process.env.MEDIA_S3_REGION?.trim(),
		credentials: {
			accessKeyId: requireRekognitionEnv('AWS_ACCESS_KEY_ID'),
			secretAccessKey: requireRekognitionEnv('AWS_SECRET_ACCESS_KEY')
		}
	});

const toModerationLabels = (
	labels: { Name?: string; Confidence?: number; ParentName?: string }[] | undefined
): MediaModerationLabel[] =>
	(labels ?? [])
		.filter((label): label is { Name: string; Confidence: number; ParentName?: string } =>
			Boolean(label.Name && typeof label.Confidence === 'number')
		)
		.map((label) => ({
			name: label.Name,
			confidence: label.Confidence,
			parentName: label.ParentName
		}));

const buildImageModerator = ({
	client,
	rekognitionClient
}: {
	client: S3Client;
	rekognitionClient: RekognitionClient;
}): MediaImageModerator => {
	return async ({ bucket, objectKey }) => {
		const response = await client.send(
			new GetObjectCommand({
				Bucket: bucket,
				Key: objectKey,
				Range: `bytes=0-${REKOGNITION_MAX_IMAGE_BYTES - 1}`
			})
		);

		if (!response.Body) {
			return [];
		}

		const bytes = await response.Body.transformToByteArray();
		const result = await rekognitionClient.send(
			new DetectModerationLabelsCommand({
				Image: { Bytes: bytes },
				MinConfidence: 40
			})
		);

		return toModerationLabels(result.ModerationLabels);
	};
};

type PresignedPostCondition = NonNullable<
	Parameters<typeof createPresignedPost>[1]['Conditions']
>[number];

const SIGNATURE_RANGE_BYTES = 512;

const createS3Client = (config: MediaStorageConfig) =>
	new S3Client({
		region: config.region,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey
		},
		endpoint: config.endpoint,
		forcePathStyle: config.forcePathStyle
	});

const isMissingObjectError = (error: unknown) => {
	if (!(error instanceof Error)) {
		return false;
	}

	const details = error as Error & {
		name?: string;
		Code?: string;
		code?: string;
		$metadata?: { httpStatusCode?: number };
	};

	return (
		details.name === 'NotFound' ||
		details.name === 'NoSuchKey' ||
		details.Code === 'NoSuchKey' ||
		details.code === 'NoSuchKey' ||
		details.$metadata?.httpStatusCode === 404
	);
};

const buildUploadDescriptor = async ({
	client,
	config,
	objectKey,
	maxBytes,
	clientContentType,
	clientDurationSeconds
}: {
	client: S3Client;
	config: MediaStorageConfig;
	objectKey: string;
	maxBytes: number;
	clientContentType?: string | null;
	clientDurationSeconds?: number | null;
}): Promise<MediaUploadDescriptor> => {
	const metadataFields =
		typeof clientDurationSeconds === 'number' && Number.isFinite(clientDurationSeconds)
			? {
					'duration-seconds': String(clientDurationSeconds)
				}
			: undefined;
	const fields = {
		...(clientContentType?.trim() ? { 'Content-Type': clientContentType.trim() } : {}),
		...(metadataFields
			? {
					'x-amz-meta-duration-seconds': metadataFields['duration-seconds']
				}
			: {})
	};
	const conditions: PresignedPostCondition[] = [['content-length-range', 1, maxBytes]];

	if (clientContentType?.trim()) {
		conditions.push(['eq', '$Content-Type', clientContentType.trim()]);
	}

	if (metadataFields) {
		conditions.push(['eq', '$x-amz-meta-duration-seconds', metadataFields['duration-seconds']]);
	}

	const presignedPost = await createPresignedPost(client, {
		Bucket: config.bucket,
		Key: objectKey,
		Expires: config.uploadUrlTtlSeconds,
		Fields: fields,
		Conditions: conditions
	});

	return {
		provider: config.provider,
		method: 'POST',
		url: presignedPost.url,
		fields: presignedPost.fields,
		objectKey
	};
};

const readAscii = (bytes: Uint8Array, start: number, end: number) =>
	Buffer.from(bytes.slice(start, end)).toString('ascii');

const collectIsoBrands = (bytes: Uint8Array) => {
	const brands: string[] = [];
	for (let offset = 8; offset + 4 <= bytes.length; offset += 4) {
		brands.push(readAscii(bytes, offset, offset + 4).toLowerCase());
	}
	return brands;
};

const sniffSupportedContentType = (bytes: Uint8Array): SupportedContentType | null => {
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'image/jpeg';
	}

	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return 'image/png';
	}

	if (
		bytes.length >= 12 &&
		readAscii(bytes, 0, 4) === 'RIFF' &&
		readAscii(bytes, 8, 12) === 'WEBP'
	) {
		return 'image/webp';
	}

	if (bytes.length >= 12 && readAscii(bytes, 4, 8) === 'ftyp') {
		const brands = collectIsoBrands(bytes);

		if (brands.some((brand) => ['heic', 'heix', 'hevc', 'hevx'].includes(brand))) {
			return 'image/heic';
		}

		if (brands.some((brand) => ['heif', 'heim', 'heis', 'mif1', 'msf1'].includes(brand))) {
			return 'image/heif';
		}

		if (brands.includes('qt  ')) {
			return 'video/quicktime';
		}

		if (brands.includes('m4v ')) {
			return 'video/x-m4v';
		}

		if (brands.some((brand) => ['avc1', 'dash', 'isom', 'iso2', 'mp41', 'mp42'].includes(brand))) {
			return 'video/mp4';
		}
	}

	if (
		bytes.length >= 4 &&
		bytes[0] === 0x1a &&
		bytes[1] === 0x45 &&
		bytes[2] === 0xdf &&
		bytes[3] === 0xa3 &&
		Buffer.from(bytes).toString('latin1').toLowerCase().includes('webm')
	) {
		return 'video/webm';
	}

	return null;
};

const readObjectSignatureBytes = async ({
	client,
	bucket,
	objectKey
}: {
	client: S3Client;
	bucket: string;
	objectKey: string;
}) => {
	const response = await client.send(
		new GetObjectCommand({
			Bucket: bucket,
			Key: objectKey,
			Range: `bytes=0-${SIGNATURE_RANGE_BYTES - 1}`
		})
	);

	if (!response.Body) {
		return null;
	}

	return await response.Body.transformToByteArray();
};

const loadStoredMediaMetadata = async ({
	client,
	bucket,
	objectKey,
	provider
}: {
	client: S3Client;
	bucket: string;
	objectKey: string;
	provider: Doc<'mediaAssets'>['storageProvider'];
}): Promise<StoredMediaMetadata | null> => {
	try {
		const response = await client.send(
			new HeadObjectCommand({
				Bucket: bucket,
				Key: objectKey
			})
		);
		const signatureBytes =
			Number(response.ContentLength ?? 0) > 0
				? await readObjectSignatureBytes({
						client,
						bucket,
						objectKey
					})
				: null;

		return {
			storageProvider: provider,
			bucket,
			objectKey,
			detectedContentType: signatureBytes ? sniffSupportedContentType(signatureBytes) : null,
			contentType: response.ContentType ?? null,
			sha256: response.ChecksumSHA256 ?? null,
			size: Number(response.ContentLength ?? -1),
			durationSeconds: Number(response.Metadata?.['duration-seconds'] ?? NaN),
			eTag: response.ETag ?? null,
			lastModified: response.LastModified?.getTime() ?? null
		};
	} catch (error) {
		if (isMissingObjectError(error)) {
			return null;
		}
		throw error;
	}
};

const deleteObjectIfPresent = async ({
	client,
	bucket,
	objectKey
}: {
	client: S3Client;
	bucket?: string | null;
	objectKey?: string | null;
}) => {
	if (!bucket || !objectKey) {
		return;
	}

	try {
		await client.send(
			new DeleteObjectCommand({
				Bucket: bucket,
				Key: objectKey
			})
		);
	} catch (error) {
		if (!isMissingObjectError(error)) {
			throw error;
		}
	}
};

const verifyFinalizeExpectations = ({
	asset,
	storageMetadata
}: {
	asset: Doc<'mediaAssets'>;
	storageMetadata: StoredMediaMetadata | null;
}) => {
	if (!storageMetadata) {
		throw new ConvexError('Uploaded file could not be found in storage');
	}

	if (asset.clientSizeBytes !== undefined && storageMetadata.size !== asset.clientSizeBytes) {
		throw new ConvexError('Uploaded file size does not match the expected size');
	}

	if (storageMetadata.size <= 0) {
		throw new ConvexError('Uploaded file is empty');
	}
};

export const beginUpload = internalAction({
	args: {
		ownerUserId: v.string(),
		constraints: mediaUploadConstraintsValidator,
		originalFilename: v.optional(v.string()),
		clientContentType: v.optional(v.string()),
		clientSizeBytes: v.optional(v.number()),
		clientDurationSeconds: v.optional(v.number()),
		clientReportedImageCompression: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const config = loadMediaStorageConfig();
		const client = createS3Client(config);
		const asset: Doc<'mediaAssets'> = await ctx.runMutation(internal.media.createUploadDraft, {
			ownerUserId: args.ownerUserId,
			sourceBucket: config.bucket,
			objectPrefix: config.objectPrefix,
			envPrefix: config.envPrefix,
			constraints: args.constraints,
			originalFilename: args.originalFilename,
			clientContentType: args.clientContentType,
			clientSizeBytes: args.clientSizeBytes,
			clientReportedImageCompression: args.clientReportedImageCompression
		});

		if (!asset.sourceObjectKey) {
			throw new ConvexError('Failed to create upload');
		}

		console.info('media:beginUpload:prepared', {
			assetId: asset._id,
			clientContentType: asset.clientContentType ?? null,
			clientSizeBytes: asset.clientSizeBytes ?? null
		});

		return {
			asset: toResolvedAsset(asset),
			upload: await buildUploadDescriptor({
				client,
				config,
				objectKey: asset.sourceObjectKey,
				maxBytes: asset.maxBytes,
				clientContentType: asset.clientContentType ?? null,
				clientDurationSeconds: args.clientDurationSeconds ?? null
			})
		};
	}
});

export const finalizeUpload = internalAction({
	args: {
		assetId: v.id('mediaAssets'),
		userId: v.string()
	},
	handler: async (ctx, args) => {
		const config = loadMediaStorageConfig();
		const client = createS3Client(config);
		const asset: Doc<'mediaAssets'> = await ctx.runQuery(internal.media.getOwnedAsset, {
			assetId: args.assetId,
			userId: args.userId
		});

		if (asset.status !== 'pending_upload' || !asset.sourceObjectKey || !asset.sourceBucket) {
			throw new ConvexError('Upload is not ready to be finalized');
		}

		const storageMetadata = await loadStoredMediaMetadata({
			client,
			bucket: asset.sourceBucket,
			objectKey: asset.sourceObjectKey,
			provider: asset.storageProvider
		});
		console.info('media:finalizeUpload:headObject', {
			assetId: asset._id,
			clientSizeBytes: asset.clientSizeBytes ?? null,
			storedSize: storageMetadata?.size ?? null,
			storedContentType: storageMetadata?.contentType ?? null
		});
		verifyFinalizeExpectations({
			asset,
			storageMetadata
		});

		const updated: Doc<'mediaAssets'> = await ctx.runMutation(internal.media.markUploadProcessing, {
			assetId: args.assetId,
			ownerUserId: args.userId
		});
		await ctx.scheduler.runAfter(0, internal.mediaNode.processUpload, {
			assetId: args.assetId
		});
		console.info('media:finalizeUpload:queued', {
			assetId: args.assetId,
			attemptCount: updated.attemptCount
		});

		return toResolvedAsset(updated);
	}
});

export const cancelUpload = internalAction({
	args: {
		assetId: v.id('mediaAssets'),
		userId: v.string(),
		deleteStorage: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const asset: Doc<'mediaAssets'> = await ctx.runQuery(internal.media.getOwnedAsset, {
			assetId: args.assetId,
			userId: args.userId
		});
		const deleteStorage = args.deleteStorage ?? true;

		console.info('media:cancelUpload:start', {
			assetId: asset._id,
			status: asset.status,
			deleteStorage
		});

		if (asset.status === 'ready') {
			throw new ConvexError('Ready uploads must be detached by feature-level logic, not canceled');
		}

		if (deleteStorage) {
			const config = loadMediaStorageConfig();
			const client = createS3Client(config);
			await deleteObjectIfPresent({
				client,
				bucket: asset.sourceBucket ?? null,
				objectKey: asset.sourceObjectKey ?? null
			});
			if (asset.processedObjectKey && asset.processedObjectKey !== asset.sourceObjectKey) {
				await deleteObjectIfPresent({
					client,
					bucket: asset.processedBucket ?? asset.sourceBucket ?? null,
					objectKey: asset.processedObjectKey
				});
			}
		}

		const updated: Doc<'mediaAssets'> = await ctx.runMutation(internal.media.markUploadCanceled, {
			assetId: args.assetId,
			ownerUserId: args.userId,
			deleteStorage
		});
		console.info('media:cancelUpload:completed', {
			assetId: updated._id,
			status: updated.status,
			deleteStorage
		});

		return toResolvedAsset(updated);
	}
});

export const deleteUpload: ReturnType<typeof internalAction> = internalAction({
	args: {
		assetId: v.id('mediaAssets'),
		userId: v.string()
	},
	handler: async (
		ctx,
		args
	): Promise<{
		assetId: Id<'mediaAssets'>;
		deleted: true;
	}> => {
		const asset: Doc<'mediaAssets'> = await ctx.runQuery(internal.media.getOwnedAsset, {
			assetId: args.assetId,
			userId: args.userId
		});
		const attachmentUsage: {
			profileId: Id<'profiles'> | null;
			clubId: Id<'clubs'> | null;
		} = await ctx.runQuery(internal.media.getAssetAttachmentUsage, {
			assetId: args.assetId
		});

		if (attachmentUsage.profileId || attachmentUsage.clubId) {
			throw new ConvexError('Attached uploads cannot be deleted');
		}

		console.info('media:deleteUpload:start', {
			assetId: asset._id,
			status: asset.status
		});

		const config = loadMediaStorageConfig();
		const client = createS3Client(config);
		await deleteObjectIfPresent({
			client,
			bucket: asset.sourceBucket ?? null,
			objectKey: asset.sourceObjectKey ?? null
		});
		if (asset.processedObjectKey && asset.processedObjectKey !== asset.sourceObjectKey) {
			await deleteObjectIfPresent({
				client,
				bucket: asset.processedBucket ?? asset.sourceBucket ?? null,
				objectKey: asset.processedObjectKey
			});
		}

		const deleted: {
			assetId: Id<'mediaAssets'>;
			deleted: true;
		} = await ctx.runMutation(internal.media.deleteUploadRecord, {
			assetId: args.assetId,
			ownerUserId: args.userId
		});
		console.info('media:deleteUpload:completed', {
			assetId: deleted.assetId
		});

		return deleted;
	}
});

export const processUpload = internalAction({
	args: {
		assetId: v.id('mediaAssets')
	},
	handler: async (ctx, args): Promise<Doc<'mediaAssets'> | null> => {
		try {
			const asset: Doc<'mediaAssets'> | null = await ctx.runQuery(internal.media.getAssetRecord, {
				assetId: args.assetId
			});
			if (
				!asset ||
				asset.status !== 'processing' ||
				!asset.sourceBucket ||
				!asset.sourceObjectKey
			) {
				return null;
			}

			const config = loadMediaStorageConfig();
			const client = createS3Client(config);
			const storageMetadata = await loadStoredMediaMetadata({
				client,
				bucket: asset.sourceBucket,
				objectKey: asset.sourceObjectKey,
				provider: asset.storageProvider
			});
			console.info('media:processUpload:start', {
				assetId: asset._id,
				storedSize: storageMetadata?.size ?? null,
				storedContentType: storageMetadata?.contentType ?? null
			});
			const rekognitionClient = createRekognitionClient();
			const moderateImage = buildImageModerator({ client, rekognitionClient });

			const result = await runMediaPipeline({
				asset: {
					acceptedContentTypes: asset.acceptedContentTypes as SupportedContentType[],
					maxBytes: asset.maxBytes,
					enableCompression: asset.enableCompression,
					enableSafetyScreening: asset.enableSafetyScreening,
					originalFilename: asset.originalFilename ?? null,
					clientContentType: asset.clientContentType ?? null,
					clientReportedImageCompression: asset.clientReportedImageCompression ?? false
				},
				storageMetadata,
				moderateImage
			});

			if (result.ok) {
				console.info('media:processUpload:ready', {
					assetId: asset._id,
					mediaKind: result.descriptor.mediaKind ?? null,
					contentType: result.descriptor.contentType ?? null,
					sizeBytes: result.descriptor.sizeBytes,
					moderationStatus: result.descriptor.moderation?.status ?? null
				});
				return await ctx.runMutation(internal.media.markUploadReady, {
					assetId: asset._id,
					mediaKind: result.descriptor.mediaKind ?? undefined,
					contentType: result.descriptor.contentType ?? undefined,
					sizeBytes: result.descriptor.sizeBytes,
					durationSeconds: result.descriptor.durationSeconds ?? undefined,
					sha256: result.descriptor.sha256 ?? undefined,
					moderation: result.descriptor.moderation ?? undefined,
					stepResults: result.steps
				});
			}

			console.warn('media:processUpload:failed', {
				assetId: asset._id,
				failureCode: result.failure.code,
				failureStage: result.failure.stage,
				retryable: result.failure.retryable
			});
			if (isOperationalMediaFailure(result.failure.code)) {
				await reportConvexError(new Error(`Media pipeline failed: ${result.failure.code}`), {
					area: 'media',
					operation: 'media:process-pipeline',
					identifiers: {
						assetId: asset._id,
						attemptCount: asset.attemptCount,
						failureCode: result.failure.code,
						status: 'failed'
					}
				});
			}
			return await ctx.runMutation(internal.media.markUploadFailed, {
				assetId: asset._id,
				mediaKind: result.descriptor?.mediaKind ?? undefined,
				contentType: result.descriptor?.contentType ?? undefined,
				sizeBytes: result.descriptor?.sizeBytes ?? undefined,
				durationSeconds: result.descriptor?.durationSeconds ?? undefined,
				sha256: result.descriptor?.sha256 ?? undefined,
				moderation: result.descriptor?.moderation ?? undefined,
				stepResults: result.steps,
				failure: result.failure
			});
		} catch (error) {
			await reportConvexError(error, {
				area: 'media',
				operation: 'media:process-upload',
				identifiers: { assetId: args.assetId }
			});
			// Scheduled actions are not retried by Convex: rethrowing here left the
			// asset in 'processing' forever and the uploader waiting on a spinner.
			// Record the failure so the client sees a retryable error instead.
			try {
				await ctx.runMutation(internal.media.markUploadFailed, {
					assetId: args.assetId,
					stepResults: [],
					failure: {
						code: 'pipeline_exception',
						message: 'Media processing failed unexpectedly. Please try uploading again.',
						stage: 'processing',
						recoverable: true,
						retryable: true
					}
				});
			} catch {
				// If the asset vanished or is in a state that rejects the patch,
				// the original error report above is still the source of truth.
			}
			throw error;
		}
	}
});
