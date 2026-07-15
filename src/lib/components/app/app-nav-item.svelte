<script lang="ts">
	import type { Component } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils.js';

	export type AppNavVariant = 'bottom' | 'side' | 'side-sub';

	type Props = {
		href: string;
		label: string;
		active: boolean;
		Icon?: Component<{ class?: string }>;
		nav: AppNavVariant;
		disabled?: boolean;
	};

	let { href, label, active, Icon, nav, disabled }: Props = $props();

	let base = $derived(
		nav === 'bottom'
			? 'flex h-auto w-full flex-col items-center justify-center gap-1 rounded-md px-0 py-2 text-center'
			: nav === 'side'
				? 'flex h-auto w-full items-center justify-start gap-3 rounded-none px-5 py-2 text-left !text-[1.03rem] !leading-6 !font-medium'
				: 'flex h-auto w-full items-center justify-start gap-2 rounded-none py-2 pr-3 pl-12 text-left !text-[0.94rem] !leading-5 !font-medium'
	);

	let tone = $derived(
		nav === 'bottom'
			? active
				? 'text-orange-500'
				: 'text-muted-foreground hover:text-foreground'
			: nav === 'side'
				? active
					? 'bg-[#f8ecdf] text-orange-500'
					: 'text-[#5e637a] hover:bg-gray-100 hover:text-[#44495f]'
				: active
					? 'bg-[#f8ecdf] text-orange-500'
					: 'text-[#6d7286] hover:bg-gray-100 hover:text-gray-700'
	);
</script>

<Button
	href={disabled ? undefined : href}
	aria-disabled={disabled}
	role={disabled ? 'link' : undefined}
	tabindex={disabled ? -1 : undefined}
	variant="ghost"
	class={cn(base, tone, 'relative justify-self-stretch overflow-hidden')}
	data-sveltekit-preload-code="hover"
	data-sveltekit-preload-data="hover"
>
	{#if active && nav !== 'bottom'}
		<span class="absolute inset-y-0 left-0 w-1 rounded-r-sm bg-orange-500" aria-hidden="true"
		></span>
	{/if}
	{#if nav === 'bottom'}
		<div class="relative">
			{#if Icon}
				<Icon class="size-6" />
			{/if}
		</div>
		<span class="type-caption-medium">{label}</span>
	{:else if nav === 'side'}
		<div class="flex min-w-0 flex-1 items-center gap-3">
			{#if Icon}
				<Icon class="size-4 shrink-0" />
			{/if}
			<span class="truncate">{label}</span>
		</div>
	{:else}
		<span>{label}</span>
	{/if}
</Button>
