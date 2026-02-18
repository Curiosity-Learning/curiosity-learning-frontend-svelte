<script lang="ts">
	import { TagChip } from '$lib/components/ui/badge';

	type Props = {
		chips: string[];
		tone?: 'accent' | 'muted';
		emptyLabel?: string;
	};

	let { chips, tone = 'accent', emptyLabel }: Props = $props();

</script>

{#if chips.length === 0}
	{#if emptyLabel}
		<p class="type-sm text-muted-foreground">{emptyLabel}</p>
	{/if}
{:else}
	<div class="flex flex-wrap gap-2">
		{#each chips as chip (chip)}
			<TagChip label={chip} {tone} />
		{/each}
	</div>
{/if}
