<script lang="ts">
	import { RadioGroup as RadioGroupPrimitive } from 'bits-ui';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<RadioGroupPrimitive.ItemProps> = $props();
</script>

<!-- shadcn-svelte radio-group item, with the orange focus/checked accent the checkbox uses. -->
<RadioGroupPrimitive.Item
	bind:ref
	data-slot="radio-group-item"
	class={cn(
		'aspect-square size-4 shrink-0 rounded-full border border-input text-orange-500 shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-orange-500 focus-visible:ring-[3px] focus-visible:ring-orange-500/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=checked]:border-orange-500 dark:bg-input/30 dark:aria-invalid:ring-destructive/40',
		className
	)}
	{...restProps}
>
	{#snippet children({ checked })}
		<div data-slot="radio-group-indicator" class="relative flex items-center justify-center">
			{#if checked}
				<CircleIcon
					class="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 fill-orange-500"
				/>
			{/if}
		</div>
	{/snippet}
</RadioGroupPrimitive.Item>
