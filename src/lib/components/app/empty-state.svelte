<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils.js';

	type Props = {
		icon?: Component<{ class?: string }>;
		title: string;
		description?: string;
		actionLabel?: string;
		onAction?: () => void;
		actionHref?: string;
		class?: string;
		// Set to false to omit the dashed-card wrapper (e.g. when already nested inside a Card).
		bordered?: boolean;
		// Custom action content (e.g. a dialog trigger) — overrides actionLabel/onAction/actionHref.
		children?: Snippet;
	};

	let {
		icon: Icon,
		title,
		description,
		actionLabel,
		onAction,
		actionHref,
		class: className,
		bordered = true,
		children
	}: Props = $props();
</script>

{#snippet content()}
	{#if Icon}
		<div class="flex size-11 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
			<Icon class="size-5" />
		</div>
	{/if}
	<div class="flex flex-col gap-1">
		<p class="type-body-bold text-foreground">{title}</p>
		{#if description}
			<p class="type-sm text-muted-foreground">{description}</p>
		{/if}
	</div>
	{#if children}
		{@render children()}
	{:else if actionHref}
		<Button href={actionHref} variant="outline" class="w-fit">{actionLabel}</Button>
	{:else if onAction}
		<Button variant="outline" class="w-fit" onclick={onAction}>{actionLabel}</Button>
	{/if}
{/snippet}

{#if bordered}
	<div
		class={cn(
			'flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/80 bg-card p-8 text-center',
			className
		)}
	>
		{@render content()}
	</div>
{:else}
	<div class={cn('flex flex-col items-center gap-3 text-center', className)}>
		{@render content()}
	</div>
{/if}
