<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: TabsPrimitive.TriggerProps = $props();
</script>

<TabsPrimitive.Trigger
	bind:ref
	data-slot="tabs-trigger"
	class={cn(
		'inline-flex h-full cursor-pointer items-center justify-center gap-1.5 py-2 type-label whitespace-nowrap text-muted-foreground transition-colors focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 data-[disabled]:cursor-not-allowed data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
		className
	)}
	{...restProps}
/>
