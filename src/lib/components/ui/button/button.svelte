<script lang="ts" module>
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
	import { type VariantProps, tv } from "tailwind-variants";

	/**
	 * Variant contract (CEO design review 2026-07-11/12):
	 * every variant shares ONE typography — `text-base font-bold` from the base — so paired
	 * actions (Accept/Reject, Going/Not going) never differ in weight. Color assigns emphasis:
	 * - default:     solid orange — THE primary action of a surface.
	 * - outline:     orange border/text — secondary action that still carries brand emphasis.
	 * - secondary:   quiet warm-gray fill, foreground text — primary action in compact/inline
	 *                rows (e.g. banner action rows) where solid orange is too loud.
	 * - ghost:       no fill, foreground text — de-emphasized companion action (Reject,
	 *                Decline, Dismiss). Never orange: orange is reserved for primary emphasis.
	 *                With icon sizes it renders muted-foreground (standard icon-action look).
	 * - destructive: solid red — irreversible/dangerous confirm actions.
	 * - link:        inline text link, orange, no box — the app's text-link idiom
	 *                ("See all", "Change", "Read more"). Collapses to content size.
	 */
	export const buttonVariants = tv({
		base: "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-base font-bold whitespace-nowrap transition-colors duration-200 outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
		variants: {
			variant: {
				default:
					"bg-orange-500 text-white hover:bg-orange-600 active:bg-orange-700 focus-visible:ring-orange-300",
				destructive:
					"bg-destructive hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60 text-white",
				outline:
					"border border-orange-500 bg-transparent text-orange-500 hover:bg-orange-50 active:border-orange-600 active:bg-orange-100 focus-visible:ring-orange-200",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-accent",
				ghost: "bg-transparent text-foreground hover:bg-muted active:bg-accent",
				link: "text-orange-500 hover:text-orange-600 active:text-orange-700",
			},
			size: {
				default: "h-9 px-4 py-2 has-[>svg]:px-3",
				sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
				lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
				xl: "h-12 rounded-md px-6 has-[>svg]:px-5",
				icon: "size-9",
				"icon-sm": "size-8",
				"icon-lg": "size-10",
			},
		},
		compoundVariants: [
			// Icon-only ghost buttons are the app's standard icon action (header search,
			// overflow menus, add/edit/delete row actions): muted at rest, foreground on hover.
			{
				variant: "ghost",
				size: ["icon", "icon-sm", "icon-lg"],
				class: "text-muted-foreground hover:text-foreground",
			},
			// Links are inline text, not boxes: collapse the size geometry.
			{
				variant: "link",
				class: "h-auto rounded-sm p-0 has-[>svg]:px-0",
			},
		],
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
	export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
		};
</script>

<script lang="ts">
	let {
		class: className,
		variant = "default",
		size = "default",
		ref = $bindable(null),
		href = undefined,
		type = "button",
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		href={disabled ? undefined : href}
		aria-disabled={disabled}
		role={disabled ? "link" : undefined}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
