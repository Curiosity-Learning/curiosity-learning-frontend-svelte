<script lang="ts">
	import { NavigationMenu as NavigationMenuPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";
	import type { Snippet } from "svelte";

	let {
		ref = $bindable(null),
		class: className,
		wrapperClass: wrapperClassName,
		children,
		...restProps
	}: NavigationMenuPrimitive.ListProps & {
		wrapperClass?: string;
		children?: Snippet;
	} = $props();
</script>

<NavigationMenuPrimitive.List bind:ref {...restProps}>
	{#snippet child({ props, wrapperProps })}
		<div
			{...wrapperProps}
			class={cn((wrapperProps as Record<string, unknown>)?.class as string, wrapperClassName)}
		>
			<ul
				{...props}
				data-slot="navigation-menu-list"
				class={cn(
					"group flex flex-1 list-none items-center justify-center gap-1",
					(props as Record<string, unknown>)?.class as string,
					className
				)}
			>
				{@render children?.()}
			</ul>
		</div>
	{/snippet}
</NavigationMenuPrimitive.List>
