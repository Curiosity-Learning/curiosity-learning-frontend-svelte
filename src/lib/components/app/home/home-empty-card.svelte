<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { Card, CardContent, CardDescription, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils.js';

	type Props = {
		title: string;
		description: string;
		actionLabel: string;
		href?: string;
		Icon?: Component;
		minHeightClass?: string;
		disabled?: boolean;
		action?: Snippet;
	};

	let {
		title,
		description,
		actionLabel,
		href,
		Icon,
		minHeightClass = 'min-h-56',
		disabled = false,
		action
	}: Props = $props();
</script>

<Card class="gap-0 py-0">
	<CardContent class={cn('flex flex-col justify-center gap-4 p-6', minHeightClass)}>
		{#if Icon}
			<div class="flex size-11 items-center justify-center rounded-xl bg-accent text-primary">
				<Icon class="size-5" />
			</div>
		{/if}

		<div class="flex flex-col gap-1">
			<CardTitle>{title}</CardTitle>
			<CardDescription>{description}</CardDescription>
		</div>

		{#if action}
			<div class="flex items-center gap-2">
				{@render action()}
			</div>
		{:else}
			<Button
				href={href}
				variant="outline"
				class="w-fit"
				{disabled}
				data-sveltekit-preload-code={disabled ? undefined : 'hover'}
				data-sveltekit-preload-data={disabled ? undefined : 'hover'}
			>
				{actionLabel}
			</Button>
		{/if}
	</CardContent>
</Card>
