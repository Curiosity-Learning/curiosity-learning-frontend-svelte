<script lang="ts">
	import { Field, FieldDescription, FieldError, FieldLabel } from '$lib/components/ui/field';
	import { cn } from '$lib/utils';

	type Props = {
		id?: string;
		label?: string;
		required?: boolean;
		hint?: string;
		error?: string;
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
		error,
		class: className,
		labelClass,
		hintClass,
		children
	}: Props = $props();
</script>

<Field class={cn('flex flex-col gap-2', className)}>
	{#if label}
		<FieldLabel for={id} required={required} class={cn('type-field-label text-gray-900', labelClass)}>
			{label}
		</FieldLabel>
	{/if}

	{@render children()}

	{#if hint}
		<FieldDescription class={cn('text-sm leading-7 text-gray-600', hintClass)}>
			{hint}
		</FieldDescription>
	{/if}

	{#if error}
		<FieldError>{error}</FieldError>
	{/if}
</Field>
