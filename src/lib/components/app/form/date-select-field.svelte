<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { cn } from '$lib/utils';
	import FieldShell from './field-shell.svelte';

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

	type Props = {
		idPrefix?: string;
		label: string;
		required?: boolean;
		hint?: string;
		includeDay?: boolean;
		month?: string;
		day?: string;
		year?: string;
		months?: string[];
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
</script>

<FieldShell
	id={`${idPrefix}-month`}
	{label}
	{required}
	{hint}
	class={className}
	{labelClass}
	{hintClass}
>
	<div class={`grid gap-2 ${includeDay ? 'grid-cols-3' : 'grid-cols-2'}`}>
		<div class="relative">
			<select
				id={`${idPrefix}-month`}
				bind:value={month}
				aria-label="Month"
				class={cn(
					'h-12 w-full appearance-none rounded-md border border-gray-300 bg-white pl-3 pr-12 text-base text-gray-700 outline-none transition-[border-color,box-shadow] duration-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-200',
					selectClass
				)}
			>
				<option value="" disabled>Month</option>
				{#each months as monthOption}
					<option value={monthOption}>{monthOption}</option>
				{/each}
			</select>
			<ChevronDownIcon
				class="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-gray-500"
			/>
		</div>

		{#if includeDay}
			<div class="relative">
				<select
					id={`${idPrefix}-day`}
					bind:value={day}
					aria-label="Day"
					class={cn(
						'h-12 w-full appearance-none rounded-md border border-gray-300 bg-white pl-3 pr-12 text-base text-gray-700 outline-none transition-[border-color,box-shadow] duration-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-200',
						selectClass
					)}
				>
					<option value="" disabled>Day</option>
					{#each dayOptions as dayOption}
						<option value={dayOption}>{dayOption}</option>
					{/each}
				</select>
				<ChevronDownIcon
					class="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-gray-500"
				/>
			</div>
		{/if}

		<div class="relative">
			<select
				id={`${idPrefix}-year`}
				bind:value={year}
				aria-label="Year"
				class={cn(
					'h-12 w-full appearance-none rounded-md border border-gray-300 bg-white pl-3 pr-12 text-base text-gray-700 outline-none transition-[border-color,box-shadow] duration-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-200',
					selectClass
				)}
			>
				<option value="" disabled>Year</option>
				{#each yearOptions as yearOption}
					<option value={yearOption}>{yearOption}</option>
				{/each}
			</select>
			<ChevronDownIcon
				class="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-gray-500"
			/>
		</div>
	</div>
</FieldShell>
