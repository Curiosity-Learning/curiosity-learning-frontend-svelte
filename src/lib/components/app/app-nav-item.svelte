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
				? 'flex h-auto w-full items-center justify-start gap-3 rounded-md px-3 py-2 text-left type-lead-medium'
				: 'flex h-auto w-full items-center justify-start gap-2 rounded-md pr-3 pl-10 py-2 text-left type-label'
	);

	let tone = $derived(
		nav === 'bottom'
			? active
				? 'bg-primary/10 text-primary'
				: 'text-muted-foreground hover:text-foreground'
			: nav === 'side'
				? active
					? 'bg-primary/10 text-primary'
					: 'text-muted-foreground hover:bg-accent hover:text-foreground'
				: active
					? 'bg-accent text-foreground'
					: 'text-muted-foreground hover:bg-accent hover:text-foreground'
	);
</script>

<Button
	href={disabled ? undefined : href}
	aria-disabled={disabled}
	role={disabled ? 'link' : undefined}
	tabindex={disabled ? -1 : undefined}
	variant="ghost"
	class={cn(base, tone, 'justify-self-stretch')}
	data-sveltekit-preload-code="hover"
	data-sveltekit-preload-data="hover"
>
	{#if nav === 'bottom'}
		{#if Icon}
			<Icon class="size-6" />
		{/if}
		<span class="type-caption-medium">{label}</span>
	{:else if nav === 'side'}
		{#if Icon}
			<Icon class="size-4 shrink-0" />
		{/if}
		<span>{label}</span>
	{:else}
		<span>{label}</span>
	{/if}
</Button>
