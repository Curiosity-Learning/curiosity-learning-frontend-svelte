<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { cn } from '$lib/utils';
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import FieldShell from './field-shell.svelte';

	export type SelectOption = {
		label: string;
		value: string;
		disabled?: boolean;
	};

	type Props = Omit<HTMLSelectAttributes, 'class' | 'value'> & {
		id: string;
		value?: string;
		options: SelectOption[];
		placeholder?: string;
		label?: string;
		required?: boolean;
		hint?: string;
		class?: string;
		labelClass?: string;
		hintClass?: string;
		selectClass?: string;
	};

	let {
		id,
		value = $bindable(''),
		options,
		placeholder = 'Select an option',
		label,
		required = false,
		hint,
		class: className,
		labelClass,
		hintClass,
		selectClass,
		...restProps
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
		<select
			{id}
			bind:value
			class={cn(
				'h-12 w-full appearance-none rounded-md border border-gray-300 bg-white px-4 pr-12 text-base text-gray-700 outline-none transition-[border-color,box-shadow] duration-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-200',
				selectClass
			)}
			{...restProps}
		>
			{#if placeholder}
				<option value="" disabled>{placeholder}</option>
			{/if}
			{#each options as option (option.value)}
				<option value={option.value} disabled={option.disabled}>{option.label}</option>
			{/each}
		</select>

		<ChevronDownIcon
			class="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-gray-500"
		/>
	</div>
</FieldShell>
