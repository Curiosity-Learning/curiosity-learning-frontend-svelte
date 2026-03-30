import { browser } from '$app/environment';
import {
	createSignedMediaManager,
	type MediaRefreshContext,
	type SignedMediaAsset
} from './signed-media.svelte';

class MediaViewController {
	private trackedAssetId = $state<string | null>(null);
	private suppressedGeneration = 0;
	private destroyed = false;
	private readonly manager = createSignedMediaManager();

	constructor(private readonly context: MediaRefreshContext) {}

	asset = $derived(
		this.trackedAssetId ? (this.manager.get(this.trackedAssetId) as SignedMediaAsset | null) : null
	);
	url = $derived(this.asset?.signedUrl ?? null);
	errorMessage = $derived(this.manager.errorMessage);
	isRefreshing = $derived(this.manager.isRefreshing);
	isLoading = $derived(Boolean(this.trackedAssetId) && this.isRefreshing && !this.asset);

	setAssetId = (assetId: string | null | undefined) => {
		const normalizedAssetId = assetId?.trim() || null;
		if (normalizedAssetId === this.trackedAssetId) {
			return;
		}

		this.suppressedGeneration += 1;
		this.trackedAssetId = normalizedAssetId;

		if (!normalizedAssetId) {
			this.manager.clear();
			return;
		}

		if (!browser) {
			return;
		}

		const requestGeneration = this.suppressedGeneration;
		void this.manager.track([normalizedAssetId], this.context).catch(() => {
			// Consumers already get error state from the shared manager.
			if (this.destroyed || requestGeneration !== this.suppressedGeneration) {
				return;
			}
		});
	};

	clear = () => {
		this.suppressedGeneration += 1;
		this.trackedAssetId = null;
		this.manager.clear();
	};

	destroy = () => {
		this.destroyed = true;
		this.suppressedGeneration += 1;
		this.trackedAssetId = null;
		this.manager.destroy();
	};
}

export const createMediaView = (options: { context: MediaRefreshContext }) =>
	new MediaViewController(options.context);
