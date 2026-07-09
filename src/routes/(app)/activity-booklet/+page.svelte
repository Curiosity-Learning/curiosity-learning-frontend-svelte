<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { LoadingState, PageHeaderBackButton, PageHeaderTitle } from '$lib/components/app';
	import BookletActivityCard from '$lib/components/app/sessions/booklet-activity-card.svelte';
	import { routes } from '$lib/routes';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Input } from '$lib/components/ui/input';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { t } from '$lib/i18n';

	const convexClient = useConvexClient();

	let sessionId = $derived((page.url.searchParams.get('session') as Id<'sessions'> | null) ?? null);

	const activitiesResponse = useStableQuery(api.booklet.listActivities, {});
	const blocksResponse = useStableQuery(api.sessions.listBuildingBlocks, {});

	let selectedBlockNames = $state<string[]>([]);
	let searchTerm = $state('');
	let pending = $state(false);
	let errorMessage = $state('');

	let filteredActivities = $derived.by(() => {
		const activities = activitiesResponse.data ?? [];
		const query = searchTerm.trim().toLowerCase();
		return activities.filter((a) => {
			if (
				selectedBlockNames.length > 0 &&
				!selectedBlockNames.every((name) => a.buildingBlockNames.includes(name))
			) {
				return false;
			}
			if (!query) return true;
			return (
				a.name.toLowerCase().includes(query) || (a.content ?? '').toLowerCase().includes(query)
			);
		});
	});

	let fallbackHref = $derived(sessionId ? routes.sessionDetail(sessionId) : routes.feed);

	const buildDetailHref = (activityId: string) => {
		const base = routes.activityBookletDetail(activityId);
		return sessionId ? `${base}?session=${sessionId}` : base;
	};

	const addToSession = async (bookletActivityId: Id<'bookletActivities'>) => {
		if (!sessionId) return;
		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.booklet.addToSession, {
				bookletActivityId,
				sessionId
			});
			await goto(routes.sessionDetail(sessionId), { replaceState: true });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to add activity.';
		} finally {
			pending = false;
		}
	};
</script>

<PageHeaderBackButton {fallbackHref} />
<PageHeaderTitle title="Activity Booklet" />

<div class="flex flex-col gap-4 pb-2 lg:pb-6">
	{#if errorMessage}
		<Alert variant="destructive">
			<AlertTitle>Action failed</AlertTitle>
			<AlertDescription>{errorMessage}</AlertDescription>
		</Alert>
	{/if}

	<Input
		type="search"
		placeholder={t('activityBooklet.searchPlaceholder')}
		bind:value={searchTerm}
		aria-label={t('activityBooklet.searchPlaceholder')}
	/>

	{#if (blocksResponse.data?.length ?? 0) > 0}
		<div class="overflow-x-auto py-2">
			<ToggleGroup.Root
				type="multiple"
				bind:value={selectedBlockNames}
				variant="outline"
				size="sm"
				class="w-max flex-nowrap"
			>
				{#each blocksResponse.data ?? [] as block (block._id)}
					<ToggleGroup.Item value={block.name}>
						{block.name}
					</ToggleGroup.Item>
				{/each}
			</ToggleGroup.Root>
		</div>
	{/if}

	{#if activitiesResponse.isLoading}
		<LoadingState label="Loading activities" />
	{:else if filteredActivities.length === 0}
		<p class="text-sm text-muted-foreground">
			{selectedBlockNames.length || searchTerm.trim()
				? t('activityBooklet.noMatches')
				: t('activityBooklet.empty')}
		</p>
	{:else}
		<div class="flex flex-col gap-4">
			{#each filteredActivities as activity (activity._id)}
				<BookletActivityCard
					{activity}
					href={buildDetailHref(activity._id)}
					{sessionId}
					replaceState={Boolean(sessionId)}
					addPending={pending}
					onAddToSession={() => void addToSession(activity._id)}
				/>
			{/each}
		</div>
	{/if}
</div>
