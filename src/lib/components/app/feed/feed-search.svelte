<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import SearchIcon from '@lucide/svelte/icons/search';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import LoadingState from '../loading-state.svelte';
	import UpdateCard from './update-card.svelte';
	import type { UpdateCardMediaItem } from './update-card.svelte';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { routes } from '$lib/routes';
	import { t } from '$lib/i18n';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { SvelteMap } from 'svelte/reactivity';

	type SignedAsset = { assetId: string; signedUrl: string; mediaKind?: string | null };

	type Props = {
		/** Which feed tab this search is scoped to (PRD 6.16). */
		scope: 'global' | 'my-clubs';
		/** The regular paginated feed, rendered whenever no search term is active. */
		feed: Snippet;
	};

	let { scope, feed }: Props = $props();

	const SEARCH_DEBOUNCE_MS = 300;

	let searchInput = $state('');
	let debouncedTerm = $state('');

	$effect(() => {
		const nextTerm = searchInput.trim();
		if (nextTerm === debouncedTerm) return;
		const handle = setTimeout(() => {
			debouncedTerm = nextTerm;
		}, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(handle);
	});

	// `scope` is fixed per page instance (each feed tab is its own page), so the query
	// reference and input id are intentionally resolved once at mount.
	const initialScope = untrack(() => scope);
	const searchQuery =
		initialScope === 'global' ? api.updates.searchGlobalFeed : api.updates.searchMyClubsFeed;
	const searchResponse = useStableQuery(searchQuery, () =>
		debouncedTerm ? { term: debouncedTerm } : 'skip'
	);

	let isSearching = $derived(Boolean(searchInput.trim()));
	let resultUpdates = $derived(searchResponse.data?.updates ?? []);
	let resultProjects = $derived(searchResponse.data?.projects ?? []);
	let hasResults = $derived(resultUpdates.length + resultProjects.length > 0);

	// Signed media for matched updates. The 'global-feed' refresh context re-verifies
	// `canViewProject` per update server-side, which is exactly the gate both search queries
	// applied, so it is safe for the my-clubs scope too.
	let signedAssetsByAssetId = new SvelteMap<string, SignedAsset>();
	let signedForKey = '';

	$effect(() => {
		const updates = searchResponse.data?.updates ?? [];
		const key = updates.map((item) => item.updateId).join(',');
		if (!key || key === signedForKey) return;
		signedForKey = key;

		const updateIds = updates.map((item) => item.updateId);
		const assetIds = [
			...updates
				.map((item) => item.authorImageMediaAssetId)
				.filter((assetId): assetId is Id<'mediaAssets'> => assetId !== null),
			...updates.flatMap((item) => item.mediaAssetIds)
		].filter((assetId) => !signedAssetsByAssetId.has(assetId));
		if (!assetIds.length) return;

		void (async () => {
			try {
				const response = await fetch('/api/media/refresh', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ assetIds, context: { kind: 'global-feed', updateIds } })
				});
				if (!response.ok) return;
				const body = (await response.json()) as { assets: SignedAsset[] };
				for (const asset of body.assets) signedAssetsByAssetId.set(asset.assetId, asset);
			} catch {
				// Media stays unsigned; cards render without images.
			}
		})();
	});

	let resultUpdateCards = $derived(
		resultUpdates.map((item) => ({
			...item,
			authorImageUrl: item.authorImageMediaAssetId
				? (signedAssetsByAssetId.get(item.authorImageMediaAssetId)?.signedUrl ?? null)
				: null,
			media: (item.mediaAssetIds ?? []).map((assetId): UpdateCardMediaItem => {
				const asset = signedAssetsByAssetId.get(assetId) ?? null;
				return {
					assetId,
					kind: asset?.mediaKind === 'video' ? 'video' : 'image',
					url: asset?.signedUrl ?? null
				};
			})
		}))
	);

	const searchInputId = `feed-search-${initialScope}`;

	const dueDateLabel = (dueDate: number) =>
		new Date(dueDate).toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-col gap-2">
		<Label for={searchInputId} class="sr-only">{t('feed.searchLabel')}</Label>
		<div class="relative">
			<SearchIcon
				class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				id={searchInputId}
				type="search"
				bind:value={searchInput}
				placeholder={t('feed.searchPlaceholder')}
				aria-label={t('feed.searchLabel')}
				class="pl-9"
			/>
		</div>
	</div>

	{#if !isSearching}
		{@render feed()}
	{:else if searchResponse.isLoading || searchInput.trim() !== debouncedTerm}
		<LoadingState label={t('feed.searching')} />
	{:else if searchResponse.error}
		<Alert variant="destructive">
			<AlertTitle>{t('feed.searchFailed')}</AlertTitle>
			<AlertDescription>{searchResponse.error.message}</AlertDescription>
		</Alert>
	{:else if !hasResults}
		<div class="rounded-2xl border border-dashed border-border/80 bg-card px-4 py-8 text-center">
			<p class="type-body-bold text-foreground">{t('feed.searchNoResultsTitle')}</p>
			<p class="type-sm mt-1 text-muted-foreground">{t('feed.searchNoResultsDescription')}</p>
		</div>
	{:else}
		{#if resultProjects.length > 0}
			<section class="flex flex-col gap-3">
				<h2 class="type-h5 px-1 text-foreground">{t('feed.searchProjectsHeading')}</h2>
				<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
					{#each resultProjects as project (project.projectId)}
						<a
							href={routes.projectDetail(project.projectId)}
							class="group flex items-start gap-3 rounded-2xl border border-border/60 bg-card p-4 transition-colors hover:border-border"
							data-sveltekit-preload-code="hover"
						>
							<div
								class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-500"
							>
								<FolderIcon class="size-5" />
							</div>
							<div class="flex min-w-0 flex-1 flex-col gap-0.5">
								<p class="truncate type-body-bold text-foreground group-hover:underline">
									{project.name}
								</p>
								{#if project.description}
									<p class="line-clamp-2 type-sm text-muted-foreground">{project.description}</p>
								{/if}
								<p class="type-caption text-muted-foreground">{dueDateLabel(project.dueDate)}</p>
							</div>
						</a>
					{/each}
				</div>
			</section>
		{/if}

		{#if resultUpdateCards.length > 0}
			<section class="flex flex-col gap-3">
				<h2 class="type-h5 px-1 text-foreground">{t('feed.searchUpdatesHeading')}</h2>
				<div class="flex flex-col gap-4">
					{#each resultUpdateCards as item (item.updateId)}
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
										href: item.projectId ? routes.projectDetail(item.projectId) : undefined
									}
								: null}
							relatedClub={item.clubName && item.clubId
								? { label: item.clubName, href: routes.clubHome(item.clubId) }
								: null}
						/>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>
