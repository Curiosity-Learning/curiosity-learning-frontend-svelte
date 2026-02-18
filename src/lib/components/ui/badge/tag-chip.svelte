<script lang="ts">
	import type { Snippet } from 'svelte';
	import XIcon from '@lucide/svelte/icons/x';
	import { cn } from '$lib/utils.js';
	import Badge from './badge.svelte';

	export type TagChipTone = 'accent' | 'muted';

	type Props = {
		label: string;
		tone?: TagChipTone;
		removable?: boolean;
		disabled?: boolean;
		removeLabel?: string;
		onRemove?: () => void;
		leading?: Snippet;
		trailing?: Snippet;
		class?: string;
	};

	let {
		label,
		tone = 'accent',
		removable = false,
		disabled = false,
		removeLabel,
		onRemove,
		leading,
		trailing,
		class: className
	}: Props = $props();

	let toneClass = $derived(
		tone === 'muted'
			? 'bg-secondary py-0.5 text-primary'
			: 'bg-accent/60 px-3 py-0.5 type-sm-bold text-primary'
	);
	let removablePaddingClass = $derived(removable ? 'pr-1.5' : '');

	const handleRemove = (event: MouseEvent) => {
		event.stopPropagation();
		if (disabled) return;
		onRemove?.();
	};
</script>

<Badge variant="secondary" class={cn('gap-1', toneClass, removablePaddingClass, className)}>
	{#if leading}
		{@render leading()}
	{/if}
	<span class="truncate">{label}</span>
	{#if removable}
		<button
			type="button"
			data-chip-remove="true"
			disabled={disabled}
			class="inline-flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-60"
			aria-label={removeLabel ?? `Remove ${label}`}
			onmousedown={(event) => {
				event.preventDefault();
				event.stopPropagation();
			}}
			onclick={handleRemove}
		>
			<XIcon class="size-3.5" />
		</button>
	{:else if trailing}
		{@render trailing()}
	{/if}
</Badge>
