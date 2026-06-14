<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: TabsPrimitive.ListProps = $props();
</script>

<TabsPrimitive.List
	bind:ref
	data-slot="tabs-list"
	class={cn(
		'relative inline-flex h-9 w-full max-w-full items-center justify-start overflow-x-auto border-b border-border text-muted-foreground',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</TabsPrimitive.List>

<style>
	:global([data-slot='tabs-list']) {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}

	:global([data-slot='tabs-list']::-webkit-scrollbar) {
		display: none;
	}
</style>
