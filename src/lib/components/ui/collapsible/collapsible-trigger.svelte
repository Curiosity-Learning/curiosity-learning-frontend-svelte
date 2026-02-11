<script lang="ts">
	import { Collapsible as CollapsiblePrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let { class: className, children, ...restProps }: CollapsiblePrimitive.TriggerProps = $props();
</script>

<CollapsiblePrimitive.Trigger class={cn(className)} {...restProps}>
	{@render children?.()}
</CollapsiblePrimitive.Trigger>

