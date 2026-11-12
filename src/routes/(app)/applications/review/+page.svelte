<script lang="ts">
	// The Guide's review queue (CL-709, reworked in CL-780). Everything a Guide reviews belongs to
	// one season, so the season and its scoring deadline sit at the top, once (Ron, 2026-11-11).
	// Applications are split into "To review" and "Reviewed"; reviewed ones stay reachable so the
	// score can be changed until scoring closes. Each card opens the application page, where the
	// video, the details and the scoring form live.
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import { api } from '$convex/_generated/api';
	import { EmptyState, LoadingState } from '$lib/components/app';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { formatShortDate } from '$lib/domain/date';
	import { _, formatT } from '$lib/i18n';
	import { routes } from '$lib/routes';

	const queueResponse = useStableQuery(api.clubApplications.getMyReviewQueue, {});
	let queue = $derived(queueResponse.data ?? null);
	let season = $derived(queue?.season ?? null);
	let hasAssignments = $derived(
		Boolean(queue && (queue.toReview.length > 0 || queue.reviewed.length > 0))
	);

	let seasonStatus = $derived.by(() => {
		if (!season) return '';
		const now = Date.now();
		if (season.isScoringOpen) {
			return formatT('applicationReviewList.scoringOpenUntil', {
				date: formatShortDate(season.reviewWindowClose)
			});
		}
		if (now < season.reviewWindowOpen) {
			return formatT('applicationReviewList.scoringOpensOn', {
				date: formatShortDate(season.reviewWindowOpen)
			});
		}
		return formatT('applicationReviewList.scoringClosedOn', {
			date: formatShortDate(season.reviewWindowClose)
		});
	});
</script>

{#snippet applicationCard(
	item: {
		applicationId: string;
		name: string;
		location: string | null;
		description: string | null;
		submittedAt: number;
		myScore: number | null;
	},
	action: string
)}
	<li>
		<a
			href={routes.applicationReviewDetail(item.applicationId)}
			data-sveltekit-preload-data="hover"
			class="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-white px-4 py-3 transition-colors hover:border-orange-200 hover:bg-orange-50"
		>
			<div class="flex min-w-0 flex-col gap-0.5">
				<p class="type-lead-bold truncate text-foreground">{item.name}</p>
				<p class="type-sm truncate text-muted-foreground">
					{formatShortDate(item.submittedAt)}
					{#if item.location}
						· {item.location}
					{/if}
					{#if item.myScore !== null}
						· {formatT('applicationReviewList.yourScore', { score: item.myScore.toFixed(1) })}
					{/if}
				</p>
				{#if item.description}
					<p class="type-sm line-clamp-2 text-muted-foreground">{item.description}</p>
				{/if}
			</div>
			<span class="type-sm-bold flex shrink-0 items-center gap-1 text-orange-600">
				{action}
				<ArrowRightIcon class="size-4" />
			</span>
		</a>
	</li>
{/snippet}

<div class="flex w-full flex-col gap-6 py-6">
	<div class="flex flex-col gap-2">
		<h1 class="type-h4-bold text-foreground">{$_('applicationReviewList.title')}</h1>
		{#if season}
			<p class="type-body text-foreground">
				<span class="type-body-bold">
					{formatT('applicationReviewList.seasonTitle', { season: season.name })}.
				</span>
				{seasonStatus}
			</p>
		{:else}
			<p class="type-body text-muted-foreground">{$_('applicationReviewList.subtitle')}</p>
		{/if}
	</div>

	{#if queueResponse.isLoading && !queue}
		<LoadingState label={$_('applicationReviewList.title')} />
	{:else if queueResponse.error}
		<Alert variant="destructive">
			<AlertDescription>{queueResponse.error.message}</AlertDescription>
		</Alert>
	{:else if !season}
		<EmptyState
			title={$_('applicationReviewList.noSeasonTitle')}
			description={$_('applicationReviewList.noSeasonDescription')}
		/>
	{:else}
		<div
			class="flex flex-col gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4 sm:flex-row sm:items-center sm:justify-between"
		>
			<div class="flex min-w-0 items-start gap-3">
				<BookOpenIcon class="mt-0.5 size-5 shrink-0 text-orange-600" />
				<div class="flex flex-col gap-0.5">
					<p class="type-lead-bold text-foreground">{$_('applicationReviewList.guideTitle')}</p>
					<p class="type-sm text-muted-foreground">
						{$_('applicationReviewList.guideDescription')}
					</p>
				</div>
			</div>
			<Button href={routes.applicationReviewGuide} variant="outline" class="h-9 shrink-0 px-3">
				{$_('applicationReviewList.guideLink')}
			</Button>
		</div>

		{#if !hasAssignments && queue}
			<EmptyState
				title={$_('applicationReviewList.emptyTitle')}
				description={$_('applicationReviewList.emptyDescription')}
			/>
		{:else if queue}
			<section class="flex flex-col gap-3">
				<h2 class="type-h6-bold text-foreground">
					{formatT('applicationReviewList.toReviewTitle', { count: queue.toReview.length })}
				</h2>
				{#if queue.toReview.length === 0}
					<p class="type-sm text-muted-foreground">{$_('applicationReviewList.allDone')}</p>
				{:else}
					<ul class="grid gap-3">
						{#each queue.toReview as item (item.applicationId)}
							{@render applicationCard(
								item,
								season.isScoringOpen
									? $_('applicationReviewList.reviewLink')
									: $_('applicationReviewList.viewLink')
							)}
						{/each}
					</ul>
				{/if}
			</section>

			{#if queue.reviewed.length > 0}
				<section class="flex flex-col gap-3">
					<h2 class="type-h6-bold text-foreground">
						{formatT('applicationReviewList.reviewedTitle', { count: queue.reviewed.length })}
					</h2>
					<ul class="grid gap-3">
						{#each queue.reviewed as item (item.applicationId)}
							{@render applicationCard(
								item,
								season.isScoringOpen && item.status === 'pending'
									? $_('applicationReviewList.editLink')
									: $_('applicationReviewList.viewLink')
							)}
						{/each}
					</ul>
				</section>
			{/if}
		{/if}
	{/if}
</div>
