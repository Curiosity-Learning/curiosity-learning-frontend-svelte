<script lang="ts">
	import { Field, FieldDescription, FieldLabel } from '$lib/components/ui/field';
	import * as Select from '$lib/components/ui/select';
	import { cn } from '$lib/utils';

	export type SelectOption = {
		label: string;
		value: string;
		disabled?: boolean;
	};

	type Props = {
		id: string;
		value?: string;
		options: SelectOption[];
		placeholder?: string;
		name?: string;
		disabled?: boolean;
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
		name,
		disabled = false,
		label,
		required = false,
		hint,
		class: className,
		labelClass,
		hintClass,
		selectClass
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

	<Select.Root type="single" bind:value {name} {disabled}>
		<Select.Trigger
			{id}
			aria-label={label ?? placeholder}
			class={cn(
				'h-12 w-full justify-between bg-white text-base text-gray-700',
				!value && 'text-gray-500',
				selectClass
			)}
		>
			<span>{options.find((option) => option.value === value)?.label || placeholder}</span>
		</Select.Trigger>
		<Select.Content>
			{#each options as option (option.value)}
				<Select.Item value={option.value} label={option.label} disabled={option.disabled}>
					{option.label}
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
</Field>
