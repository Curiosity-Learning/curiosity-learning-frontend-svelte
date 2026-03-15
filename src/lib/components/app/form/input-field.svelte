<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { cn } from '$lib/utils';
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements';
	import FieldShell from './field-shell.svelte';

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
		class: className,
		labelClass,
		hintClass,
		inputClass,
		trailing
	}: Props = $props();
</script>

<FieldShell
	id={id}
	label={label}
	required={required}
	hint={hint}
	class={className}
	labelClass={labelClass}
	hintClass={hintClass}
>
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
			bind:value
			class={cn('h-12 rounded-md border-gray-300 px-4 text-base', trailing ? 'pr-11' : '', inputClass)}
		/>

		{#if trailing}
			<div class="absolute top-1/2 right-3 -translate-y-1/2 text-gray-500">
				{@render trailing()}
			</div>
		{/if}
	</div>
</FieldShell>
