<!--
	DateTimePicker — date + time picker.

	Renders a calendar-popover button alongside a native time input.
	Binds a millisecond timestamp (`number | null`) so the value can be
	passed directly to Convex mutations without any string conversion.

	Usage:
	  <DateTimePicker id="sessionStart" bind:value={startTimeMs} />
-->
<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import { CalendarDate, type DateValue } from '@internationalized/date';
	import { cn } from '$lib/utils.js';
	import { Button } from '$lib/components/ui/button';
	import { Calendar } from '$lib/components/ui/calendar';
	import { Input } from '$lib/components/ui/input';
	import * as Popover from '$lib/components/ui/popover';

	type Props = {
		/** Millisecond timestamp, or null if no datetime is selected. */
		value: number | null;
		id?: string;
		class?: string;
	};

	let { value = $bindable(null), id, class: className }: Props = $props();

	let calendarValue = $derived.by(() => {
		if (value === null) return undefined;
		const date = new Date(value);
		return new CalendarDate(date.getFullYear(), date.getMonth() + 1, date.getDate()) as DateValue;
	});

	let timeValue = $derived.by(() => {
		if (value === null) return '';
		const date = new Date(value);
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		return `${hours}:${minutes}`;
	});

	let dateLabel = $derived.by(() => {
		if (value === null) return '';
		const date = new Date(value);
		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	});

	let open = $state(false);

	const onDateChange = (newValue: DateValue | undefined) => {
		if (newValue) {
			const current = value !== null ? new Date(value) : new Date();
			value = new Date(
				newValue.year,
				newValue.month - 1,
				newValue.day,
				current.getHours(),
				current.getMinutes()
			).getTime();
		}
		open = false;
	};

	const onTimeChange = (event: Event) => {
		const input = event.target as HTMLInputElement;
		const [hours, minutes] = input.value.split(':').map(Number);
		const current = value !== null ? new Date(value) : new Date();
		value = new Date(
			current.getFullYear(),
			current.getMonth(),
			current.getDate(),
			hours ?? 0,
			minutes ?? 0,
			0,
			0
		).getTime();
	};
</script>

<div class={cn('flex gap-2', className)}>
	<Popover.Root bind:open>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					id={id ? `${id}-date` : undefined}
					variant="outline"
					class={cn(
						'flex-1 justify-start text-left type-control',
						value === null && 'text-muted-foreground'
					)}
				>
					<CalendarIcon class="mr-2 size-4" />
					{dateLabel || 'Select date'}
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="w-auto p-0" align="start">
			<Calendar type="single" value={calendarValue} onValueChange={onDateChange} />
		</Popover.Content>
	</Popover.Root>

	<Input
		type="time"
		id={id ? `${id}-time` : undefined}
		value={timeValue}
		oninput={onTimeChange}
		class="w-auto appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
	/>
</div>
