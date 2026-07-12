<script lang="ts">
	import type { Component } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils.js';

	type Props = {
		href: string;
		label: string;
		Icon?: Component<{ class?: string }>;
		tone?: 'primary' | 'muted';
	};

	let { href, label, Icon, tone = 'primary' }: Props = $props();
</script>

<Button
	href={href}
	variant="link"
	class={cn(
		'type-sm-bold',
		tone === 'muted' && 'text-muted-foreground hover:text-foreground active:text-foreground',
		Icon ? 'gap-2' : ''
	)}
	data-sveltekit-preload-code="hover"
	data-sveltekit-preload-data="hover"
>
	<span>{label}</span>
	{#if Icon}
		<Icon class="size-4" />
	{/if}
</Button>
