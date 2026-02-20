<script lang="ts">
	import type { Snippet } from 'svelte';
	import { CardTitle } from '$lib/components/ui/card';

	type Props = {
		title?: string;
		href?: string;
		primary?: Snippet;
		leading?: Snippet;
		actions?: Snippet;
		meta?: Snippet;
		showMeta?: boolean;
	};

	let { title, href, primary, leading, actions, meta, showMeta = true }: Props = $props();
</script>

<div class="flex w-full flex-col gap-2">
	<div class="flex w-full items-center justify-between gap-3">
		{#if href}
			<a
				href={href}
				class="flex min-w-0 flex-1 items-center gap-3"
				data-sveltekit-preload-code="hover"
				data-sveltekit-preload-data="hover"
			>
				{#if leading}
					<div class="flex shrink-0 items-center">
						{@render leading()}
					</div>
				{/if}
				{#if primary}
					{@render primary()}
				{:else if title}
					<CardTitle class="truncate type-body-bold text-foreground">{title}</CardTitle>
				{/if}
			</a>
		{:else}
			<div class="flex min-w-0 flex-1 items-center gap-3">
				{#if leading}
					<div class="flex shrink-0 items-center">
						{@render leading()}
					</div>
				{/if}
				{#if primary}
					{@render primary()}
				{:else if title}
					<CardTitle class="truncate type-body-bold text-foreground">{title}</CardTitle>
				{/if}
			</div>
		{/if}

		{#if actions}
			<div class="shrink-0">
				{@render actions()}
			</div>
		{/if}
	</div>

	{#if meta && showMeta}
		<div class="flex flex-wrap gap-2">
			{@render meta()}
		</div>
	{/if}
</div>
