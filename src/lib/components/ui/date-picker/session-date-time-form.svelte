<!--
	SessionDateTimeForm — single date + start/end time picker.

	Optimized for the most common case: sessions that start and end on the
	same day.  The user picks one date and two times.  Under the hood, both
	`startTime` and `endTime` are full millisecond timestamps sent to the
	API unchanged.

	When end time is earlier than start time (e.g. 11:30 PM → 12:30 AM)
	the end timestamp automatically advances to the next calendar day so
	overnight sessions work correctly.

	Usage:
	  <SessionDateTimeForm
	    bind:startTime={form.startTime}
	    bind:endTime={form.endTime}
	  />
-->
<script lang="ts">
	import {
		CalendarDate,
		type DateValue,
		DateFormatter,
		getLocalTimeZone
	} from '@internationalized/date';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import { cn } from '$lib/utils.js';
	import { Button } from '$lib/components/ui/button';
	import { Calendar } from '$lib/components/ui/calendar';
	import { Input } from '$lib/components/ui/input';
	import { FieldLabel } from '$lib/components/ui/field';
	import * as Popover from '$lib/components/ui/popover';

	type Props = {
		/** Start time as millisecond timestamp, or null. */
		startTime: number | null;
		/** End time as millisecond timestamp, or null. */
		endTime: number | null;
	};

	let { startTime = $bindable(null), endTime = $bindable(null) }: Props = $props();

	const df = new DateFormatter('en-US', { dateStyle: 'long' });

	// ── Derived: date portion (from startTime) ──────────────────────────

	let calendarValue = $derived.by(() => {
		if (startTime === null) return undefined;
		const d = new Date(startTime);
		return new CalendarDate(d.getFullYear(), d.getMonth() + 1, d.getDate()) as DateValue;
	});

	let dateLabel = $derived.by(() => {
		if (!calendarValue) return '';
		return df.format(calendarValue.toDate(getLocalTimeZone()));
	});

	// ── Derived: time strings ───────────────────────────────────────────

	const msToTimeString = (ms: number | null): string => {
		if (ms === null) return '';
		const d = new Date(ms);
		return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	};

	let startTimeStr = $derived(msToTimeString(startTime));
	let endTimeStr = $derived(msToTimeString(endTime));

	// ── Helpers ─────────────────────────────────────────────────────────

	/** Build a ms timestamp from a Date (for the date part) and an "HH:MM" string. */
	const buildTimestamp = (dateSource: Date, timeStr: string): number => {
		const [h, m] = timeStr.split(':').map(Number);
		return new Date(
			dateSource.getFullYear(),
			dateSource.getMonth(),
			dateSource.getDate(),
			h ?? 0,
			m ?? 0,
			0,
			0
		).getTime();
	};

	/**
	 * Recompute both timestamps so they share the same calendar date,
	 * except when end time < start time (overnight) — then end date
	 * advances by one day automatically.
	 */
	const reconcile = (baseDate: Date, sStr: string, eStr: string) => {
		const newStart = buildTimestamp(baseDate, sStr);
		let newEnd = buildTimestamp(baseDate, eStr);

		// Overnight: end time wraps past midnight → advance end by 1 day
		if (newEnd <= newStart) {
			const nextDay = new Date(baseDate);
			nextDay.setDate(nextDay.getDate() + 1);
			newEnd = buildTimestamp(nextDay, eStr);
		}

		startTime = newStart;
		endTime = newEnd;
	};

	// ── Event handlers ──────────────────────────────────────────────────

	let calendarOpen = $state(false);

	const onDateChange = (newValue: DateValue | undefined) => {
		if (!newValue) return;
		const baseDate = new Date(newValue.year, newValue.month - 1, newValue.day);
		const sStr = startTimeStr || '12:00';
		const eStr = endTimeStr || '13:00';
		reconcile(baseDate, sStr, eStr);
		calendarOpen = false;
	};

	const onStartTimeInput = (event: Event) => {
		const input = event.target as HTMLInputElement;
		if (!input.value) return;
		const baseDate = startTime !== null ? new Date(startTime) : new Date();
		reconcile(baseDate, input.value, endTimeStr || '13:00');
	};

	const onEndTimeInput = (event: Event) => {
		const input = event.target as HTMLInputElement;
		if (!input.value) return;
		const baseDate = startTime !== null ? new Date(startTime) : new Date();
		reconcile(baseDate, startTimeStr || '12:00', input.value);
	};
</script>

<div class="flex flex-col gap-3">
	<!-- Date picker (single day) -->
	<div class="flex flex-col gap-2">
		<FieldLabel for="sessionDate" required>Date</FieldLabel>
		<Popover.Root bind:open={calendarOpen}>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						id="sessionDate"
						variant="outline"
						class={cn(
							'w-full justify-start text-left type-control',
							!calendarValue && 'text-muted-foreground'
						)}
					>
						<CalendarIcon class="mr-2 size-4" />
						{dateLabel || 'Pick a date'}
					</Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content class="w-auto p-0" align="start">
				<Calendar type="single" value={calendarValue} onValueChange={onDateChange} />
			</Popover.Content>
		</Popover.Root>
	</div>

	<!-- Start / End time side by side -->
	<div class="grid grid-cols-2 gap-3">
		<div class="flex flex-col gap-2">
			<FieldLabel for="sessionStartTime" required>Start time</FieldLabel>
			<Input
				type="time"
				id="sessionStartTime"
				value={startTimeStr}
				oninput={onStartTimeInput}
				class="appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
			/>
		</div>
		<div class="flex flex-col gap-2">
			<FieldLabel for="sessionEndTime" required>End time</FieldLabel>
			<Input
				type="time"
				id="sessionEndTime"
				value={endTimeStr}
				oninput={onEndTimeInput}
				class="appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
			/>
		</div>
	</div>
</div>
