<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { Card, CardContent, CardDescription, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils.js';

	type Props = {
		title: string;
		description?: string;
		actionLabel?: string;
		href?: string;
		Icon?: Component;
		illustrationSrc?: string;
		illustrationAlt?: string;
		illustrationClass?: string;
		minHeightClass?: string;
		centerContent?: boolean;
		variant?: 'card' | 'plain';
		disabled?: boolean;
		action?: Snippet;
	};

	let {
		title,
		description = '',
		actionLabel,
		href,
		Icon,
		illustrationSrc,
		illustrationAlt = '',
		illustrationClass = 'size-[6.25rem]',
		minHeightClass = 'min-h-56',
		centerContent = false,
		variant = 'card',
		disabled = false,
		action
	}: Props = $props();
</script>

{#snippet content()}
	{#if illustrationSrc}
		<img
			src={illustrationSrc}
			alt={illustrationAlt}
			class={cn('mx-auto object-contain', illustrationClass)}
			loading="lazy"
		/>
	{:else if Icon}
		<div class="flex size-11 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
			<Icon class="size-5" />
		</div>
	{/if}

	<div class={cn('flex flex-col gap-1', centerContent ? 'items-center text-center' : '')}>
		<CardTitle>{title}</CardTitle>
		{#if description}
			<CardDescription>{description}</CardDescription>
		{/if}
	</div>

	{#if action}
		<div class={cn('flex items-center gap-2', centerContent ? 'justify-center' : '')}>
			{@render action()}
		</div>
	{:else if actionLabel}
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
{/snippet}

{#if variant === 'plain'}
	<div
		class={cn(
			'flex flex-col justify-center gap-4 p-2',
			centerContent ? 'items-center text-center' : 'items-start text-left',
			minHeightClass
		)}
	>
		{@render content()}
	</div>
{:else}
	<Card class="gap-0 py-0">
		<CardContent
			class={cn(
				'flex flex-col justify-center gap-4 p-6',
				centerContent ? 'items-center text-center' : 'items-start text-left',
				minHeightClass
			)}
		>
			{@render content()}
		</CardContent>
	</Card>
{/if}
