<!--
	TimePicker — standalone time-only picker.

	Renders a native time input styled to match the design system.
	Binds an `HH:MM` string so it can be composed into higher-level
	date+time components.

	Usage:
	  <TimePicker id="startTime" bind:value={timeString} />
-->
<script lang="ts">
	import { cn } from '$lib/utils.js';
	import { Input } from '$lib/components/ui/input';

	type Props = {
		/** Time value as "HH:MM" string, or empty string if unset. */
		value: string;
		id?: string;
		class?: string;
	};

	let { value = $bindable(''), id, class: className }: Props = $props();
</script>

<Input
	type="time"
	{id}
	bind:value
	class={cn(
		'w-auto appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none',
		className
	)}
/>
