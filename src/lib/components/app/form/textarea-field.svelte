<script lang="ts">
	import { Textarea } from '$lib/components/ui/textarea';
	import { cn } from '$lib/utils';
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import FieldShell from './field-shell.svelte';

	type Props = Omit<HTMLTextareaAttributes, 'class' | 'value'> & {
		id: string;
		value?: string;
		label?: string;
		required?: boolean;
		hint?: string;
		class?: string;
		labelClass?: string;
		hintClass?: string;
		textareaClass?: string;
		overlayText?: string;
	};

	let {
		id,
		value = $bindable(''),
		label,
		required = false,
		hint,
		class: className,
		labelClass,
		hintClass,
		textareaClass,
		overlayText,
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
		<Textarea
			{id}
			bind:value
			class={cn('min-h-28 rounded-md border-gray-300 px-4 py-3 text-base', overlayText ? 'pb-9' : '', textareaClass)}
			{...restProps}
		/>

		{#if overlayText}
			<div class="pointer-events-none absolute right-3 bottom-3 text-xs font-medium text-gray-500">
				{overlayText}
			</div>
		{/if}
	</div>
</FieldShell>
