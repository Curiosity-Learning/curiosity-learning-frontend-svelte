<script lang="ts">
	import Clock3Icon from '@lucide/svelte/icons/clock-3';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent } from '$lib/components/ui/card';

	type Activity = {
		_id: string;
		name: string;
		content: string | null;
		minutes: number | null;
		buildingBlockNames: string[];
	};

	type Props = {
		activity: Activity;
		href: string;
		sessionId?: string | null;
		replaceState?: boolean;
		onAddToSession?: () => void;
		addPending?: boolean;
	};

	let {
		activity,
		href,
		sessionId = null,
		replaceState = false,
		onAddToSession,
		addPending = false
	}: Props = $props();
</script>

<Card {href} {replaceState} class="gap-0 py-0">
	<CardContent class="flex flex-col gap-3 p-4">
		<div class="flex items-start justify-between gap-3">
			<h3 class="type-h5-medium">{activity.name}</h3>
			{#if sessionId && onAddToSession}
				<Button
					variant="ghost"
					size="icon"
					aria-label="Add to session"
					disabled={addPending}
					onclick={() => onAddToSession?.()}
				>
					<PlusIcon class="size-5" />
				</Button>
			{/if}
		</div>
		<p class="line-clamp-5 text-muted-foreground">
			{activity.content ?? 'No description available.'}
		</p>
		<div class="flex flex-wrap gap-2">
			{#if activity.minutes}
				<Badge variant="secondary">
					<Clock3Icon class="size-3.5" />
					{activity.minutes} mins
				</Badge>
			{/if}
			{#each activity.buildingBlockNames as blockName (blockName)}
				<Badge variant="secondary">
					{blockName}
				</Badge>
			{/each}
		</div>
	</CardContent>
</Card>
