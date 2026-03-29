<script lang="ts">
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';

	type Props = {
		title: string;
		description?: string;
	};

	let { title, description }: Props = $props();
</script>

<div
	class="pointer-events-auto flex w-full min-w-[17.5rem] max-w-[21.5rem] items-start gap-3 rounded-lg bg-gray-900 px-3 py-3 text-white shadow-lg"
>
	<div
		class="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-white/20"
		aria-hidden="true"
	>
		<CircleCheckIcon class="size-3.5" />
	</div>

	<div class="flex min-w-0 flex-col gap-0.5">
		<p class="text-sm leading-5 font-bold text-white">{title}</p>
		{#if description}
			<p class="text-sm leading-5 text-white/85">{description}</p>
		{/if}
	</div>
</div>
