<script lang="ts">
	import { PinInput } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	type Props = WithoutChildrenOrChild<PinInput.RootProps> & {
		cellClass?: string;
	};

	let {
		ref = $bindable(null),
		value = $bindable(''),
		maxlength = 6,
		inputmode = 'numeric',
		pattern = '[0-9]*',
		textalign = 'center',
		pasteTransformer = (text: string) => text.replace(/\D/g, ''),
		class: className,
		cellClass,
		...restProps
	}: Props = $props();
</script>

<PinInput.Root
	bind:ref
	bind:value
	{maxlength}
	{inputmode}
	{pattern}
	{textalign}
	{pasteTransformer}
	class={cn('flex items-center justify-between gap-2 sm:gap-3', className)}
	{...restProps}
>
	{#snippet children({ cells })}
		{#each cells as cell, index}
			<PinInput.Cell
				{cell}
				aria-label={`OTP digit ${index + 1}`}
				class={cn(
					'relative flex h-14 w-11 items-center justify-center rounded-md border border-gray-300 bg-white text-center text-lg font-bold text-gray-900 transition-colors sm:w-12',
					'data-[active]:border-orange-500 data-[active]:ring-2 data-[active]:ring-orange-200',
					cell.char ? 'border-orange-500' : '',
					cellClass
				)}
			>
				{#if cell.char}
					{cell.char}
				{/if}
				{#if cell.hasFakeCaret}
					<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
						<span class="otp-caret h-6 w-px bg-gray-900"></span>
					</div>
				{/if}
			</PinInput.Cell>
		{/each}
	{/snippet}
</PinInput.Root>

<style>
	@keyframes otp-caret-blink {
		0%,
		70%,
		100% {
			opacity: 1;
		}
		20%,
		50% {
			opacity: 0;
		}
	}

	.otp-caret {
		animation: otp-caret-blink 1s step-end infinite;
	}
</style>
