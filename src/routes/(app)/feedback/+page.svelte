<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import MessageSquareTextIcon from '@lucide/svelte/icons/message-square-text';
	import { api } from '$convex/_generated/api';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { LoadingState, PageHeaderBackButton, PageHeaderTitle } from '$lib/components/app';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { routes } from '$lib/routes';
	import { t } from '$lib/i18n';

	const outstandingFormsResponse = useStableQuery(api.forms.listMyOutstandingForms, {});
	let outstandingForms = $derived(outstandingFormsResponse.data ?? []);

	const audienceLabel = (audience: 'guide' | 'learner') =>
		audience === 'guide' ? t('feedback.audienceGuide') : t('feedback.audienceLearner');
</script>

<PageHeaderBackButton fallbackHref={routes.profile} />
<PageHeaderTitle title={t('feedback.pageTitle')} />

<div class="flex w-full flex-col gap-4 py-4">
	<p class="text-[1.02rem] text-[#6b6f80]">{t('feedback.pageDescription')}</p>

	{#if outstandingFormsResponse.error}
		<Alert variant="destructive">
			<AlertTitle>{t('feedback.loadErrorTitle')}</AlertTitle>
			<AlertDescription>{outstandingFormsResponse.error.message}</AlertDescription>
		</Alert>
	{/if}

	{#if outstandingFormsResponse.isLoading && outstandingForms.length === 0}
		<LoadingState label="Loading feedback forms" />
	{:else if outstandingForms.length === 0}
		<div
			class="rounded-[1.1rem] border border-dashed border-border/80 bg-white px-4 py-8 text-center"
		>
			<MessageSquareTextIcon class="mx-auto mb-2 size-8 text-[#8b8fa0]" />
			<p class="type-body-bold text-foreground">{t('feedback.emptyTitle')}</p>
		</div>
	{:else}
		<div class="flex flex-col gap-3">
			{#each outstandingForms as item (item.formId + item.clubId)}
				<a
					href={routes.feedbackSubmit(item.formId, item.clubId)}
					class="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-white px-4 py-3 transition-colors hover:border-orange-200 hover:bg-orange-50"
					data-sveltekit-preload-code="hover"
					data-sveltekit-preload-data="hover"
				>
					<div class="min-w-0">
						<p class="truncate text-[1.05rem] font-bold text-[#44495f]">
							{t('feedback.cardTitle')
								.replace('{club}', item.clubName)
								.replace('{audience}', audienceLabel(item.audience))}
						</p>
					</div>
					<ChevronRightIcon class="size-5 shrink-0 text-[#8b8fa0]" />
				</a>
			{/each}
		</div>
	{/if}
</div>
