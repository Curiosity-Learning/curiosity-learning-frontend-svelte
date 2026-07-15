<script lang="ts">
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { EmptyState, FeedSearch, LoadingState, UpdateCard } from '$lib/components/app';
	import type { UpdateCardMediaItem } from '$lib/components/app/feed/update-card.svelte';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { routes } from '$lib/routes';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { useConvexClient } from 'convex-svelte';
	import { untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { t } from '$lib/i18n';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const convexClient = useConvexClient();

	type FeedItem = (typeof data)['initialUpdates'][number];
	type SignedAsset = { assetId: string; signedUrl: string; mediaKind?: string | null };

	const firstPage = useStableQuery(api.updates.listForViewer, { limit: 20 });

	let extraItems = $state<FeedItem[]>([]);
	let extraAssetsByAssetId = new SvelteMap<string, SignedAsset>();
	let cursor = $state<number | null>(untrack(() => data.initialCursor ?? null));
	let loadingMore = $state(false);
	let loadMoreError = $state('');

	let initialAssetsByAssetId = $derived.by(() => {
		const map = new SvelteMap<string, SignedAsset>();
		for (const asset of data.initialUpdateAuthorImages ?? []) map.set(asset.assetId, asset);
		for (const asset of data.initialUpdateMedia ?? []) map.set(asset.assetId, asset);
		return map;
	});

	const toCardItem = (item: FeedItem, assetsByAssetId: Map<string, SignedAsset>) => ({
		...item,
		authorImageUrl: item.authorImageMediaAssetId
			? (assetsByAssetId.get(item.authorImageMediaAssetId as Id<'mediaAssets'>)?.signedUrl ?? null)
			: null,
		media: (item.mediaAssetIds ?? []).map((assetId): UpdateCardMediaItem => {
			const asset = assetsByAssetId.get(assetId as Id<'mediaAssets'>) ?? null;
			const isVideo = asset?.mediaKind === 'video';
			return {
				assetId,
				kind: isVideo ? 'video' : 'image',
				url: asset?.signedUrl ?? null
			};
		})
	});

	let visibleUpdates = $derived.by(() => {
		const items = firstPage.data?.items ?? data.initialUpdates ?? [];
		const firstPageCards = items.map((item) => toCardItem(item, initialAssetsByAssetId));
		const extraCards = extraItems.map((item) => toCardItem(item, extraAssetsByAssetId));
		return [...firstPageCards, ...extraCards];
	});

	const loadMore = async () => {
		if (cursor === null || loadingMore) return;
		loadingMore = true;
		loadMoreError = '';
		try {
			const page = await convexClient.query(api.updates.listForViewer, {
				limit: 20,
				cursor
			});
			const assetIds = [
				...page.items
					.map((item) => item.authorImageMediaAssetId)
					.filter((assetId): assetId is Id<'mediaAssets'> => assetId !== null),
				...page.items.flatMap((item) => item.mediaAssetIds)
			];

			let signedAssets: SignedAsset[] = [];
			if (assetIds.length) {
				const response = await fetch('/api/media/refresh', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ assetIds, context: { kind: 'my-clubs-feed' } })
				});
				if (!response.ok) throw new Error('Could not load media for more updates.');
				const body = (await response.json()) as { assets: SignedAsset[] };
				signedAssets = body.assets;
			}

			for (const asset of signedAssets) extraAssetsByAssetId.set(asset.assetId, asset);

			extraItems = [...extraItems, ...page.items];
			cursor = page.nextCursor;
		} catch (error) {
			loadMoreError = error instanceof Error ? error.message : 'Could not load more updates.';
		} finally {
			loadingMore = false;
		}
	};
</script>

<FeedSearch scope="my-clubs">
	{#snippet feed()}
		{@render feedList()}
	{/snippet}
</FeedSearch>

{#snippet feedList()}
<div class="flex flex-col gap-4">
	{#if firstPage.isLoading && visibleUpdates.length === 0}
		<LoadingState label="Loading updates" />
	{:else if firstPage.error && visibleUpdates.length === 0}
		<Alert variant="destructive">
			<AlertTitle>Could not load updates</AlertTitle>
			<AlertDescription>{firstPage.error.message}</AlertDescription>
		</Alert>
	{:else if visibleUpdates.length === 0}
		<EmptyState
			title={t('feed.myClubsEmptyTitle')}
			description={t('feed.myClubsEmptyDescription')}
			class="px-4 py-8"
		/>
	{:else}
		{#each visibleUpdates as item (item.updateId)}
			<UpdateCard
				updateId={item.updateId}
				authorProfileId={item.authorProfileId}
				authorName={item.authorName}
				authorImageUrl={item.authorImageUrl}
				createdAt={item.createdAt}
				content={item.content}
				media={item.media}
				relatedQuestion={item.questionContent ? { label: item.questionContent } : null}
				relatedProject={item.projectName
					? {
							label: item.projectName,
							href: item.projectId ? routes.projectDetail(item.projectId) : undefined,
							navigationState: item.projectId
								? {
										headerTitleHint: item.projectName,
										headerTitleHintPath: `/project/${item.projectId}`
									}
								: undefined
						}
					: null}
				relatedClub={item.clubName && item.clubId
					? {
							label: item.clubName,
							href: routes.clubHome(item.clubId),
							navigationState: {
								headerTitleHint: item.clubName,
								headerTitleHintPath: `/club/${item.clubId}`
							}
						}
					: null}
			/>
		{/each}

		{#if loadMoreError}
			<Alert variant="destructive">
				<AlertDescription>{loadMoreError}</AlertDescription>
			</Alert>
		{/if}

		{#if cursor !== null}
			<Button variant="outline" disabled={loadingMore} onclick={() => void loadMore()}>
				{loadingMore ? t('feed.loadingMore') : t('feed.loadMoreAction')}
			</Button>
		{/if}
	{/if}
</div>
{/snippet}
