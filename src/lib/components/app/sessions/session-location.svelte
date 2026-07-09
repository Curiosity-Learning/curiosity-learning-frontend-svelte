<script lang="ts">
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import { linkifySegments } from '$lib/domain/linkify';

	type Props = {
		location: string;
		class?: string;
	};

	let { location, class: className }: Props = $props();

	let segments = $derived(linkifySegments(location));
</script>

<div class={`flex items-start gap-2 text-sm text-muted-foreground ${className ?? ''}`}>
	<MapPinIcon class="mt-0.5 size-4 shrink-0 text-orange-500" strokeWidth={2.5} />
	<p class="break-words">
		{#each segments as segment, index (index)}
			{#if segment.type === 'url'}
				<a
					href={segment.value}
					target="_blank"
					rel="noopener noreferrer"
					class="text-orange-600 underline underline-offset-2 hover:text-orange-700"
				>
					{segment.value}
				</a>
			{:else}
				{segment.value}
			{/if}
		{/each}
	</p>
</div>
