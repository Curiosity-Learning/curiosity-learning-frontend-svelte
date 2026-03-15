<script lang="ts">
	import { cn } from '$lib/utils';

	type Props = {
		id?: string;
		label?: string;
		required?: boolean;
		hint?: string;
		class?: string;
		labelClass?: string;
		hintClass?: string;
		children: import('svelte').Snippet;
	};

	let {
		id,
		label,
		required = false,
		hint,
		class: className,
		labelClass,
		hintClass,
		children
	}: Props = $props();
</script>

<div class={cn('flex flex-col gap-2', className)}>
	{#if label}
		<label for={id} class={cn('type-field-label text-gray-900', labelClass)}>
			{label}
			{#if required}
				<span class="ml-1 text-red-500">*</span>
			{/if}
		</label>
	{/if}

	{@render children()}

	{#if hint}
		<p class={cn('text-sm leading-7 text-gray-600', hintClass)}>{hint}</p>
	{/if}
</div>
