<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';

	type Props = {
		title: string;
		content: string | null;
		updatedAt?: number | null;
		emptyMessage: string;
	};

	let { title, content, updatedAt = null, emptyMessage }: Props = $props();
	let backTo = $derived(page.url.searchParams.get('backTo'));
	let backToPath = $derived(backTo && backTo.startsWith('/') ? backTo : null);

	let lastUpdatedLabel = $derived(
		updatedAt
			? new Date(updatedAt).toLocaleDateString(undefined, {
				month: 'long',
				day: 'numeric',
				year: 'numeric'
			})
			: null
	);

	const handleBack = async () => {
		if (backToPath) {
			await goto(backToPath);
			return;
		}
		history.back();
	};
</script>

<div class="mx-auto flex min-h-screen w-full max-w-[28.75rem] flex-col gap-6 px-4 py-6 sm:py-8">
	<button
		type="button"
		onclick={() => void handleBack()}
		class="inline-flex w-fit items-center text-gray-500 transition-colors duration-200 hover:text-gray-700"
		aria-label="Go back"
	>
		<ChevronLeftIcon class="size-7" />
	</button>

	<div class="flex flex-col gap-3">
		<h1 class="text-[2rem] leading-[2.5rem] font-bold text-gray-900">{title}</h1>
		{#if lastUpdatedLabel}
			<p class="text-base leading-7 font-bold text-orange-500">Last updated on {lastUpdatedLabel}</p>
		{/if}
	</div>

	{#if content}
		<div class="flex-1 overflow-y-auto pb-6">
			<p class="whitespace-pre-line text-base leading-8 text-gray-600">{content}</p>
		</div>
	{:else}
		<div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
			<p class="text-base leading-7 text-gray-600">{emptyMessage}</p>
		</div>
	{/if}
</div>
