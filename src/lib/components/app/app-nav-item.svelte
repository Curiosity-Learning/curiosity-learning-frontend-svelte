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
		badgeCount?: number;
		disabled?: boolean;
	};

	let { href, label, active, Icon, nav, badgeCount = 0, disabled }: Props = $props();
	let hasBadge = $derived(badgeCount > 0);
	let badgeLabel = $derived(badgeCount > 99 ? '99+' : String(badgeCount));

	let base = $derived(
		nav === 'bottom'
			? 'flex h-auto w-full flex-col items-center justify-center gap-1 rounded-md px-0 py-2 text-center'
			: nav === 'side'
				? 'flex h-auto w-full items-center justify-start gap-3 rounded-none px-5 py-2 text-left type-lead-medium'
				: 'flex h-auto w-full items-center justify-start gap-2 rounded-none py-2 pr-3 pl-12 text-left type-label'
	);

	let tone = $derived(
		nav === 'bottom'
			? active
				? 'text-orange-500'
				: 'text-muted-foreground hover:text-foreground'
			: nav === 'side'
				? active
					? 'bg-orange-50 text-orange-500'
					: 'text-muted-foreground hover:bg-gray-50 hover:text-foreground'
				: active
					? 'bg-orange-50/70 text-foreground'
					: 'text-muted-foreground hover:bg-gray-50 hover:text-foreground'
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
		<span class="bg-orange-500 absolute inset-y-0 left-0 w-0.5 rounded-r-full" aria-hidden="true"></span>
	{/if}
	{#if nav === 'bottom'}
		<div class="relative">
			{#if Icon}
				<Icon class="size-6" />
			{/if}
			{#if hasBadge}
				<span
					class="absolute -right-2 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] leading-4 font-bold text-white"
					aria-label={`${badgeLabel} unread chats`}
				>
					{badgeLabel}
				</span>
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
		{#if hasBadge}
			<span
				class="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-orange-500 px-1.5 text-[11px] leading-5 font-bold text-white"
				aria-label={`${badgeLabel} unread chats`}
			>
				{badgeLabel}
			</span>
		{/if}
	{:else}
		<span>{label}</span>
	{/if}
</Button>
