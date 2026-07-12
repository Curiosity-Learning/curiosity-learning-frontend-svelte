<script lang="ts">
	import { showGlobalSnackbar } from '$lib/components/app/snackbar';
	import { EmptyState, LoadingState } from '$lib/components/app';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { FieldLabel } from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { captureUnexpectedOperationalError } from '$lib/monitoring/capture';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { useConvexClient } from 'convex-svelte';
	import { requestSignedMediaUrls } from '$lib/media/signed-media.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { _ } from '$lib/i18n';

	const convexClient = useConvexClient();
	const applicationsResponse = useStableQuery(api.clubApplications.listReviewableApplications, {});
	let applications = $derived(applicationsResponse.data ?? []);
	let principlesScores = $state<Record<string, string>>({});
	let safetyScores = $state<Record<string, string>>({});
	let notes = $state<Record<string, string>>({});
	let pendingApplicationId = $state<string | null>(null);
	// CL-710 CEO review item 2: the video is one of the most important parts of the application —
	// track per-card playback failures the same way clubs/[clubId]/+page.svelte does for club videos.
	let videoLoadFailedIds = $state<Record<string, boolean>>({});
	// CL-710 CEO review round 3 (Braga bug): application.videoUrl is a direct storage URL that
	// 403s once secure media delivery (CloudFront) is configured, because the bucket is then
	// private. Prefer a signed delivery URL fetched per-card via /api/media/refresh, falling back
	// to the direct URL (works in local dev, where the bucket is public) if signing isn't
	// available.
	let signedVideoUrlsById = $state<Record<string, string | null>>({});
	const requestedVideoAssetIds = new SvelteSet<string>();

	$effect(() => {
		for (const application of applications) {
			const assetId = application.videoMediaAssetId;
			if (!assetId || requestedVideoAssetIds.has(application._id)) continue;
			requestedVideoAssetIds.add(application._id);

			void (async () => {
				try {
					const assets = await requestSignedMediaUrls({
						assetIds: [assetId],
						context: { kind: 'club-application', applicationId: application._id }
					});
					signedVideoUrlsById[application._id] = assets[0]?.signedUrl ?? null;
				} catch {
					// Secure media delivery isn't configured (local dev) or the request failed — fall
					// back to application.videoUrl below rather than surfacing an error.
					signedVideoUrlsById[application._id] = null;
				}
			})();
		}
	});

	const videoUrlFor = (application: (typeof applications)[number]) =>
		signedVideoUrlsById[application._id] ?? application.videoUrl ?? null;

	const submitReview = async (applicationId: string) => {
		const principlesScore = Number(principlesScores[applicationId] ?? '');
		const safetyScore = Number(safetyScores[applicationId] ?? '');
		const note = notes[applicationId]?.trim() ?? '';
		pendingApplicationId = applicationId;
		try {
			await convexClient.mutation(api.clubApplications.upsertApplicationReview, {
				applicationId: applicationId as Id<'clubApplications'>,
				principlesScore,
				safetyScore,
				note
			});
			showGlobalSnackbar({ title: 'Review saved' });
		} catch (error) {
			captureUnexpectedOperationalError(error, {
				area: 'admin',
				operation: 'application-review:save',
				identifiers: { applicationId }
			});
			showGlobalSnackbar({
				title: 'Unable to save review',
				description: error instanceof Error ? error.message : 'Please try again.'
			});
		} finally {
			pendingApplicationId = null;
		}
	};
</script>

<div class="flex w-full flex-col gap-6 py-6">
	<div class="flex flex-col gap-2">
		<h1 class="type-h4-bold text-foreground">Club applications</h1>
		<p class="type-body text-muted-foreground">Assigned to you for peer review.</p>
	</div>

	{#if applicationsResponse.isLoading}
		<LoadingState label="Loading applications" />
	{:else if applicationsResponse.error}
		<Alert variant="destructive">
			<AlertDescription>{applicationsResponse.error.message}</AlertDescription>
		</Alert>
	{:else if applications.length === 0}
		<EmptyState title="No applications assigned" description="Nothing is currently waiting on your review." />
	{:else}
		<div class="grid gap-4">
			{#each applications as application (application._id)}
				<Card>
					<CardHeader>
						<CardTitle>{application.name}</CardTitle>
					</CardHeader>
					<CardContent class="flex flex-col gap-4">
						<div class="type-sm flex flex-col gap-1 text-muted-foreground">
							{#if application.location}<p>{application.location}</p>{/if}
							{#if application.description}<p>{application.description}</p>{/if}
						</div>

						<div class="flex flex-col gap-2">
							<FieldLabel>{$_('applicationChat.videoLabel')}</FieldLabel>
							{#if videoUrlFor(application) && !videoLoadFailedIds[application._id]}
								<div class="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-900">
									<!-- svelte-ignore a11y_media_has_caption -->
									<video
										src={videoUrlFor(application)}
										controls
										preload="metadata"
										class="h-56 w-full object-cover"
										onerror={() => {
											videoLoadFailedIds[application._id] = true;
										}}
									></video>
								</div>
							{:else}
								<p class="type-sm text-muted-foreground">{$_('applicationChat.videoUnavailable')}</p>
							{/if}
						</div>

						<div class="grid gap-3 sm:grid-cols-2">
							<div class="flex flex-col gap-2">
								<FieldLabel for={`principles-score-${application._id}`}>
									Guiding Principles alignment (0-10)
								</FieldLabel>
								<Input
									id={`principles-score-${application._id}`}
									type="number"
									min="0"
									max="10"
									step="1"
									placeholder="0-10"
									value={principlesScores[application._id] ?? ''}
									oninput={(event) =>
										(principlesScores[application._id] = event.currentTarget.value)}
								/>
							</div>
							<div class="flex flex-col gap-2">
								<FieldLabel for={`safety-score-${application._id}`}>Safety (0-10)</FieldLabel>
								<Input
									id={`safety-score-${application._id}`}
									type="number"
									min="0"
									max="10"
									step="1"
									placeholder="0-10"
									value={safetyScores[application._id] ?? ''}
									oninput={(event) => (safetyScores[application._id] = event.currentTarget.value)}
								/>
							</div>
						</div>
						<div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
							<div class="flex flex-col gap-2">
								<FieldLabel for={`review-note-${application._id}`} required>Review note</FieldLabel>
								<Textarea
									id={`review-note-${application._id}`}
									placeholder="Required review note"
									value={notes[application._id] ?? ''}
									oninput={(event) => (notes[application._id] = event.currentTarget.value)}
								/>
							</div>
							<Button
								class="self-end"
								disabled={pendingApplicationId === application._id}
								onclick={() => void submitReview(application._id)}
							>
								{pendingApplicationId === application._id ? 'Saving...' : 'Save'}
							</Button>
						</div>
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}
</div>
