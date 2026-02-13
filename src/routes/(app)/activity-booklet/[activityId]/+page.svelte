<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import {
		PageHeaderActions,
		PageHeaderBackButton,
		PageHeaderTitle
	} from '$lib/components/app';
	import { routes } from '$lib/routes';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import Clock3Icon from '@lucide/svelte/icons/clock-3';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { useConvexClient, useQuery } from 'convex-svelte';

	const convexClient = useConvexClient();

	let activityIdParam = $derived(
		(page.params as Record<string, string | undefined>).activityId ?? null
	);
	let activityIdTyped = $derived(
		activityIdParam ? (activityIdParam as Id<'bookletActivities'>) : null
	);
	let sessionId = $derived(
		(page.url.searchParams.get('session') as Id<'sessions'> | null) ?? null
	);

	const activityResponse = useQuery(api.booklet.getActivity, () =>
		activityIdTyped ? { activityId: activityIdTyped } : 'skip'
	);
	let activity = $derived(activityResponse.data ?? null);

	let pending = $state(false);
	let errorMessage = $state('');

	let fallbackHref = $derived(() => {
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
			await goto(routes.sessionDetail(sessionId) + '/activities');
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to add activity.';
		} finally {
			pending = false;
		}
	};
</script>

<PageHeaderBackButton fallbackHref={fallbackHref()} />
<PageHeaderTitle title={activity?.name ?? 'Activity'} />
{#if sessionId}
	<PageHeaderActions>
		<Button
			variant="ghost"
			size="icon"
			aria-label="Add to session"
			disabled={pending}
			onclick={() => void addToSession()}
		>
			<PlusIcon class="size-5 text-muted-foreground" />
		</Button>
	</PageHeaderActions>
{/if}

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
			<p class="type-lead text-muted-foreground whitespace-pre-wrap">{activity.content}</p>
		{:else}
			<p class="text-sm text-muted-foreground">No description available.</p>
		{/if}

		<div class="flex flex-wrap gap-2">
			{#if activity.minutes}
				<Badge variant="secondary" class="bg-secondary text-primary">
					<Clock3Icon class="size-3.5" />
					{activity.minutes} mins
				</Badge>
			{/if}
			{#each activity.buildingBlockNames as blockName (blockName)}
				<Badge variant="secondary" class="bg-accent/70 text-primary">
					{blockName}
				</Badge>
			{/each}
		</div>
	</div>
{/if}
