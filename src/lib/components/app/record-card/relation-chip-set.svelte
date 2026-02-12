<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';

	type Props = {
		chips: string[];
		tone?: 'accent' | 'muted';
		emptyLabel?: string;
	};

	let { chips, tone = 'accent', emptyLabel }: Props = $props();

	let chipClass = $derived(
		tone === 'muted'
			? 'bg-secondary text-primary'
			: 'bg-accent/60 px-3 py-1 type-sm-bold text-primary'
	);
</script>

{#if chips.length === 0}
	{#if emptyLabel}
		<p class="type-sm text-muted-foreground">{emptyLabel}</p>
	{/if}
{:else}
	<div class="flex flex-wrap gap-2">
		{#each chips as chip (chip)}
			<Badge variant="secondary" class={chipClass}>{chip}</Badge>
		{/each}
	</div>
{/if}
