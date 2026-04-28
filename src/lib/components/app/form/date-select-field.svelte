<script lang="ts">
	import { Field, FieldDescription, FieldLabel } from '$lib/components/ui/field';
	import * as Select from '$lib/components/ui/select';
	import { cn } from '$lib/utils';

	const DEFAULT_MONTHS = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];

	type DateSelectOption = {
		label: string;
		value: string;
	};

	type Props = {
		idPrefix?: string;
		label: string;
		required?: boolean;
		hint?: string;
		includeDay?: boolean;
		month?: string;
		day?: string;
		year?: string;
		months?: Array<string | DateSelectOption>;
		maxYear?: number;
		yearCount?: number;
		class?: string;
		labelClass?: string;
		hintClass?: string;
		selectClass?: string;
	};

	let {
		idPrefix = 'date-of-birth',
		label,
		required = false,
		hint,
		includeDay = true,
		month = $bindable(''),
		day = $bindable(''),
		year = $bindable(''),
		months = DEFAULT_MONTHS,
		maxYear = new Date().getFullYear(),
		yearCount = 100,
		class: className,
		labelClass,
		hintClass,
		selectClass
	}: Props = $props();

	let dayOptions = $derived(Array.from({ length: 31 }, (_, index) => String(index + 1)));
	let yearOptions = $derived(Array.from({ length: yearCount }, (_, index) => String(maxYear - index)));
	let monthOptions = $derived(
		months.map((monthOption) =>
			typeof monthOption === 'string'
				? { label: monthOption, value: monthOption }
				: monthOption
		)
	);
	let selectedMonthLabel = $derived(
		monthOptions.find((monthOption) => monthOption.value === month)?.label ?? ''
	);
</script>

<Field class={cn('flex flex-col gap-2', className)}>
	{#if label}
		<FieldLabel for={`${idPrefix}-month`} required={required} class={cn('type-field-label text-gray-900', labelClass)}>
			{label}
		</FieldLabel>
	{/if}

	{#if hint}
		<FieldDescription class={cn('type-body text-gray-600', hintClass)}>
			{hint}
		</FieldDescription>
	{/if}

	<div class={`grid gap-2 ${includeDay ? 'grid-cols-3' : 'grid-cols-2'}`}>
		<Select.Root type="single" bind:value={month}>
			<Select.Trigger
				id={`${idPrefix}-month`}
				aria-label="Month"
				class={cn('h-12 w-full justify-between bg-white text-base text-gray-700', !month && 'text-gray-500', selectClass)}
			>
				<span>{selectedMonthLabel || 'Month'}</span>
			</Select.Trigger>
			<Select.Content>
				{#each monthOptions as monthOption (monthOption.value)}
					<Select.Item value={monthOption.value} label={monthOption.label}>
						{monthOption.label}
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>

		{#if includeDay}
			<Select.Root type="single" bind:value={day}>
				<Select.Trigger
					id={`${idPrefix}-day`}
					aria-label="Day"
					class={cn('h-12 w-full justify-between bg-white text-base text-gray-700', !day && 'text-gray-500', selectClass)}
				>
					<span>{day || 'Day'}</span>
				</Select.Trigger>
				<Select.Content>
					{#each dayOptions as dayOption (dayOption)}
						<Select.Item value={dayOption} label={dayOption}>
							{dayOption}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}

		<Select.Root type="single" bind:value={year}>
			<Select.Trigger
				id={`${idPrefix}-year`}
				aria-label="Year"
				class={cn('h-12 w-full justify-between bg-white text-base text-gray-700', !year && 'text-gray-500', selectClass)}
			>
				<span>{year || 'Year'}</span>
			</Select.Trigger>
			<Select.Content>
				{#each yearOptions as yearOption (yearOption)}
					<Select.Item value={yearOption} label={yearOption}>
						{yearOption}
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
</Field>
