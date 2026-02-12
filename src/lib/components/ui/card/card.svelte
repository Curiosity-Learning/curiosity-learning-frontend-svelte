<script lang="ts">
	import { goto } from '$app/navigation';
	import type { Attachment } from 'svelte/attachments';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	const INTERACTIVE_CHILD_SELECTOR = [
		'a',
		'button',
		'input',
		'select',
		'textarea',
		'summary',
		'[role="button"]',
		'[role="link"]',
		'[role="menuitem"]',
		'[contenteditable="true"]',
		'[data-card-interactive]'
	].join(',');

	type Props = WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
		href?: string;
		disabled?: boolean;
	};

	let {
		ref = $bindable(null),
		class: className,
		href,
		disabled = false,
		onclick,
		onkeydown,
		children,
		...restProps
	}: Props = $props();

	let hasHref = $derived(Boolean(href));
	let isCardInteractive = $derived(hasHref && !disabled);
	let cardClass = $derived(
		cn(
			'flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm',
			hasHref && 'cursor-pointer',
			className
		)
	);

	const eventTargetsInteractiveChild = (event: MouseEvent | KeyboardEvent) => {
		const target = event.target;
		const currentTarget = event.currentTarget;
		if (!(target instanceof Element) || !(currentTarget instanceof Element)) return false;
		const interactiveAncestor = target.closest(INTERACTIVE_CHILD_SELECTOR);
		return interactiveAncestor !== null && interactiveAncestor !== currentTarget;
	};

	const navigateToHref = () => {
		if (!href || typeof window === 'undefined') return;
		const url = new URL(href, window.location.href);
		if (url.origin !== window.location.origin) {
			window.location.assign(url.toString());
			return;
		}
		void goto(`${url.pathname}${url.search}${url.hash}`);
	};

	const handleClick: NonNullable<HTMLAttributes<HTMLDivElement>['onclick']> = (event) => {
		onclick?.(event);
		if (!isCardInteractive || event.defaultPrevented) return;
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		if (eventTargetsInteractiveChild(event)) return;
		if (window.getSelection()?.toString()) return;
		event.preventDefault();
		navigateToHref();
	};

	const handleKeydown: NonNullable<HTMLAttributes<HTMLDivElement>['onkeydown']> = (event) => {
		onkeydown?.(event);
		if (!isCardInteractive || event.defaultPrevented) return;
		if (event.key !== 'Enter' && event.key !== ' ') return;
		if (eventTargetsInteractiveChild(event)) return;
		event.preventDefault();
		navigateToHref();
	};

	const setRef: Attachment<HTMLDivElement> = (node) => {
		ref = node;
		return () => {
			if (ref === node) {
				ref = null;
			}
		};
	};
</script>

{#if isCardInteractive}
	<div
		{@attach setRef}
		data-slot="card"
		role="link"
		tabindex={0}
		onclick={handleClick}
		onkeydown={handleKeydown}
		class={cardClass}
		{...restProps}
	>
		{@render children?.()}
	</div>
{:else}
	<div
		{@attach setRef}
		data-slot="card"
		onclick={disabled ? undefined : onclick}
		onkeydown={disabled ? undefined : onkeydown}
		class={cardClass}
		{...restProps}
	>
		{@render children?.()}
	</div>
{/if}
