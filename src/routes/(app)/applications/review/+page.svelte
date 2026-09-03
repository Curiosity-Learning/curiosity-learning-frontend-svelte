<script lang="ts">
	// The Guide's peer-review queue (CL-709): applications assigned to them that they haven't
	// scored yet. Each card links to the application detail page, which is where the video,
	// the full details, and the scoring form live.
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import { api } from '$convex/_generated/api';
	import { EmptyState, LoadingState } from '$lib/components/app';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { formatShortDate } from '$lib/domain/date';
	import { _ } from '$lib/i18n';
	import { routes } from '$lib/routes';

	const applicationsResponse = useStableQuery(api.clubApplications.listReviewableApplications, {});
	let applications = $derived(applicationsResponse.data ?? []);
	// Outside a season's review window Guides aren't asked to score (the detail page hides the
	// form), so the card's call to action is just "View application".
	const reviewWindowResponse = useStableQuery(api.reviewAssignmentModel.getReviewWindowState, {});
	let reviewWindowOpen = $derived(reviewWindowResponse.data?.open ?? false);
</script>

<div class="flex w-full flex-col gap-6 py-6">
	<div class="flex flex-col gap-2">
		<h1 class="type-h4-bold text-foreground">{$_('applicationReviewList.title')}</h1>
		<p class="type-body text-muted-foreground">{$_('applicationReviewList.subtitle')}</p>
	</div>

	{#if applicationsResponse.isLoading}
		<LoadingState label={$_('applicationReviewList.title')} />
	{:else if applicationsResponse.error}
		<Alert variant="destructive">
			<AlertDescription>{applicationsResponse.error.message}</AlertDescription>
		</Alert>
	{:else if applications.length === 0}
		<EmptyState
			title={$_('applicationReviewList.emptyTitle')}
			description={$_('applicationReviewList.emptyDescription')}
		/>
	{:else}
		<ul class="grid gap-3">
			{#each applications as application (application._id)}
				<li>
					<a
						href={routes.applicationReviewDetail(application._id)}
						data-sveltekit-preload-data="hover"
						class="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-white px-4 py-3 transition-colors hover:border-orange-200 hover:bg-orange-50"
					>
						<div class="flex min-w-0 flex-col gap-0.5">
							<p class="type-lead-bold truncate text-foreground">{application.name}</p>
							<p class="type-sm truncate text-muted-foreground">
								{formatShortDate(application.createdAt)}
								{#if application.location}
									· {application.location}
								{/if}
							</p>
							{#if application.description}
								<p class="type-sm line-clamp-2 text-muted-foreground">{application.description}</p>
							{/if}
						</div>
						<span class="type-sm-bold flex shrink-0 items-center gap-1 text-orange-600">
							{reviewWindowOpen
								? $_('applicationReviewList.reviewLink')
								: $_('chatContext.viewApplication')}
							<ArrowRightIcon class="size-4" />
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
