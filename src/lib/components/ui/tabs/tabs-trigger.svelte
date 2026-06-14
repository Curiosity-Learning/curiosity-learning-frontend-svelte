<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';
	import { box } from 'svelte-toolbelt';
	import { receive, send, useTabsTrigger } from './tabs.svelte.js';

	let {
		ref = $bindable(null),
		value,
		class: className,
		children,
		...restProps
	}: TabsPrimitive.TriggerProps = $props();

	const state = useTabsTrigger({
		value: box.with(() => value)
	});
</script>

<div class="relative h-full">
	<TabsPrimitive.Trigger
		bind:ref
		data-slot="tabs-trigger"
		class={cn(
			"relative z-2 inline-flex h-[calc(100%-3px)] flex-1 cursor-pointer items-center justify-center gap-1.5 px-3 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors focus:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground dark:data-[state=active]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
			className
		)}
		{...state.props}
		{...restProps}
	>
		{@render children?.()}
	</TabsPrimitive.Trigger>
	{#if state.rootState.opts.value.current === value}
		<div
			class="absolute -bottom-px z-1 h-0.5 w-full bg-primary"
			in:receive={{ key: `${state.rootState.opts.id.current}-tab-active-border`, duration: 200 }}
			out:send={{ key: `${state.rootState.opts.id.current}-tab-active-border`, duration: 200 }}
		></div>
	{/if}
</div>
