<script lang="ts">
	// Application detail: the one place (in the member app) to look at a club application —
	// reached from the reviewer's "Applications for you to review" list, from the chat context
	// banner on the application chat, and from the applicant's own no-club card. The backing
	// query (clubApplications.getApplication) decides what the viewer may see: the applicant gets
	// their own details and video, reviewers/assigned Guides/admins also get scores, notes,
	// assigned reviewers, and the decision. Scoring lives here too (moved off the list page so it
	// has one home), prefilled from the viewer's own review so scores can be revisited.
	import { api } from '$convex/_generated/api';
	import {
		ApplicationVideo,
		EmptyState,
		LoadingState,
		PageHeaderBackButton,
		PageHeaderTitle,
		Section,
		showGlobalSnackbar
	} from '$lib/components/app';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { FieldLabel } from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { formatShortDate } from '$lib/domain/date';
	import { _, formatT } from '$lib/i18n';
	import { captureUnexpectedOperationalError } from '$lib/monitoring/capture';
	import { routes } from '$lib/routes';
	import { useConvexClient } from 'convex-svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const convexClient = useConvexClient();
	const applicationResponse = useStableQuery(api.clubApplications.getApplication, () => ({
		applicationId: data.applicationId
	}));
	let application = $derived(
		applicationResponse.data?.applicationId === data.applicationId ? applicationResponse.data : null
	);
	let headerTitle = $derived(application?.name ?? $_('applicationDetail.title'));

	const statusLabel = (status: string) => $_(`applicationStatus.${status}Label`);
	const scoreText = (score: number | null) => (score === null ? '–' : String(score));

	// --- Review form (assigned or reviewing Guide, while the application is still pending) ---
	let principlesScore = $state('');
	let safetyScore = $state('');
	let note = $state('');
	let prefilledFor = $state<string | null>(null);
	let savePending = $state(false);

	let canScore = $derived(
		application?.status === 'pending' &&
			application.viewer.role === 'reviewer' &&
			(application.viewer.isAssigned || application.viewer.hasReviewed)
	);

	$effect(() => {
		// Prefill once per application from the viewer's own review; never clobber in-progress edits.
		if (!application || prefilledFor === application.applicationId) return;
		prefilledFor = application.applicationId;
		principlesScore =
			application.myReview?.principlesScore === null ||
			application.myReview?.principlesScore === undefined
				? ''
				: String(application.myReview.principlesScore);
		safetyScore =
			application.myReview?.safetyScore === null || application.myReview?.safetyScore === undefined
				? ''
				: String(application.myReview.safetyScore);
		note = application.myReview?.note ?? '';
	});

	const parseScore = (value: string) => {
		const trimmed = value.trim();
		if (!/^\d+$/.test(trimmed)) return null;
		const parsed = Number(trimmed);
		return parsed >= 0 && parsed <= 10 ? parsed : null;
	};
	let parsedPrinciples = $derived(parseScore(principlesScore));
	let parsedSafety = $derived(parseScore(safetyScore));
	let canSave = $derived(
		parsedPrinciples !== null && parsedSafety !== null && note.trim().length > 0 && !savePending
	);

	const saveReview = async () => {
		if (!application || parsedPrinciples === null || parsedSafety === null) return;
		savePending = true;
		try {
			await convexClient.mutation(api.clubApplications.upsertApplicationReview, {
				applicationId: application.applicationId,
				principlesScore: parsedPrinciples,
				safetyScore: parsedSafety,
				note: note.trim()
			});
			showGlobalSnackbar({ title: $_('applicationDetail.reviewSaved') });
		} catch (error) {
			captureUnexpectedOperationalError(error, {
				area: 'admin',
				operation: 'application-review:save',
				identifiers: { applicationId: application.applicationId }
			});
			showGlobalSnackbar({
				title: $_('applicationDetail.reviewSaveFailure'),
				description: error instanceof Error ? error.message : 'Please try again.'
			});
		} finally {
			savePending = false;
		}
	};
</script>

<PageHeaderTitle title={headerTitle} />
<PageHeaderBackButton fallbackHref={routes.applicationsReview} />

<div class="flex w-full flex-col gap-4 py-6">
	{#if applicationResponse.isLoading && !application}
		<LoadingState label={$_('applicationDetail.title')} />
	{:else if applicationResponse.error}
		<Alert variant="destructive">
			<AlertDescription>{applicationResponse.error.message}</AlertDescription>
		</Alert>
	{:else if !application}
		<EmptyState
			title={$_('applicationDetail.notFoundTitle')}
			description={$_('applicationDetail.notFoundDescription')}
		/>
	{:else}
		<div class="flex flex-col gap-2">
			<div class="flex flex-wrap items-center gap-2">
				<h1 class="type-h4-bold text-foreground">{application.name}</h1>
				<Badge variant="secondary">{statusLabel(application.status)}</Badge>
			</div>
			<p class="type-sm text-muted-foreground">
				{formatT('applicationDetail.submittedOn', {
					date: formatShortDate(application.createdAt)
				})}
				{#if application.location}
					· {application.location}
				{/if}
			</p>
			<div class="flex flex-wrap gap-2">
				{#if application.roomId}
					<Button
						href={`${routes.chat}?room=${application.roomId}`}
						variant="outline"
						class="h-9 px-3"
					>
						{$_('applicationDetail.openChat')}
					</Button>
				{/if}
				{#if application.createdClubId}
					<Button
						href={routes.clubHome(application.createdClubId)}
						variant="outline"
						class="h-9 px-3"
					>
						{$_('applicationDetail.openClub')}
					</Button>
				{/if}
			</div>
		</div>

		<ApplicationVideo
			applicationId={application.applicationId}
			videoMediaAssetId={application.videoMediaAssetId}
			fallbackUrl={application.videoUrl}
			label={$_('applicationChat.videoLabel')}
			emptyText={$_('applicationChat.videoUnavailable')}
			videoClass="h-56 w-full object-cover sm:h-72"
		/>

		<Section title={$_('applicationDetail.detailsTitle')}>
			<dl class="grid gap-3 sm:grid-cols-2">
				<div class="flex flex-col gap-0.5">
					<dt class="type-sm text-muted-foreground">{$_('applicationDetail.applicantLabel')}</dt>
					<dd class="type-body text-foreground">
						{#if application.viewer.role === 'applicant'}
							{application.applicant.name}
						{:else}
							<a
								href={routes.profileDetail(application.applicant.profileId)}
								class="type-link text-orange-600 hover:underline"
							>
								{application.applicant.name}
							</a>
						{/if}
						{#if application.applicant.username}
							<span class="type-sm text-muted-foreground">@{application.applicant.username}</span>
						{/if}
					</dd>
				</div>
				{#if application.location}
					<div class="flex flex-col gap-0.5">
						<dt class="type-sm text-muted-foreground">{$_('applicationDetail.locationLabel')}</dt>
						<dd class="type-body text-foreground">{application.location}</dd>
					</div>
				{/if}
				{#if application.applicantRole}
					<div class="flex flex-col gap-0.5">
						<dt class="type-sm text-muted-foreground">
							{$_('applicationDetail.applicantRoleLabel')}
						</dt>
						<dd class="type-body text-foreground">{application.applicantRole}</dd>
					</div>
				{/if}
				{#if application.referralSource}
					<div class="flex flex-col gap-0.5">
						<dt class="type-sm text-muted-foreground">{$_('applicationDetail.referralLabel')}</dt>
						<dd class="type-body text-foreground">
							{application.referralSource}
							{#if application.referralOther}
								({application.referralOther})
							{/if}
						</dd>
					</div>
				{/if}
				{#if application.clubName && application.createdClubId}
					<div class="flex flex-col gap-0.5">
						<dt class="type-sm text-muted-foreground">{$_('applicationDetail.clubLabel')}</dt>
						<dd class="type-body text-foreground">
							<a
								href={routes.clubHome(application.createdClubId)}
								class="type-link text-orange-600 hover:underline"
							>
								{application.clubName}
							</a>
						</dd>
					</div>
				{/if}
			</dl>
			{#if application.description}
				<div class="flex flex-col gap-1 border-t border-border/60 pt-3">
					<p class="type-sm text-muted-foreground">{$_('applicationDetail.descriptionLabel')}</p>
					<p class="type-body whitespace-pre-line text-foreground">{application.description}</p>
				</div>
			{/if}
		</Section>

		{#if canScore}
			<Section
				title={$_('applicationDetail.reviewFormTitle')}
				description={$_('applicationDetail.reviewFormDescription')}
			>
				<div class="grid gap-3 sm:grid-cols-2">
					<div class="flex flex-col gap-2">
						<FieldLabel for="principles-score" required>
							{$_('applicationDetail.principlesScoreLabel')}
						</FieldLabel>
						<Input
							id="principles-score"
							type="number"
							inputmode="numeric"
							min="0"
							max="10"
							step="1"
							placeholder="0-10"
							bind:value={principlesScore}
							aria-invalid={principlesScore !== '' && parsedPrinciples === null}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<FieldLabel for="safety-score" required>
							{$_('applicationDetail.safetyScoreLabel')}
						</FieldLabel>
						<Input
							id="safety-score"
							type="number"
							inputmode="numeric"
							min="0"
							max="10"
							step="1"
							placeholder="0-10"
							bind:value={safetyScore}
							aria-invalid={safetyScore !== '' && parsedSafety === null}
						/>
					</div>
				</div>
				<div class="flex flex-col gap-2">
					<FieldLabel for="review-note" required>{$_('applicationDetail.noteLabel')}</FieldLabel>
					<Textarea
						id="review-note"
						placeholder={$_('applicationDetail.notePlaceholder')}
						bind:value={note}
					/>
				</div>
				<div class="flex justify-end">
					<Button disabled={!canSave} onclick={() => void saveReview()}>
						{savePending
							? $_('applicationDetail.savingReview')
							: $_('applicationDetail.saveReview')}
					</Button>
				</div>
			</Section>
		{/if}

		{#if application.review}
			<Section title={$_('applicationDetail.reviewsTitle')}>
				{#if application.review.reviews.length === 0}
					<p class="type-sm text-muted-foreground">{$_('applicationDetail.reviewsEmpty')}</p>
				{:else}
					<ul class="flex flex-col divide-y divide-border/60">
						{#each application.review.reviews as review (review.reviewId)}
							<li class="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
								<div class="flex flex-wrap items-baseline justify-between gap-2">
									<p class="type-lead-bold text-foreground">{review.reviewerName}</p>
									<p class="type-sm text-muted-foreground tabular-nums">
										{formatShortDate(review.createdAt)}
									</p>
								</div>
								<p class="type-sm text-muted-foreground tabular-nums">
									{$_('applicationDetail.averageScoreLabel')}
									<span class="type-sm-bold text-foreground">{review.score.toFixed(1)}</span>
									· {$_('applicationDetail.principlesShort')}
									{scoreText(review.principlesScore)}
									· {$_('applicationDetail.safetyShort')}
									{scoreText(review.safetyScore)}
								</p>
								<p class="type-body whitespace-pre-line text-foreground">{review.note}</p>
							</li>
						{/each}
					</ul>
				{/if}
			</Section>

			<Section title={$_('applicationDetail.assignedReviewersTitle')} compact>
				{#if application.review.assignedReviewers.length === 0}
					<p class="type-sm text-muted-foreground">
						{$_('applicationDetail.assignedReviewersEmpty')}
					</p>
				{:else}
					<ul class="flex flex-col gap-2">
						{#each application.review.assignedReviewers as reviewer (reviewer.profileId)}
							<li class="flex items-center justify-between gap-3">
								<a
									href={routes.profileDetail(reviewer.profileId)}
									class="type-body truncate text-foreground hover:underline"
								>
									{reviewer.name}
								</a>
								<Badge variant={reviewer.hasReviewed ? 'default' : 'outline'} size="sm">
									{reviewer.hasReviewed
										? $_('applicationDetail.reviewedBadge')
										: $_('applicationDetail.pendingReviewBadge')}
								</Badge>
							</li>
						{/each}
					</ul>
				{/if}
			</Section>

			{#if application.decidedAt || application.review.adminFollowUpFlag}
				<Section title={$_('applicationDetail.decisionTitle')} compact>
					<dl class="grid gap-3 sm:grid-cols-2">
						{#if application.decidedAt}
							<div class="flex flex-col gap-0.5">
								<dt class="type-sm text-muted-foreground">
									{$_('applicationDetail.decidedAtLabel')}
								</dt>
								<dd class="type-body text-foreground">
									{statusLabel(application.status)} · {formatShortDate(application.decidedAt)}
								</dd>
							</div>
						{/if}
						{#if application.review.decidedByName}
							<div class="flex flex-col gap-0.5">
								<dt class="type-sm text-muted-foreground">
									{$_('applicationDetail.decidedByLabel')}
								</dt>
								<dd class="type-body text-foreground">{application.review.decidedByName}</dd>
							</div>
						{/if}
						{#if application.rejectionNote}
							<div class="flex flex-col gap-0.5 sm:col-span-2">
								<dt class="type-sm text-muted-foreground">
									{$_('applicationDetail.rejectionNoteLabel')}
								</dt>
								<dd class="type-body whitespace-pre-line text-foreground">
									{application.rejectionNote}
								</dd>
							</div>
						{/if}
						{#if application.review.adminFollowUpFlag}
							<div class="flex flex-col gap-0.5 sm:col-span-2">
								<dt class="type-sm text-muted-foreground">
									{$_('applicationDetail.followUpFlagLabel')}
								</dt>
								<dd class="type-body text-foreground">
									{application.review.adminFollowUpFlag.reason}
								</dd>
							</div>
						{/if}
					</dl>
				</Section>
			{/if}
		{/if}
	{/if}
</div>
