<script lang="ts">
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { LoadingState, UpdateCard } from '$lib/components/app';
	import type { UpdateCardMediaItem } from '$lib/components/app/feed/update-card.svelte';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { routes } from '$lib/routes';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { t } from '$lib/i18n';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const updates = useStableQuery(api.updates.listForViewer, { limit: 50 });

	let initialAuthorImageUrls = $derived.by(() => {
		return new Map(
			(data.initialUpdateAuthorImages ?? []).map((asset) => [asset.assetId, asset.signedUrl] as const)
		);
	});

	let initialUpdateMediaById = $derived.by(() => {
		return new Map((data.initialUpdateMedia ?? []).map((asset) => [asset.assetId, asset] as const));
	});

	let visibleUpdates = $derived.by(() => {
		const items = updates.data ?? data.initialUpdates ?? [];
		return items.map((item) => ({
			...item,
			authorImageUrl: item.authorImageMediaAssetId
				? (initialAuthorImageUrls.get(item.authorImageMediaAssetId as Id<'mediaAssets'>) ?? null)
				: null,
			media: (item.mediaAssetIds ?? []).map((assetId): UpdateCardMediaItem => {
				const asset = initialUpdateMediaById.get(assetId as Id<'mediaAssets'>) ?? null;
				const isVideo = asset?.mediaKind === 'video' || asset?.contentType?.startsWith('video/');
				return {
					assetId,
					kind: isVideo ? 'video' : 'image',
					url: asset?.signedUrl ?? null
				};
			})
		}));
	});
</script>

<div class="flex flex-col gap-4">
	{#if updates.isLoading && visibleUpdates.length === 0}
		<LoadingState label="Loading updates" />
	{:else if updates.error && visibleUpdates.length === 0}
		<Alert variant="destructive">
			<AlertTitle>Could not load updates</AlertTitle>
			<AlertDescription>{updates.error.message}</AlertDescription>
		</Alert>
	{:else if visibleUpdates.length === 0}
		<div class="rounded-2xl border border-dashed border-border/80 bg-card px-4 py-8 text-center">
			<p class="type-body-bold text-foreground">{t('feed.myClubsEmptyTitle')}</p>
			<p class="type-sm mt-1 text-muted-foreground">{t('feed.myClubsEmptyDescription')}</p>
		</div>
	{:else}
		{#each visibleUpdates as item (item.updateId)}
			<UpdateCard
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
				relatedClub={item.clubName
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
	{/if}
</div>
