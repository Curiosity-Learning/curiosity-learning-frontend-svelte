import type { Id } from '$convex/_generated/dataModel';
import type { ConvexClient } from 'convex/browser';
import { captureUnexpectedOperationalError } from '$lib/monitoring/capture';
import {
	VIDEO_CONTENT_TYPES,
	beginMediaUpload,
	compressImageFileIfPossible,
	createLocalPreviewUrl,
	deleteMediaUpload,
	describeMediaUploadConstraints,
	finalizeMediaUpload,
	getLocalPreviewKind,
	getMediaUpload,
	type MediaAssetLifecycleError,
	type MediaUploadConstraintsInput,
	normalizeUploadErrorMessage,
	readLocalMediaDurationSeconds,
	revokePreviewUrl,
	uploadFileToDescriptor,
	waitForMediaUploadReady
} from './upload-core';
import { formatT, t } from '$lib/i18n';

type MediaFieldMode = 'immediate' | 'deferred';
type MediaFieldPhase = 'idle' | 'selected' | 'uploading' | 'processing' | 'ready' | 'failed';
type MediaAssetStatus = 'pending_upload' | 'processing' | 'ready' | 'failed' | 'canceled' | null;

type MediaFieldDefinition = {
	constraints: MediaUploadConstraintsInput;
	expectedMediaKind: 'image' | 'video';
	requireReady: boolean;
	maxDurationSeconds?: number;
};

type MultiMediaFieldDefinition = {
	constraints: MediaUploadConstraintsInput;
	maxDurationSeconds?: number;
};

const TEN_MB = 10 * 1000 * 1000;
const HUNDRED_MB = 100 * 1000 * 1000;
const TWO_MINUTES_SECONDS = 2 * 60;

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
		requireReady: true,
		maxDurationSeconds: TWO_MINUTES_SECONDS
	},
	sessionPhoto: {
		constraints: {
			acceptedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
			maxBytes: TEN_MB,
			enableCompression: true,
			enableSafetyScreening: true
		},
		expectedMediaKind: 'image',
		requireReady: true
	},
	projectCover: {
		constraints: {
			acceptedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
			maxBytes: TEN_MB,
			enableCompression: true,
			enableSafetyScreening: true
		},
		expectedMediaKind: 'image',
		requireReady: true
	}
} as const satisfies Record<string, MediaFieldDefinition>;

export type MediaFieldName = keyof typeof mediaFieldDefinitions;

// PRD 6.7.1: update attachments accept images AND video mixed in the same picker (unlike the
// other single-kind fields above), so it lives in its own registry rather than
// `mediaFieldDefinitions` (whose `expectedMediaKind` is singular per field).
const multiMediaFieldDefinitions = {
	updateAttachment: {
		constraints: {
			acceptedContentTypes: [
				'image/jpeg',
				'image/png',
				'image/webp',
				...VIDEO_CONTENT_TYPES
			],
			maxBytes: HUNDRED_MB,
			enableCompression: true,
			enableSafetyScreening: true
		}
		// CEO ruling (CL-685, 2026-07-11): general uploads are capped by file SIZE only; the
		// 2-minute duration cap applies solely to the club application video (`clubVideo`).
	}
} as const satisfies Record<string, MultiMediaFieldDefinition>;

export type MultiMediaFieldName = keyof typeof multiMediaFieldDefinitions;

const isLifecycleError = (error: unknown): error is MediaAssetLifecycleError =>
	error instanceof Error && error.name === 'MediaAssetLifecycleError';

// Client-side pre-flight size check (mirrors the videoTooLong duration check below): catches an
// oversized file instantly, with a clear i18n'd message, instead of relying solely on the
// server-side validate-file-size pipeline step's (English-only) rejection after a network round
// trip. The server still enforces the real hard cap independently — this is UX, not the security
// boundary.
const fileTooLargeMessage = (maxBytes: number) =>
	formatT('mediaUpload.fileTooLarge', { maxSizeMb: Math.round(maxBytes / (1000 * 1000)) });

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

			// Only checked pre-flight for video: images go through client-side compression below
			// first, so an oversized original can still end up under `maxBytes` post-compression —
			// checking the raw `selectedFile.size` here would reject those unnecessarily. Videos are
			// never client-compressed before upload, so this check is exact for them.
			if (this.definition.expectedMediaKind === 'video' && selectedFile.size > this.maxBytes) {
				this.setFailure(fileTooLargeMessage(this.maxBytes));
				return null;
			}

			if (this.definition.expectedMediaKind === 'video' && this.definition.maxDurationSeconds) {
				const durationSeconds = await readLocalMediaDurationSeconds(selectedFile);
				if (!this.isActiveGeneration(generation)) {
					return null;
				}
				if (
					typeof durationSeconds === 'number' &&
					durationSeconds > this.definition.maxDurationSeconds
				) {
					this.setFailure(t('mediaUpload.videoTooLong'));
					return null;
				}
			}

			let uploadFile = selectedFile;
			let clientReportedImageCompression = false;
			if (this.definition.expectedMediaKind === 'image') {
				const compressed = await compressImageFileIfPossible(selectedFile);
				if (!this.isActiveGeneration(generation)) {
					return null;
				}
				if (compressed) {
					uploadFile = compressed;
					clientReportedImageCompression = true;
				}
			}

			const beginResult = await beginMediaUpload(
				this.convexClient,
				uploadFile,
				this.definition.constraints,
				{ clientReportedImageCompression }
			);
			const nextAssetId = beginResult.asset.assetId;

			if (!this.isActiveGeneration(generation)) {
				this.cleanupAssetInBackground(nextAssetId);
				return null;
			}

			this.assetId = nextAssetId;
			this.assetStatus = beginResult.asset.status;

			await uploadFileToDescriptor(uploadFile, beginResult.upload);

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

// --- Multi-file field (PRD 6.7.1: up to 4 images/videos on a project update) ---

export type MultiMediaItemPhase =
	| 'selected'
	| 'uploading'
	| 'processing'
	| 'ready'
	| 'failed';

export type MultiMediaItem = {
	readonly key: number;
	readonly file: File;
	readonly localPreviewUrl: string | null;
	readonly mediaKind: 'image' | 'video' | undefined;
	phase: MultiMediaItemPhase;
	errorMessage: string;
	assetId: Id<'mediaAssets'> | null;
};

/**
 * Manages a capped list of independently-uploading media items (mixed images/videos) for
 * composers that need several attachments in one submission (e.g. the update composer), unlike
 * `MediaFieldController` which only ever tracks a single file. Each item uploads as soon as it's
 * added (compression for images, the size cap for videos — same mechanics as
 * `MediaFieldController`), so by the time the caller submits, `readyAssetIds` is generally
 * already populated; `ensureAllUploaded` is there for the caller to await stragglers.
 */
class MultiMediaFieldController {
	readonly definition: MultiMediaFieldDefinition;
	readonly constraints: ReturnType<typeof describeMediaUploadConstraints>;
	readonly accept: string;
	readonly maxBytes: number;
	readonly maxItems: number;

	items = $state<MultiMediaItem[]>([]);

	private nextKey = 0;
	private destroyed = false;

	constructor(
		private readonly convexClient: ConvexClient,
		fieldName: MultiMediaFieldName,
		options?: { maxItems?: number }
	) {
		this.definition = multiMediaFieldDefinitions[fieldName];
		this.constraints = describeMediaUploadConstraints(this.definition.constraints);
		this.accept = this.constraints.accept;
		this.maxBytes = this.constraints.maxBytes;
		this.maxItems = options?.maxItems ?? 4;
	}

	count = $derived(this.items.length);
	isBusy = $derived(this.items.some((item) => item.phase === 'uploading' || item.phase === 'processing'));
	hasFailures = $derived(this.items.some((item) => item.phase === 'failed'));
	readyAssetIds = $derived(
		this.items
			.filter((item): item is MultiMediaItem & { assetId: Id<'mediaAssets'> } =>
				item.phase === 'ready' && item.assetId !== null
			)
			.map((item) => item.assetId)
	);

	private setItem = (key: number, patch: Partial<MultiMediaItem>) => {
		this.items = this.items.map((item) => (item.key === key ? { ...item, ...patch } : item));
	};

	private uploadItem = async (key: number, file: File) => {
		try {
			this.setItem(key, { phase: 'uploading', errorMessage: '' });

			const mediaKind = getLocalPreviewKind(file);

			// See the single-field controller's identical check above for why this is video-only.
			if (mediaKind === 'video' && file.size > this.maxBytes) {
				this.setItem(key, { phase: 'failed', errorMessage: fileTooLargeMessage(this.maxBytes) });
				return;
			}

			if (mediaKind === 'video' && this.definition.maxDurationSeconds) {
				const durationSeconds = await readLocalMediaDurationSeconds(file);
				if (this.destroyed || !this.items.some((item) => item.key === key)) return;
				if (
					typeof durationSeconds === 'number' &&
					durationSeconds > this.definition.maxDurationSeconds
				) {
					this.setItem(key, { phase: 'failed', errorMessage: t('mediaUpload.videoTooLong') });
					return;
				}
			}

			let uploadFile = file;
			let clientReportedImageCompression = false;
			if (mediaKind === 'image') {
				const compressed = await compressImageFileIfPossible(file);
				if (this.destroyed || !this.items.some((item) => item.key === key)) return;
				if (compressed) {
					uploadFile = compressed;
					clientReportedImageCompression = true;
				}
			}

			const beginResult = await beginMediaUpload(
				this.convexClient,
				uploadFile,
				this.definition.constraints,
				{ clientReportedImageCompression }
			);
			const assetId = beginResult.asset.assetId;

			if (this.destroyed || !this.items.some((item) => item.key === key)) {
				void deleteMediaUpload(this.convexClient, assetId).catch(() => {});
				return;
			}

			this.setItem(key, { assetId });

			await uploadFileToDescriptor(uploadFile, beginResult.upload);

			if (this.destroyed || !this.items.some((item) => item.key === key)) {
				void deleteMediaUpload(this.convexClient, assetId).catch(() => {});
				return;
			}

			this.setItem(key, { phase: 'processing' });
			const finalized = await finalizeMediaUpload(this.convexClient, assetId);

			if (this.destroyed || !this.items.some((item) => item.key === key)) {
				void deleteMediaUpload(this.convexClient, assetId).catch(() => {});
				return;
			}

			if (finalized.status === 'ready') {
				this.setItem(key, { phase: 'ready' });
				return;
			}

			const ready = await waitForMediaUploadReady(this.convexClient, assetId);
			if (this.destroyed || !this.items.some((item) => item.key === key)) {
				void deleteMediaUpload(this.convexClient, assetId).catch(() => {});
				return;
			}
			this.setItem(key, { phase: ready.status === 'ready' ? 'ready' : 'failed' });
		} catch (error) {
			if (!this.items.some((item) => item.key === key)) return;
			captureUnexpectedOperationalError(error, {
				area: 'media',
				operation: 'media:multi-upload',
				identifiers: { key }
			});
			this.setItem(key, { phase: 'failed', errorMessage: normalizeUploadErrorMessage(error) });
		}
	};

	/** Adds files up to the remaining capacity; excess files are silently dropped (the caller's
	 * FileDropZone `maxFiles`/`fileCount` wiring should already prevent over-selection, but this
	 * guards direct callers too). Returns the number of files actually accepted. */
	addFiles = (files: File[]) => {
		const capacity = Math.max(0, this.maxItems - this.items.length);
		const accepted = files.slice(0, capacity);

		const newItems = accepted.map((file) => {
			const key = this.nextKey;
			this.nextKey += 1;
			return {
				key,
				file,
				localPreviewUrl: createLocalPreviewUrl(file) ?? null,
				mediaKind: getLocalPreviewKind(file),
				phase: 'selected' as MultiMediaItemPhase,
				errorMessage: '',
				assetId: null
			};
		});

		this.items = [...this.items, ...newItems];

		for (const item of newItems) {
			void this.uploadItem(item.key, item.file);
		}

		return accepted.length;
	};

	remove = (key: number) => {
		const item = this.items.find((entry) => entry.key === key);
		if (!item) return;
		this.items = this.items.filter((entry) => entry.key !== key);
		revokePreviewUrl(item.localPreviewUrl);
		if (item.assetId) {
			void deleteMediaUpload(this.convexClient, item.assetId).catch(() => {});
		}
	};

	/** Waits for any items still uploading/processing to settle, then returns the ready asset
	 * ids. Throws if any item ended up failed, so callers can block submission on a clear
	 * error rather than silently posting with fewer attachments than the user selected. */
	ensureAllUploaded = async (): Promise<Id<'mediaAssets'>[]> => {
		const pending = this.items.filter(
			(item) => item.phase === 'uploading' || item.phase === 'processing' || item.phase === 'selected'
		);
		if (pending.length) {
			await Promise.all(
				pending.map(async (item) => {
					// uploadItem is already in flight (or about to be) from addFiles; just wait for
					// it to settle by polling the item's phase.
					while (
						this.items.some(
							(entry) =>
								entry.key === item.key &&
								(entry.phase === 'uploading' || entry.phase === 'processing' || entry.phase === 'selected')
						)
					) {
						await new Promise((resolve) => setTimeout(resolve, 100));
					}
				})
			);
		}

		if (this.items.some((item) => item.phase === 'failed')) {
			throw new Error('Some attachments failed to upload.');
		}

		return this.readyAssetIds;
	};

	clear = () => {
		for (const item of this.items) {
			revokePreviewUrl(item.localPreviewUrl);
			if (item.assetId) {
				void deleteMediaUpload(this.convexClient, item.assetId).catch(() => {});
			}
		}
		this.items = [];
	};

	/** Clears local state without deleting the now-attached assets server-side (call after a
	 * successful submission that already persisted the asset ids). */
	reset = () => {
		for (const item of this.items) {
			revokePreviewUrl(item.localPreviewUrl);
		}
		this.items = [];
	};

	destroy = () => {
		this.destroyed = true;
		this.clear();
	};
}

export const createMultiMediaField = (
	convexClient: ConvexClient,
	fieldName: MultiMediaFieldName,
	options?: { maxItems?: number }
) => new MultiMediaFieldController(convexClient, fieldName, options);
