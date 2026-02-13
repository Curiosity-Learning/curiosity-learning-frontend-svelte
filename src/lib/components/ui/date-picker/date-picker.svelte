<!--
	DatePicker — date-only picker (no time).

	Renders a button that opens a calendar popover. Binds a millisecond
	timestamp (`number | null`) so the value can be passed directly to
	Convex mutations without any string conversion.

	Usage:
	  <DatePicker id="dueDate" bind:value={dueDateMs} />
-->
<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import {
		CalendarDate,
		type DateValue,
		DateFormatter,
		getLocalTimeZone
	} from '@internationalized/date';
	import { cn } from '$lib/utils.js';
	import { Button } from '$lib/components/ui/button';
	import { Calendar } from '$lib/components/ui/calendar';
	import * as Popover from '$lib/components/ui/popover';

	type Props = {
		/** Millisecond timestamp, or null if no date is selected. */
		value: number | null;
		id?: string;
		class?: string;
	};

	let { value = $bindable(null), id, class: className }: Props = $props();

	const df = new DateFormatter('en-US', { dateStyle: 'long' });

	let calendarValue = $derived.by(() => {
		if (value === null) return undefined;
		const date = new Date(value);
		return new CalendarDate(date.getFullYear(), date.getMonth() + 1, date.getDate()) as DateValue;
	});

	let open = $state(false);

	const onValueChange = (newValue: DateValue | undefined) => {
		if (newValue) {
			value = new Date(newValue.year, newValue.month - 1, newValue.day).getTime();
		} else {
			value = null;
		}
		open = false;
	};
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				{id}
				variant="outline"
				class={cn(
					'w-full justify-start text-left type-control',
					value === null && 'text-muted-foreground',
					className
				)}
			>
				<CalendarIcon class="mr-2 size-4" />
				{calendarValue ? df.format(calendarValue.toDate(getLocalTimeZone())) : 'Pick a date'}
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-auto p-0" align="start">
		<Calendar type="single" value={calendarValue} {onValueChange} />
	</Popover.Content>
</Popover.Root>
