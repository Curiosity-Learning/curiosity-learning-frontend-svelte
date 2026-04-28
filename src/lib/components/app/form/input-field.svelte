<script lang="ts">
	import { Field, FieldDescription, FieldError, FieldLabel } from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { cn } from '$lib/utils';
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements';

	type Props = {
		id: string;
		value?: string;
		type?: Exclude<HTMLInputTypeAttribute, 'file'>;
		name?: HTMLInputAttributes['name'];
		autocomplete?: HTMLInputAttributes['autocomplete'];
		placeholder?: HTMLInputAttributes['placeholder'];
		disabled?: boolean;
		maxlength?: number;
		min?: number | string;
		max?: number | string;
		step?: number | string;
		inputmode?: HTMLInputAttributes['inputmode'];
		autocapitalize?: HTMLInputAttributes['autocapitalize'];
		readonly?: boolean;
		label?: string;
		required?: boolean;
		hint?: string;
		error?: string;
		class?: string;
		labelClass?: string;
		hintClass?: string;
		inputClass?: string;
		trailing?: import('svelte').Snippet;
	};

	let {
		id,
		value = $bindable(''),
		type = 'text',
		name,
		autocomplete,
		placeholder,
		disabled = false,
		maxlength,
		min,
		max,
		step,
		inputmode,
		autocapitalize,
		readonly = false,
		label,
		required = false,
		hint,
		error,
		class: className,
		labelClass,
		hintClass,
		inputClass,
		trailing
	}: Props = $props();

	let hintId = $derived(hint ? `${id}-hint` : undefined);
	let errorId = $derived(error ? `${id}-error` : undefined);
	let describedBy = $derived([hintId, errorId].filter(Boolean).join(' ') || undefined);
</script>

<Field class={cn('flex flex-col gap-2', className)}>
	{#if label}
		<FieldLabel for={id} required={required} class={cn('type-field-label text-base leading-6 font-bold text-gray-900', labelClass)}>
			{label}
		</FieldLabel>
	{/if}

	{#if hint}
		<FieldDescription id={hintId} class={cn('type-body text-sm leading-6 font-normal text-gray-600', hintClass)}>
			{hint}
		</FieldDescription>
	{/if}

	<div class="relative">
		<Input
			{id}
			{type}
			{name}
			{autocomplete}
			{placeholder}
			{disabled}
			{maxlength}
			{min}
			{max}
			{step}
			{inputmode}
			{autocapitalize}
			{readonly}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={describedBy}
			bind:value
			class={cn('h-12 rounded-md border-gray-300 px-4 text-base', trailing ? 'pr-11' : '', inputClass)}
		/>

		{#if trailing}
			<div class="absolute inset-y-0 right-3 flex items-center text-gray-500">
				{@render trailing()}
			</div>
		{/if}
	</div>

	{#if error}
		<FieldError id={errorId}>{error}</FieldError>
	{/if}
</Field>
