import type { Id } from '$convex/_generated/dataModel';
import type { ConvexClient } from 'convex/browser';
import { captureUnexpectedOperationalError } from '$lib/monitoring/capture';
import {
	VIDEO_CONTENT_TYPES,
	beginMediaUpload,
	createLocalPreviewUrl,
	deleteMediaUpload,
	describeMediaUploadConstraints,
	finalizeMediaUpload,
	getMediaUpload,
	type MediaAssetLifecycleError,
	type MediaUploadConstraintsInput,
	normalizeUploadErrorMessage,
	revokePreviewUrl,
	uploadFileToDescriptor,
	waitForMediaUploadReady
} from './upload-core';

type MediaFieldMode = 'immediate' | 'deferred';
type MediaFieldPhase = 'idle' | 'selected' | 'uploading' | 'processing' | 'ready' | 'failed';
type MediaAssetStatus = 'pending_upload' | 'processing' | 'ready' | 'failed' | 'canceled' | null;

type MediaFieldDefinition = {
	constraints: MediaUploadConstraintsInput;
	expectedMediaKind: 'image' | 'video';
	requireReady: boolean;
};

const TEN_MB = 10 * 1000 * 1000;
const HUNDRED_MB = 100 * 1000 * 1000;

const mediaFieldDefinitions = {
	profileImage: {
		constraints: {
			acceptedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
			maxBytes: TEN_MB,
			enableCompression: true,
			enableSafetyScreening: true
		},
		expectedMediaKind: 'image',
		requireReady: true
	},
	clubVideo: {
		constraints: {
			acceptedContentTypes: [...VIDEO_CONTENT_TYPES],
			maxBytes: HUNDRED_MB,
			enableCompression: true,
			enableSafetyScreening: true
		},
		expectedMediaKind: 'video',
		requireReady: true
	}
} as const satisfies Record<string, MediaFieldDefinition>;

export type MediaFieldName = keyof typeof mediaFieldDefinitions;

const isLifecycleError = (error: unknown): error is MediaAssetLifecycleError =>
	error instanceof Error && error.name === 'MediaAssetLifecycleError';

class MediaFieldController {
	readonly definition: (typeof mediaFieldDefinitions)[MediaFieldName];
	readonly constraints: ReturnType<typeof describeMediaUploadConstraints>;
	readonly accept: string;
	readonly maxBytes: number;
	readonly acceptedContentTypes: string[];
	readonly mode: MediaFieldMode;

	phase = $state<MediaFieldPhase>('idle');
	assetStatus = $state<MediaAssetStatus>(null);
	errorMessage = $state('');
	selectedFile = $state<File | null>(null);
	localPreviewUrl = $state<string | null>(null);
	assetId = $state<Id<'mediaAssets'> | null>(null);

	private generation = 0;
	private currentEnsureGeneration: number | null = null;
	private currentEnsurePromise: Promise<Id<'mediaAssets'> | null> | null = null;
	private currentAssetAttached = false;
	private destroyed = false;

	constructor(
		private readonly convexClient: ConvexClient,
		fieldName: MediaFieldName,
		options?: {
			mode?: MediaFieldMode;
		}
	) {
		this.definition = mediaFieldDefinitions[fieldName];
		this.constraints = describeMediaUploadConstraints(this.definition.constraints);
		this.accept = this.constraints.accept;
		this.maxBytes = this.constraints.maxBytes;
		this.acceptedContentTypes = [...this.constraints.acceptedContentTypes];
		this.mode = options?.mode ?? 'immediate';
	}

	selectedFileName = $derived(this.selectedFile?.name ?? '');
	hasUploadedAsset = $derived(this.assetId !== null);
	isReady = $derived(this.assetStatus === 'ready' && this.phase === 'ready');
	isBusy = $derived(this.phase === 'uploading' || this.phase === 'processing');

	private clearPreview = () => {
		revokePreviewUrl(this.localPreviewUrl);
		this.localPreviewUrl = null;
	};

	private cleanupAssetInBackground = (assetId: Id<'mediaAssets'> | null) => {
		if (!assetId) return;
		void deleteMediaUpload(this.convexClient, assetId).catch(() => {
			// Best-effort cleanup for abandoned uploads.
		});
	};

	private resetState = () => {
		this.clearPreview();
		this.selectedFile = null;
		this.assetId = null;
		this.assetStatus = null;
		this.phase = 'idle';
		this.errorMessage = '';
		this.currentAssetAttached = false;
	};

	private replaceSelection = (file: File) => {
		const priorAssetId = this.currentAssetAttached ? null : this.assetId;
		this.generation += 1;
		this.currentEnsureGeneration = null;
		this.currentEnsurePromise = null;
		this.clearPreview();
		this.cleanupAssetInBackground(priorAssetId);
		this.selectedFile = file;
		this.localPreviewUrl = createLocalPreviewUrl(file) ?? null;
		this.assetId = null;
		this.assetStatus = null;
		this.phase = 'selected';
		this.errorMessage = '';
		this.currentAssetAttached = false;
	};

	private isActiveGeneration = (generation: number) =>
		!this.destroyed && this.generation === generation;

	private setFailure = (message: string, assetStatus?: MediaAssetStatus) => {
		if (assetStatus) {
			this.assetStatus = assetStatus;
		}
		this.phase = 'failed';
		this.errorMessage = message;
	};

	private waitForReady = async (generation: number, assetId: Id<'mediaAssets'>) => {
		try {
			const asset = await waitForMediaUploadReady(this.convexClient, assetId);
			if (!this.isActiveGeneration(generation)) {
				this.cleanupAssetInBackground(assetId);
				return null;
			}
			this.assetStatus = asset.status;
			this.phase = 'ready';
			return asset.assetId;
		} catch (error) {
			if (!this.isActiveGeneration(generation)) {
				this.cleanupAssetInBackground(assetId);
				return null;
			}

			if (isLifecycleError(error)) {
				captureUnexpectedOperationalError(error, {
					area: 'media',
					operation: 'media:wait-for-ready',
					identifiers: {
						assetId,
						failureCode: error.asset?.lastFailure?.code,
						status: error.asset?.status
					}
				});
				this.setFailure(error.message, error.asset?.status ?? this.assetStatus);
				return null;
			}

			captureUnexpectedOperationalError(error, {
				area: 'media',
				operation: 'media:wait-for-ready',
				identifiers: { assetId, status: this.assetStatus }
			});
			this.setFailure(normalizeUploadErrorMessage(error), this.assetStatus);
			return null;
		}
	};

	selectFiles = async (files: File[]) => {
		const file = files[0];
		if (!file) return;

		this.replaceSelection(file);

		if (this.mode === 'immediate') {
			await this.ensureUploaded();
		}
	};

	ensureUploaded = async () => {
		if (this.currentEnsurePromise && this.currentEnsureGeneration === this.generation) {
			return this.currentEnsurePromise;
		}

		const generation = this.generation;
		const promise = this.runEnsureUploaded(generation).finally(() => {
			if (this.currentEnsurePromise === promise) {
				this.currentEnsurePromise = null;
				this.currentEnsureGeneration = null;
			}
		});

		this.currentEnsurePromise = promise;
		this.currentEnsureGeneration = generation;
		return promise;
	};

	private runEnsureUploaded = async (generation: number) => {
		const selectedFile = this.selectedFile;
		const existingAssetId = this.assetId;

		if (!selectedFile && !existingAssetId) {
			return null;
		}

		if (existingAssetId) {
			if (this.assetStatus === 'ready') {
				this.phase = 'ready';
				return existingAssetId;
			}

			if (this.assetStatus === 'processing') {
				return await this.waitForReady(generation, existingAssetId);
			}

			if (this.assetStatus === 'pending_upload') {
				const asset = await getMediaUpload(this.convexClient, existingAssetId);
				if (!this.isActiveGeneration(generation)) {
					this.cleanupAssetInBackground(existingAssetId);
					return null;
				}
				this.assetStatus = asset.status;
				if (asset.status === 'processing') {
					this.phase = 'processing';
					return await this.waitForReady(generation, existingAssetId);
				}
				if (asset.status === 'ready') {
					this.phase = 'ready';
					return existingAssetId;
				}
			}

			this.cleanupAssetInBackground(existingAssetId);
			this.assetId = null;
			this.assetStatus = null;
		}

		if (!selectedFile) {
			return null;
		}

		try {
			this.phase = 'uploading';
			this.errorMessage = '';

			const beginResult = await beginMediaUpload(
				this.convexClient,
				selectedFile,
				this.definition.constraints
			);
			const nextAssetId = beginResult.asset.assetId;

			if (!this.isActiveGeneration(generation)) {
				this.cleanupAssetInBackground(nextAssetId);
				return null;
			}

			this.assetId = nextAssetId;
			this.assetStatus = beginResult.asset.status;

			await uploadFileToDescriptor(selectedFile, beginResult.upload);

			if (!this.isActiveGeneration(generation)) {
				this.cleanupAssetInBackground(nextAssetId);
				return null;
			}

			this.phase = 'processing';
			const finalized = await finalizeMediaUpload(this.convexClient, nextAssetId);

			if (!this.isActiveGeneration(generation)) {
				this.cleanupAssetInBackground(nextAssetId);
				return null;
			}

			this.assetStatus = finalized.status;

			if (finalized.status === 'ready') {
				this.phase = 'ready';
				return nextAssetId;
			}

			if (finalized.status === 'processing' || this.definition.requireReady) {
				return await this.waitForReady(generation, nextAssetId);
			}

			this.phase = 'ready';
			return nextAssetId;
		} catch (error) {
			if (!this.isActiveGeneration(generation)) {
				if (this.assetId && !this.currentAssetAttached) {
					this.cleanupAssetInBackground(this.assetId);
				}
				return null;
			}

			const message = normalizeUploadErrorMessage(error);
			const assetStatus = isLifecycleError(error)
				? (error.asset?.status ?? this.assetStatus)
				: this.assetStatus;
			captureUnexpectedOperationalError(error, {
				area: 'media',
				operation: 'media:upload',
				identifiers: {
					assetId: this.assetId,
					failureCode: isLifecycleError(error) ? error.asset?.lastFailure?.code : undefined,
					status: assetStatus
				}
			});
			this.setFailure(message, assetStatus);
			return null;
		}
	};

	persistAttached = async <T>(callback: (assetId: Id<'mediaAssets'> | null) => Promise<T>) => {
		const targetGeneration = this.generation;
		const targetAssetId = this.assetId;

		if (!targetAssetId) {
			return await callback(null);
		}

		if (!this.isReady) {
			throw new Error('Media asset is not ready yet.');
		}

		const result = await callback(targetAssetId);
		if (this.isActiveGeneration(targetGeneration) && this.assetId === targetAssetId) {
			this.currentAssetAttached = true;
		}
		return result;
	};

	clear = () => {
		const cleanupAssetId = this.currentAssetAttached ? null : this.assetId;
		this.generation += 1;
		this.currentEnsureGeneration = null;
		this.currentEnsurePromise = null;
		this.resetState();
		this.cleanupAssetInBackground(cleanupAssetId);
	};

	destroy = () => {
		const cleanupAssetId = this.currentAssetAttached ? null : this.assetId;
		this.destroyed = true;
		this.generation += 1;
		this.currentEnsureGeneration = null;
		this.currentEnsurePromise = null;
		this.resetState();
		this.cleanupAssetInBackground(cleanupAssetId);
	};
}

export const createMediaField = (
	convexClient: ConvexClient,
	fieldName: MediaFieldName,
	options?: {
		mode?: MediaFieldMode;
	}
) => new MediaFieldController(convexClient, fieldName, options);

export const mediaFieldRegistry = mediaFieldDefinitions;
