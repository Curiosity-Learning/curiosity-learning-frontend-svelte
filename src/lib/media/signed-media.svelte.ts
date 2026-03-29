import { browser } from '$app/environment';

export type MediaRefreshContext =
	| {
			kind: 'owned';
	  }
	| {
			kind: 'project';
			projectId: string;
	  };

export type SignedMediaAsset = {
	assetId: string;
	mediaKind: string | null;
	contentType: string | null;
	durationSeconds: number | null;
	signedUrl: string;
	expiresAt: number;
};

const REFRESH_BUFFER_SECONDS = 60;

const dedupeAssetIds = (assetIds: string[]) => [...new Set(assetIds.filter(Boolean))];

const sameContext = (left: MediaRefreshContext | null, right: MediaRefreshContext | null) => {
	if (!left || !right || left.kind !== right.kind) {
		return false;
	}

	if (left.kind === 'owned') {
		return true;
	}

	if (right.kind !== 'project') {
		return false;
	}

	return left.projectId === right.projectId;
};

const normalizeError = async (response: Response) => {
	const text = (await response.text()).trim();
	return text || `Media refresh failed with ${response.status}`;
};

export const requestSignedMediaUrls = async (
	input: {
		assetIds: string[];
		context: MediaRefreshContext;
	},
	fetcher: typeof fetch = fetch
) => {
	const response = await fetcher('/api/media/refresh', {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			assetIds: dedupeAssetIds(input.assetIds),
			context: input.context
		})
	});

	if (!response.ok) {
		throw new Error(await normalizeError(response));
	}

	const payload = (await response.json()) as {
		assets: SignedMediaAsset[];
	};
	return payload.assets;
};

export const createSignedMediaManager = (fetcher: typeof fetch = fetch) => {
	let assetsById = $state<Record<string, SignedMediaAsset>>({});
	let isRefreshing = $state(false);
	let errorMessage = $state<string | null>(null);
	let trackedAssetIds = $state.raw<string[]>([]);
	let trackedContext = $state<MediaRefreshContext | null>(null);
	let refreshTimer: ReturnType<typeof setTimeout> | null = null;
	let refreshGeneration = 0;
	let activeRefreshCount = 0;

	const clearTimer = () => {
		if (refreshTimer !== null) {
			clearTimeout(refreshTimer);
			refreshTimer = null;
		}
	};

	const clear = () => {
		clearTimer();
		refreshGeneration += 1;
		trackedAssetIds = [];
		trackedContext = null;
		assetsById = {};
		errorMessage = null;
		isRefreshing = activeRefreshCount > 0;
	};

	const scheduleRefresh = () => {
		clearTimer();
		if (!browser || !trackedAssetIds.length || !trackedContext) {
			return;
		}

		const expirationTimes = trackedAssetIds
			.map((assetId) => assetsById[assetId]?.expiresAt ?? null)
			.filter((expiresAt): expiresAt is number => typeof expiresAt === 'number');
		if (!expirationTimes.length) {
			return;
		}

		const earliestExpiry = Math.min(...expirationTimes);
		const now = Math.floor(Date.now() / 1000);
		const delayMs = Math.max((earliestExpiry - now - REFRESH_BUFFER_SECONDS) * 1000, 1000);

		refreshTimer = setTimeout(() => {
			if (!trackedContext || !trackedAssetIds.length) {
				return;
			}

			void refresh(trackedAssetIds, trackedContext);
		}, delayMs);
	};

	const refresh = async (assetIds: string[], context: MediaRefreshContext) => {
		const uniqueAssetIds = dedupeAssetIds(assetIds);
		if (!uniqueAssetIds.length) {
			clear();
			return [];
		}

		const requestGeneration = ++refreshGeneration;
		activeRefreshCount += 1;
		isRefreshing = true;
		errorMessage = null;

		try {
			const assets = await requestSignedMediaUrls(
				{
					assetIds: uniqueAssetIds,
					context
				},
				fetcher
			);

			const nextAssets: Record<string, SignedMediaAsset> = {};
			for (const asset of assets) {
				nextAssets[asset.assetId] = asset;
			}

			if (requestGeneration === refreshGeneration) {
				assetsById = nextAssets;
				scheduleRefresh();
			}
			return assets;
		} catch (error) {
			if (requestGeneration === refreshGeneration) {
				errorMessage = error instanceof Error ? error.message : 'Unable to refresh media.';
				scheduleRefresh();
			}
			throw error;
		} finally {
			activeRefreshCount = Math.max(0, activeRefreshCount - 1);
			isRefreshing = activeRefreshCount > 0;
		}
	};

	const track = async (assetIds: string[], context: MediaRefreshContext) => {
		const uniqueAssetIds = dedupeAssetIds(assetIds);
		const assetIdsChanged =
			uniqueAssetIds.length !== trackedAssetIds.length ||
			uniqueAssetIds.some((assetId, index) => trackedAssetIds[index] !== assetId);
		const contextChanged = !sameContext(trackedContext, context);
		const now = Math.floor(Date.now() / 1000);
		const needsRefresh = uniqueAssetIds.some((assetId) => {
			const asset = assetsById[assetId];
			return !asset || asset.expiresAt - REFRESH_BUFFER_SECONDS <= now;
		});

		trackedAssetIds = uniqueAssetIds;
		trackedContext = context;

		if (!uniqueAssetIds.length) {
			clear();
			return [];
		}

		if (!assetIdsChanged && !contextChanged && !needsRefresh) {
			scheduleRefresh();
			return uniqueAssetIds
				.map((assetId) => assetsById[assetId] ?? null)
				.filter((asset): asset is SignedMediaAsset => Boolean(asset));
		}

		return await refresh(uniqueAssetIds, context);
	};

	return {
		get isRefreshing() {
			return isRefreshing;
		},
		get errorMessage() {
			return errorMessage;
		},
		get(assetId: string) {
			return assetsById[assetId] ?? null;
		},
		getUrl(assetId: string) {
			return assetsById[assetId]?.signedUrl ?? null;
		},
		track,
		refresh,
		clear,
		destroy() {
			clearTimer();
		}
	};
};
