<script lang="ts">
	import ScreenBackButton from '../screen-back-button.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { formatT, locale } from '$lib/i18n';

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
			? new Intl.DateTimeFormat($locale, {
					month: 'long',
					day: 'numeric',
					year: 'numeric'
				}).format(new Date(updatedAt))
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
	<ScreenBackButton onclick={() => void handleBack()} />

	<div class="flex flex-col gap-3">
		<h1 class="text-[2rem] leading-[2.5rem] font-bold text-gray-900">{title}</h1>
		{#if lastUpdatedLabel}
			<p class="text-base leading-7 font-bold text-orange-500">
				{formatT('common.lastUpdatedOn', { date: lastUpdatedLabel })}
			</p>
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
