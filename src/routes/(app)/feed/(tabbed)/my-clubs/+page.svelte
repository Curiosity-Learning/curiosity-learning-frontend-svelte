<script lang="ts">
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { LoadingState, UpdateCard } from '$lib/components/app';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { routes } from '$lib/routes';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const updates = useStableQuery(api.updates.listForViewer, { limit: 50 });

	let initialAuthorImageUrls = $derived.by(() => {
		return new Map(
			(data.initialUpdateAuthorImages ?? []).map((asset) => [asset.assetId, asset.signedUrl] as const)
		);
	});

	let visibleUpdates = $derived.by(() => {
		const items = updates.data ?? data.initialUpdates ?? [];
		return items.map((item) => ({
			...item,
			authorImageUrl: item.authorImageMediaAssetId
				? (initialAuthorImageUrls.get(item.authorImageMediaAssetId as Id<'mediaAssets'>) ?? null)
				: null
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
		<p>No updates yet.</p>
	{:else}
		{#each visibleUpdates as item (item.updateId)}
			<UpdateCard
				authorName={item.authorName}
				authorImageUrl={item.authorImageUrl}
				createdAt={item.createdAt}
				content={item.content}
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
			/>
		{/each}
	{/if}
</div>
