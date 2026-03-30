import { api } from '$convex/_generated/api';
import type { Id } from '$convex/_generated/dataModel';
import type { ConvexClient } from 'convex/browser';
import {
	beginMediaUpload,
	createLocalPreviewUrl,
	createMediaUploadConstraintsFromPreset,
	describeMediaUploadConstraints,
	finalizeMediaUpload,
	getLocalPreviewKind,
	mediaUploadPresets,
	normalizeUploadErrorMessage,
	revokePreviewUrl,
	uploadFileToDescriptor,
	type MediaUploadConstraintsInput,
	type MediaUploadPreset,
	type MediaUploadUiConstraints
} from './upload-core';

export {
	createMediaUploadConstraintsFromPreset,
	describeMediaUploadConstraints,
	mediaUploadPresets,
	type MediaUploadConstraintsInput,
	type MediaUploadPreset,
	type MediaUploadUiConstraints
};

export type MediaUploadRun = {
	id: string;
	fileName: string;
	assetId?: Id<'mediaAssets'>;
	previewKind?: 'image' | 'video';
	previewUrl?: string;
	status: 'starting' | 'uploading' | 'waiting_to_finalize' | 'finalizing' | 'processing' | 'failed';
	message: string;
	objectKey?: string;
};

type UploadFilesOptions = {
	constraints: MediaUploadConstraintsInput;
	autoFinalize?: boolean;
	onAssetSelected?: (assetId: Id<'mediaAssets'>) => void;
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
					const beginResult = await beginMediaUpload(convexClient, file, constraints);

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
						await finalizeMediaUpload(convexClient, beginResult.asset.assetId);
						patchRun(runId, {
							status: 'processing',
							message: 'Upload finalized and queued for processing.'
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
						? 'Upload batch finalized. Review processing state below.'
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
			await finalizeMediaUpload(convexClient, assetId);
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
