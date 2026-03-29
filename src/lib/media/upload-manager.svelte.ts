import { browser } from '$app/environment';
import { api } from '$convex/_generated/api';
import type { Id } from '$convex/_generated/dataModel';
import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';

const mb = (value: number) => value * 1024 * 1024;

export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export const VIDEO_CONTENT_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];

export const mediaUploadPresets = {
	images: {
		label: 'Images',
		acceptedContentTypes: IMAGE_CONTENT_TYPES,
		maxBytesMb: 20
	},
	videos: {
		label: 'Videos',
		acceptedContentTypes: VIDEO_CONTENT_TYPES,
		maxBytesMb: 250
	},
	mixed: {
		label: 'Mixed media',
		acceptedContentTypes: [...IMAGE_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES],
		maxBytesMb: 250
	}
} as const;

export type MediaUploadPreset = keyof typeof mediaUploadPresets;

export type MediaUploadConstraintsInput = {
	acceptedContentTypes: string[];
	maxBytes: number;
	enableCompression?: boolean;
	enableSafetyScreening?: boolean;
};

export type MediaUploadConstraints = {
	acceptedContentTypes: string[];
	maxBytes: number;
	enableCompression: boolean;
	enableSafetyScreening: boolean;
};

// Keep backend request constraints separate from UI-only helpers like `accept`.
export type MediaUploadUiConstraints = MediaUploadConstraints & {
	accept: string;
};

export type MediaUploadDescriptor = {
	provider: string;
	method: 'PUT' | 'POST';
	url: string;
	headers?: Record<string, string>;
	fields?: Record<string, string>;
	objectKey: string;
	uploadToken?: string;
};

export type MediaUploadRun = {
	id: string;
	fileName: string;
	assetId?: Id<'mediaAssets'>;
	previewKind?: 'image' | 'video';
	previewUrl?: string;
	status:
		| 'starting'
		| 'uploading'
		| 'waiting_to_finalize'
		| 'finalizing'
		| 'completed'
		| 'failed';
	message: string;
	objectKey?: string;
};

type ResolvedMediaAsset = FunctionReturnType<typeof api.media.getUpload>;

type MediaBeginUploadResult = {
	asset: ResolvedMediaAsset;
	upload: MediaUploadDescriptor;
};

type UploadFilesOptions = {
	constraints: MediaUploadConstraintsInput;
	autoFinalize?: boolean;
	onAssetSelected?: (assetId: Id<'mediaAssets'>) => void;
};

const normalizeAcceptedContentTypes = (acceptedContentTypes: string[]) =>
	[...new Set(acceptedContentTypes.map((entry) => entry.trim().toLowerCase()).filter(Boolean))];

export const describeMediaUploadConstraints = (
	input: MediaUploadConstraintsInput
): MediaUploadUiConstraints => {
	const acceptedContentTypes = normalizeAcceptedContentTypes(input.acceptedContentTypes);

	return {
		acceptedContentTypes,
		maxBytes: Math.max(1, Math.floor(Number(input.maxBytes) || 1)),
		enableCompression: input.enableCompression ?? false,
		enableSafetyScreening: input.enableSafetyScreening ?? false,
		accept: acceptedContentTypes.join(',')
	};
};

const toMediaUploadRequestConstraints = (
	constraints: MediaUploadUiConstraints
): MediaUploadConstraints => ({
	// Strip UI-only fields before sending constraints through Convex validators.
	acceptedContentTypes: [...constraints.acceptedContentTypes],
	maxBytes: constraints.maxBytes,
	enableCompression: constraints.enableCompression,
	enableSafetyScreening: constraints.enableSafetyScreening
});

export const createMediaUploadConstraintsFromPreset = (
	preset: MediaUploadPreset,
	options?: {
		enableCompression?: boolean;
		enableSafetyScreening?: boolean;
	}
) =>
	describeMediaUploadConstraints({
		acceptedContentTypes: [...mediaUploadPresets[preset].acceptedContentTypes],
		maxBytes: mb(mediaUploadPresets[preset].maxBytesMb),
		enableCompression: options?.enableCompression ?? false,
		enableSafetyScreening: options?.enableSafetyScreening ?? false
	});

const compactWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const truncate = (value: string, maxLength = 240) =>
	value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

const buildUploadFailureMessage = async (response: Response) => {
	const suffix = response.statusText ? ` ${response.statusText}` : '';
	const rawBody = compactWhitespace(await response.text());
	const xmlCode = rawBody.match(/<Code>([^<]+)<\/Code>/)?.[1];
	const xmlMessage = rawBody.match(/<Message>([^<]+)<\/Message>/)?.[1];
	const xmlRequestId = rawBody.match(/<RequestId>([^<]+)<\/RequestId>/)?.[1];
	const detail =
		[xmlCode, xmlMessage, xmlRequestId ? `RequestId ${xmlRequestId}` : null]
			.filter(Boolean)
			.join(' | ') || truncate(rawBody);

	return detail
		? `Upload failed (${response.status}${suffix}): ${detail}`
		: `Upload failed (${response.status}${suffix})`;
};

const normalizeUploadErrorMessage = (error: unknown) => {
	if (error instanceof Error) {
		if (error instanceof TypeError) {
			return `${error.message}. The browser did not get a usable S3 response. Check bucket CORS, the presigned URL region, and network access to S3.`;
		}

		return error.message;
	}

	return 'Upload failed.';
};

const getLocalPreviewKind = (file: File): MediaUploadRun['previewKind'] => {
	if (file.type.startsWith('image/')) return 'image';
	if (file.type.startsWith('video/')) return 'video';
	return undefined;
};

const createLocalPreviewUrl = (file: File) => {
	if (!browser) return undefined;
	const previewKind = getLocalPreviewKind(file);
	if (!previewKind) return undefined;
	return URL.createObjectURL(file);
};

const readLocalMediaDurationSeconds = async (file: File) => {
	if (!browser || !file.type.startsWith('video/')) {
		return undefined;
	}

	const objectUrl = URL.createObjectURL(file);

	try {
		return await new Promise<number | undefined>((resolve) => {
			const video = document.createElement('video');
			video.preload = 'metadata';

			const cleanup = () => {
				video.removeAttribute('src');
				video.load();
				URL.revokeObjectURL(objectUrl);
			};

			video.onloadedmetadata = () => {
				const duration = Number(video.duration);
				cleanup();
				resolve(Number.isFinite(duration) && duration > 0 ? duration : undefined);
			};

			video.onerror = () => {
				cleanup();
				resolve(undefined);
			};

			video.src = objectUrl;
		});
	} catch {
		URL.revokeObjectURL(objectUrl);
		return undefined;
	}
};

const revokePreviewUrl = (previewUrl?: string) => {
	if (!browser || !previewUrl) return;
	URL.revokeObjectURL(previewUrl);
};

const uploadFileToDescriptor = async (file: File, upload: MediaUploadDescriptor) => {
	if (upload.method === 'POST') {
		const formData = new FormData();
		for (const [key, value] of Object.entries(upload.fields ?? {})) {
			formData.append(key, value);
		}
		formData.append('file', file);

		const response = await fetch(upload.url, {
			method: 'POST',
			body: formData
		});

		if (!response.ok) {
			throw new Error(await buildUploadFailureMessage(response));
		}

		return;
	}

	const response = await fetch(upload.url, {
		method: upload.method,
		headers: {
			...(upload.headers ?? {}),
			...(!upload.headers?.['content-type'] && file.type ? { 'content-type': file.type } : {})
		},
		body: file
	});

	if (!response.ok) {
		throw new Error(await buildUploadFailureMessage(response));
	}
};

export const createMediaUploadManager = (
	convexClient: ConvexClient,
	options?: {
		maxRecentRuns?: number;
	}
) => {
	const maxRecentRuns = options?.maxRecentRuns ?? 10;

	let isUploading = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');
	let recentRuns = $state<MediaUploadRun[]>([]);
	let lastUploadedAssetId = $state<Id<'mediaAssets'> | null>(null);

	const replaceRecentRuns = (nextRuns: MediaUploadRun[]) => {
		const nextRunIds = nextRuns.map((run) => run.id);
		for (const run of recentRuns) {
			if (!nextRunIds.includes(run.id)) {
				revokePreviewUrl(run.previewUrl);
			}
		}
		recentRuns = nextRuns;
	};

	const pushRun = (run: MediaUploadRun) => {
		replaceRecentRuns([run, ...recentRuns].slice(0, maxRecentRuns));
	};

	const patchRun = (id: string, patch: Partial<MediaUploadRun>) => {
		replaceRecentRuns(recentRuns.map((run) => (run.id === id ? { ...run, ...patch } : run)));
	};

	const clearFeedback = () => {
		errorMessage = '';
		successMessage = '';
	};

	const uploadFiles = async (files: File[], uploadOptions: UploadFilesOptions) => {
		const constraints = describeMediaUploadConstraints(uploadOptions.constraints);
		if (!constraints.acceptedContentTypes.length) {
			errorMessage = 'Add at least one accepted content type before uploading.';
			successMessage = '';
			return [];
		}

		isUploading = true;
		clearFeedback();

		const uploadedAssetIds: Id<'mediaAssets'>[] = [];
		let failureCount = 0;

		try {
			for (const file of files) {
				const runId = crypto.randomUUID();
				const previewKind = getLocalPreviewKind(file);
				const previewUrl = createLocalPreviewUrl(file);
				pushRun({
					id: runId,
					fileName: file.name,
					previewKind,
					previewUrl,
					status: 'starting',
					message: 'Creating upload session...'
				});

				try {
					const clientDurationSeconds = await readLocalMediaDurationSeconds(file);
					const beginResult = (await convexClient.action(api.media.beginUpload, {
						constraints: toMediaUploadRequestConstraints(constraints),
						originalFilename: file.name,
						clientContentType: file.type || undefined,
						clientSizeBytes: file.size,
						clientDurationSeconds
					})) as MediaBeginUploadResult;

					patchRun(runId, {
						assetId: beginResult.asset.assetId,
						objectKey: beginResult.upload.objectKey,
						status: 'uploading',
						message: `Uploading ${file.name} to ${beginResult.upload.provider}...`
					});

					await uploadFileToDescriptor(file, beginResult.upload);

					lastUploadedAssetId = beginResult.asset.assetId;
					uploadOptions.onAssetSelected?.(beginResult.asset.assetId);
					uploadedAssetIds.push(beginResult.asset.assetId);

					if (uploadOptions.autoFinalize ?? true) {
						patchRun(runId, {
							status: 'finalizing',
							message: 'Upload complete. Finalizing asset...'
						});
						await convexClient.action(api.media.finalizeUpload, {
							assetId: beginResult.asset.assetId
						});
						patchRun(runId, {
							status: 'completed',
							message: 'Upload finalized, processed, and ready.'
						});
					} else {
						patchRun(runId, {
							status: 'waiting_to_finalize',
							message: 'Binary upload finished. Use Finalize to start processing before this can be used.'
						});
					}
				} catch (error) {
					const message = normalizeUploadErrorMessage(error);
					errorMessage = message;
					failureCount += 1;
					patchRun(runId, {
						status: 'failed',
						message
					});
				}
			}

			if (files.length && failureCount === 0) {
				successMessage =
					uploadOptions.autoFinalize ?? true
						? 'Upload batch completed. Review processing state below.'
						: 'Upload batch sent. Finalize pending uploads when you are ready.';
			} else if (files.length && failureCount < files.length) {
				successMessage = 'Upload batch finished with some failures. Review the recent attempts below.';
			}

			return uploadedAssetIds;
		} finally {
			isUploading = false;
		}
	};

	const finalizeAsset = async (assetId: Id<'mediaAssets'>) => {
		clearFeedback();
		lastUploadedAssetId = assetId;
		try {
			await convexClient.action(api.media.finalizeUpload, { assetId });
			successMessage = 'Upload finalized and queued for processing.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unable to finalize upload.';
		}
	};

	const retryAsset = async (assetId: Id<'mediaAssets'>) => {
		clearFeedback();
		lastUploadedAssetId = assetId;
		try {
			await convexClient.mutation(api.media.retryProcessing, { assetId });
			successMessage = 'Retry queued.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unable to retry processing.';
		}
	};

	const cancelAsset = async (
		assetId: Id<'mediaAssets'>,
		cancelOptions?: {
			deleteStorage?: boolean;
		}
	) => {
		clearFeedback();
		lastUploadedAssetId = assetId;
		const deleteStorage = cancelOptions?.deleteStorage ?? true;

		try {
			await convexClient.action(api.media.cancelUpload, {
				assetId,
				deleteStorage
			});
			successMessage = deleteStorage
				? 'Upload canceled and storage cleaned up.'
				: 'Upload canceled without deleting storage.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unable to cancel upload.';
		}
	};

	const destroy = () => {
		for (const run of recentRuns) {
			revokePreviewUrl(run.previewUrl);
		}
		recentRuns = [];
	};

	return {
		get isUploading() {
			return isUploading;
		},
		get errorMessage() {
			return errorMessage;
		},
		get successMessage() {
			return successMessage;
		},
		get recentRuns() {
			return recentRuns;
		},
		get lastUploadedAssetId() {
			return lastUploadedAssetId;
		},
		clearFeedback,
		uploadFiles,
		finalizeAsset,
		retryAsset,
		cancelAsset,
		destroy
	};
};
