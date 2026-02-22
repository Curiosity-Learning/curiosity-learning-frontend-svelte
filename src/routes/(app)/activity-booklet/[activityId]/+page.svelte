<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { PageHeaderBackButton, PageHeaderTitle } from '$lib/components/app';
	import { routes } from '$lib/routes';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { TagChip } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import Clock3Icon from '@lucide/svelte/icons/clock-3';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';

	const convexClient = useConvexClient();

	let activityIdParam = $derived(
		(page.params as Record<string, string | undefined>).activityId ?? null
	);
	let activityIdTyped = $derived(
		activityIdParam ? (activityIdParam as Id<'bookletActivities'>) : null
	);
	let sessionId = $derived((page.url.searchParams.get('session') as Id<'sessions'> | null) ?? null);

	const activityResponse = useStableQuery(api.booklet.getActivity, () =>
		activityIdTyped ? { activityId: activityIdTyped } : 'skip'
	);
	let activity = $derived(activityResponse.data ?? null);

	let pending = $state(false);
	let errorMessage = $state('');

	let fallbackHref = $derived.by(() => {
		const base = routes.activityBooklet;
		return sessionId ? `${base}?session=${sessionId}` : base;
	});

	const addToSession = async () => {
		if (!sessionId || !activityIdTyped) return;
		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.booklet.addToSession, {
				bookletActivityId: activityIdTyped,
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
<PageHeaderTitle title={activity?.name ?? 'Activity'} />
{#if !activityIdTyped}
	<Alert variant="destructive">
		<AlertTitle>Invalid activity</AlertTitle>
		<AlertDescription>This activity ID is not valid.</AlertDescription>
	</Alert>
{:else if activityResponse.isLoading}
	<p class="text-sm text-muted-foreground">Loading activity...</p>
{:else if !activity}
	<Alert variant="destructive">
		<AlertTitle>Activity not found</AlertTitle>
		<AlertDescription>The requested booklet activity could not be loaded.</AlertDescription>
	</Alert>
{:else}
	<div class="flex flex-col gap-4 pb-2 lg:pb-6">
		{#if errorMessage}
			<Alert variant="destructive">
				<AlertTitle>Action failed</AlertTitle>
				<AlertDescription>{errorMessage}</AlertDescription>
			</Alert>
		{/if}

		{#if activity.content}
			<p class="type-lead whitespace-pre-wrap text-muted-foreground">{activity.content}</p>
		{:else}
			<p class="text-sm text-muted-foreground">No description available.</p>
		{/if}

		<div class="flex flex-wrap gap-2">
			{#if activity.minutes}
				<TagChip label={`${activity.minutes} mins`} tone="muted">
					{#snippet leading()}
						<Clock3Icon class="size-3.5" />
					{/snippet}
				</TagChip>
			{/if}
			{#each activity.buildingBlockNames as blockName (blockName)}
				<TagChip label={blockName} tone="accent" />
			{/each}
		</div>

		{#if sessionId}
			<div
				class="pointer-events-none sticky bottom-[calc(var(--bottom-nav-h,0rem)+1rem)] flex justify-center lg:bottom-8"
			>
				<Button
					class="pointer-events-auto rounded-full px-6 py-3 shadow-md"
					disabled={pending}
					onclick={() => void addToSession()}
				>
					<PlusIcon class="size-5" />
					Add to session
				</Button>
			</div>
		{/if}
	</div>
{/if}
