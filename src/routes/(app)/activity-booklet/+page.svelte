<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import {
		PageHeaderBackButton,
		PageHeaderTitle
	} from '$lib/components/app';
	import BookletActivityCard from '$lib/components/app/sessions/booklet-activity-card.svelte';
	import { routes } from '$lib/routes';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import { useConvexClient, useQuery } from 'convex-svelte';

	const convexClient = useConvexClient();

	let sessionId = $derived(
		(page.url.searchParams.get('session') as Id<'sessions'> | null) ?? null
	);

	const activitiesResponse = useQuery(api.booklet.listActivities, {});
	const blocksResponse = useQuery(api.sessions.listBuildingBlocks, {});

	let selectedBlockNames = $state<string[]>([]);
	let pending = $state(false);
	let errorMessage = $state('');

	let filteredActivities = $derived.by(() => {
		const activities = activitiesResponse.data ?? [];
		if (selectedBlockNames.length === 0) return activities;
		return activities.filter((a) =>
			selectedBlockNames.every((name) => a.buildingBlockNames.includes(name))
		);
	});

	let fallbackHref = $derived(
		sessionId ? routes.sessionDetail(sessionId) + '/activities' : routes.feed
	);

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
			await goto(routes.sessionDetail(sessionId) + '/activities', { replaceState: true });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to add activity.';
		} finally {
			pending = false;
		}
	};
</script>

<PageHeaderBackButton fallbackHref={fallbackHref} />
<PageHeaderTitle title="Activity Booklet" />

<div class="flex flex-col gap-4 pb-2 lg:pb-6">
	{#if errorMessage}
		<Alert variant="destructive">
			<AlertTitle>Action failed</AlertTitle>
			<AlertDescription>{errorMessage}</AlertDescription>
		</Alert>
	{/if}

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
		<p class="text-sm text-muted-foreground">Loading activities...</p>
	{:else if filteredActivities.length === 0}
		<p class="text-sm text-muted-foreground">
			{selectedBlockNames.length
				? 'No activities match the selected filters.'
				: 'No booklet activities yet.'}
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
