<script lang="ts">
	import { cn } from '$lib/utils.js';

	export type RelationListItem = {
		id: string;
		title: string;
		description?: string | null;
		href?: string;
	};

	type Props = {
		items: RelationListItem[];
		fallbackDescription?: string;
		itemClass?: string;
	};

	let {
		items,
		fallbackDescription = 'No details yet.',
		itemClass: itemClassName
	}: Props = $props();

	let cardItemClass = $derived(cn('flex flex-col gap-2 rounded-xl bg-muted/50 p-4', itemClassName));
</script>

<div class="flex flex-col gap-3">
	{#each items as item (item.id)}
		{#if item.href}
			<a
				href={item.href}
				class={cardItemClass}
				data-sveltekit-preload-code="hover"
				data-sveltekit-preload-data="hover"
			>
				<p class="type-h5-bold text-foreground">{item.title}</p>
				<p class="line-clamp-2 type-lead text-slate-500">
					{item.description ?? fallbackDescription}
				</p>
			</a>
		{:else}
			<div class={cardItemClass}>
				<p class="type-h5-bold text-foreground">{item.title}</p>
				<p class="line-clamp-2 type-lead text-slate-500">
					{item.description ?? fallbackDescription}
				</p>
			</div>
		{/if}
	{/each}
</div>
