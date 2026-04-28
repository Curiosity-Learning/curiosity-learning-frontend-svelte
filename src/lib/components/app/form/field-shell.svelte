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
		<FieldLabel for={id} required={required} class={cn('type-field-label text-base leading-6 font-bold text-gray-900', labelClass)}>
			{label}
		</FieldLabel>
	{/if}

	{#if hint}
		<FieldDescription class={cn('type-body text-sm leading-6 font-normal text-gray-600', hintClass)}>
			{hint}
		</FieldDescription>
	{/if}

	{@render children()}

	{#if error}
		<FieldError>{error}</FieldError>
	{/if}
</Field>
