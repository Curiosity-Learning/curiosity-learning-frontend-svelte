<script lang="ts">
	// Application detail: the one place (in the member app) to look at a club application —
	// reached from the reviewer's queue, from the chat context banner on the application chat, and
	// from the applicant's own no-club card. The backing query (clubApplications.getApplication)
	// decides what the viewer may see.
	//
	// CL-780 (Ron, 2026-11-11):
	//   - Applicant: their status, their own application and video, and the chat. Nothing about
	//     reviews or reviewers.
	//   - Reviewer: the video and the application next to the scoring form (three 1-5 scores from
	//     the review guide, plus what to clarify in the interview). Prefilled from their own review
	//     so it can be changed until scoring closes. Global admins see exactly this too; reviews,
	//     the reviewer roster and seasons are admin-portal things.
	import { api } from '$convex/_generated/api';
	import {
		ApplicationVideo,
		EmptyState,
		LoadingState,
		PageHeaderBackButton,
		PageHeaderTitle,
		ReviewScoreInput,
		Section,
		showGlobalSnackbar
	} from '$lib/components/app';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { FieldLabel } from '$lib/components/ui/field';
	import { Textarea } from '$lib/components/ui/textarea';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { reviewGuide, type ReviewDimensionKey } from '$lib/domain/application-review-guide';
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
	// The backend refuses outsiders with a ConvexError; show that one as plain copy rather than
	// the raw "[CONVEX Q(...)] Server Error ..." string.
	let errorMessage = $derived.by(() => {
		const message = applicationResponse.error?.message ?? '';
		if (!message) return '';
		return message.includes('You cannot access this application')
			? $_('applicationDetail.noAccess')
			: message;
	});

	const statusLabel = (status: string) => $_(`applicationStatus.${status}Label`);
	const statusDescription = (status: string) => $_(`applicationStatus.${status}Description`);

	let isApplicant = $derived(application?.viewer.role === 'applicant');
	let submittedAt = $derived(application ? (application.submittedAt ?? application.createdAt) : 0);

	// --- Review form ---
	// Scoring follows the application's own review season: the form only shows while that
	// season's scoring window is open (CL-778), and only to a Guide assigned to it (or one who
	// already reviewed it).
	let canScore = $derived(
		application?.status === 'pending' &&
			application.reviewWindowOpen &&
			application.viewer.role === 'reviewer' &&
			(application.viewer.isAssigned || application.viewer.hasReviewed)
	);
	let scores = $state<Record<ReviewDimensionKey, number | null>>({
		alignment: null,
		motivation: null,
		readiness: null
	});
	let note = $state('');
	let prefilledFor = $state<string | null>(null);
	let savePending = $state(false);

	$effect(() => {
		// Prefill once per application from the viewer's own review; never clobber in-progress edits.
		if (!application || prefilledFor === application.applicationId) return;
		prefilledFor = application.applicationId;
		scores = {
			alignment: application.myReview?.alignmentScore ?? null,
			motivation: application.myReview?.motivationScore ?? null,
			readiness: application.myReview?.readinessScore ?? null
		};
		note = application.myReview?.note ?? '';
	});

	// A review saved before CL-780 has only the old 0-10 pair: it shows as "not scored yet" here.
	let hasLegacyReview = $derived(
		Boolean(application?.myReview && application.myReview.alignmentScore === null)
	);
	let hasCurrentReview = $derived(Boolean(application?.myReview && !hasLegacyReview));
	let canSave = $derived(
		scores.alignment !== null &&
			scores.motivation !== null &&
			scores.readiness !== null &&
			!savePending
	);

	const saveReview = async () => {
		if (
			!application ||
			scores.alignment === null ||
			scores.motivation === null ||
			scores.readiness === null
		) {
			return;
		}
		savePending = true;
		try {
			await convexClient.mutation(api.clubApplications.upsertApplicationReview, {
				applicationId: application.applicationId,
				alignmentScore: scores.alignment,
				motivationScore: scores.motivation,
				readinessScore: scores.readiness,
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

{#snippet applicationDetails(app: NonNullable<typeof application>)}
	<Section
		title={isApplicant
			? $_('applicationDetail.yourApplicationTitle')
			: $_('applicationDetail.detailsTitle')}
	>
		{#if app.description}
			<div class="flex flex-col gap-1">
				<p class="type-sm text-muted-foreground">
					{isApplicant
						? $_('applicationDetail.ownDescriptionLabel')
						: $_('applicationDetail.descriptionLabel')}
				</p>
				<p class="type-body whitespace-pre-line text-foreground">{app.description}</p>
			</div>
		{/if}
		<dl class="grid gap-3 sm:grid-cols-2">
			{#if !isApplicant}
				<div class="flex flex-col gap-0.5">
					<dt class="type-sm text-muted-foreground">{$_('applicationDetail.applicantLabel')}</dt>
					<dd class="type-body text-foreground">
						<a
							href={routes.profileDetail(app.applicant.profileId)}
							class="type-link text-orange-600 hover:underline"
						>
							{app.applicant.name}
						</a>
						{#if app.applicant.username}
							<span class="type-sm text-muted-foreground">@{app.applicant.username}</span>
						{/if}
					</dd>
				</div>
			{/if}
			{#if app.location}
				<div class="flex flex-col gap-0.5">
					<dt class="type-sm text-muted-foreground">{$_('applicationDetail.locationLabel')}</dt>
					<dd class="type-body text-foreground">{app.location}</dd>
				</div>
			{/if}
			{#if app.applicantRole}
				<div class="flex flex-col gap-0.5">
					<dt class="type-sm text-muted-foreground">
						{$_('applicationDetail.applicantRoleLabel')}
					</dt>
					<dd class="type-body text-foreground">{app.applicantRole}</dd>
				</div>
			{/if}
		</dl>
	</Section>
{/snippet}

{#snippet video(app: NonNullable<typeof application>)}
	<ApplicationVideo
		applicationId={app.applicationId}
		videoMediaAssetId={app.videoMediaAssetId}
		fallbackUrl={app.videoUrl}
		label={$_('applicationChat.videoLabel')}
		emptyText={$_('applicationChat.videoUnavailable')}
		videoClass="h-56 w-full object-cover sm:h-72"
	/>
{/snippet}

<div class="flex w-full flex-col gap-4 py-6">
	{#if applicationResponse.isLoading && !application}
		<LoadingState label={$_('applicationDetail.title')} />
	{:else if applicationResponse.error}
		<Alert variant="destructive">
			<AlertDescription>{errorMessage}</AlertDescription>
		</Alert>
	{:else if !application}
		<EmptyState
			title={$_('applicationDetail.notFoundTitle')}
			description={$_('applicationDetail.notFoundDescription')}
		/>
	{:else}
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="flex min-w-0 flex-col gap-1">
				<h1 class="type-h4-bold text-foreground">{application.name}</h1>
				<p class="type-sm text-muted-foreground">
					{formatT('applicationDetail.submittedOn', { date: formatShortDate(submittedAt) })}
					{#if application.location}
						· {application.location}
					{/if}
				</p>
			</div>
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

		{#if isApplicant}
			<!-- Applicant: where things stand, then their own application. -->
			<Section title={$_('applicationDetail.statusTitle')} compact>
				<div class="flex flex-col gap-1">
					<div>
						<Badge variant="secondary">{statusLabel(application.status)}</Badge>
					</div>
					<p class="type-body text-foreground">{statusDescription(application.status)}</p>
					{#if application.rejectionNote}
						<p class="type-body whitespace-pre-line text-muted-foreground">
							{application.rejectionNote}
						</p>
					{/if}
				</div>
			</Section>
			{@render video(application)}
			{@render applicationDetails(application)}
		{:else}
			<div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
				<div class="flex min-w-0 flex-col gap-4">
					{@render video(application)}
					{@render applicationDetails(application)}
				</div>

				<div class="flex flex-col gap-4 lg:sticky lg:top-4">
					{#if canScore}
						<Section
							title={$_('applicationDetail.reviewFormTitle')}
							description={$_('applicationDetail.reviewFormDescription')}
						>
							{#if hasLegacyReview}
								<p class="type-sm rounded-lg bg-gray-50 p-3 text-muted-foreground">
									{$_('applicationDetail.legacyReviewHint')}
								</p>
							{/if}
							{#each reviewGuide.dimensions as dimension (dimension.key)}
								<ReviewScoreInput
									{dimension}
									bind:value={scores[dimension.key]}
									disabled={savePending}
								/>
							{/each}
							<div class="flex flex-col gap-2">
								<FieldLabel for="review-note">{$_('applicationDetail.noteLabel')}</FieldLabel>
								<p class="type-sm text-muted-foreground">{$_('applicationDetail.noteHint')}</p>
								<Textarea
									id="review-note"
									placeholder={$_('applicationDetail.notePlaceholder')}
									bind:value={note}
								/>
							</div>
							<div class="flex items-center justify-between gap-3">
								<a
									href={routes.applicationReviewGuide}
									class="type-link-sm text-orange-600 hover:underline"
								>
									{$_('applicationDetail.reviewGuideLink')}
								</a>
								<Button disabled={!canSave} onclick={() => void saveReview()}>
									{#if savePending}
										{$_('applicationDetail.savingReview')}
									{:else if hasCurrentReview}
										{$_('applicationDetail.updateReview')}
									{:else}
										{$_('applicationDetail.saveReview')}
									{/if}
								</Button>
							</div>
						</Section>
					{:else if application.viewer.role === 'reviewer'}
						<!-- Scoring closed (or the application moved on): the reviewer's own review,
						read-only. Only their own — other reviewers' scores are admin-portal only. -->
						<Section title={$_('applicationDetail.reviewFormTitle')} compact>
							<p class="type-sm text-muted-foreground">
								{$_('applicationDetail.scoringClosed')}
							</p>
							{#if hasCurrentReview && application.myReview}
								<dl class="grid grid-cols-3 gap-2">
									{#each reviewGuide.dimensions as dimension (dimension.key)}
										<div class="flex flex-col gap-0.5">
											<dt class="type-sm text-muted-foreground">{dimension.title}</dt>
											<dd class="type-lead-bold text-foreground tabular-nums">
												{scores[dimension.key] ?? '–'}
											</dd>
										</div>
									{/each}
								</dl>
								{#if application.myReview.note}
									<div class="flex flex-col gap-0.5">
										<p class="type-sm text-muted-foreground">
											{$_('applicationDetail.noteLabel')}
										</p>
										<p class="type-body whitespace-pre-line text-foreground">
											{application.myReview.note}
										</p>
									</div>
								{/if}
							{/if}
						</Section>
					{/if}

					{#if application.decision && (application.decidedAt || application.decision.adminFollowUpFlag)}
						<Section title={$_('applicationDetail.decisionTitle')} compact>
							<dl class="grid gap-3">
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
								{#if application.decision.decidedByName}
									<div class="flex flex-col gap-0.5">
										<dt class="type-sm text-muted-foreground">
											{$_('applicationDetail.decidedByLabel')}
										</dt>
										<dd class="type-body text-foreground">{application.decision.decidedByName}</dd>
									</div>
								{/if}
								{#if application.rejectionNote}
									<div class="flex flex-col gap-0.5">
										<dt class="type-sm text-muted-foreground">
											{$_('applicationDetail.rejectionNoteLabel')}
										</dt>
										<dd class="type-body whitespace-pre-line text-foreground">
											{application.rejectionNote}
										</dd>
									</div>
								{/if}
								{#if application.decision.adminFollowUpFlag}
									<div class="flex flex-col gap-0.5">
										<dt class="type-sm text-muted-foreground">
											{$_('applicationDetail.followUpFlagLabel')}
										</dt>
										<dd class="type-body text-foreground">
											{application.decision.adminFollowUpFlag.reason}
										</dd>
									</div>
								{/if}
							</dl>
						</Section>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</div>
