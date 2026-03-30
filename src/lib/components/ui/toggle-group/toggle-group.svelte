<script lang="ts" module>
	import { getContext, setContext } from "svelte";
	import type { VariantProps } from "tailwind-variants";
	import { toggleVariants } from "$lib/components/ui/toggle/index.js";

	type ToggleVariants = VariantProps<typeof toggleVariants>;

	interface ToggleGroupContext extends ToggleVariants {
		spacing?: number;
	}

	interface ToggleGroupContextValue {
		variant: () => ToggleGroupContext["variant"];
		size: () => ToggleGroupContext["size"];
		spacing: () => ToggleGroupContext["spacing"];
	}

	export function setToggleGroupCtx(props: ToggleGroupContextValue) {
		setContext("toggleGroup", props);
	}

	export function getToggleGroupCtx() {
		return getContext<ToggleGroupContextValue>("toggleGroup");
	}
</script>

<script lang="ts">
	import { ToggleGroup as ToggleGroupPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		size = "default",
		spacing = 2,
		variant = "default",
		...restProps
	}: ToggleGroupPrimitive.RootProps & ToggleVariants & { spacing?: number } = $props();

	setToggleGroupCtx({
		variant: () => variant,
		size: () => size,
		spacing: () => spacing,
	});
</script>

<!--
Discriminated Unions + Destructing (required for bindable) do not
get along, so we shut typescript up by casting `value` to `never`.
-->
<ToggleGroupPrimitive.Root
	bind:value={value as never}
	bind:ref
	data-slot="toggle-group"
	data-variant={variant}
	data-size={size}
	data-spacing={spacing}
	style={`--gap: ${spacing}`}
	class={cn(
		"group/toggle-group flex w-fit flex-wrap items-center gap-[--spacing(var(--gap))] rounded-md data-[spacing=default]:data-[variant=outline]:shadow-xs",
		className
	)}
	{...restProps}
/>
