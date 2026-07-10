<script lang="ts">
	import { showGlobalSnackbar } from '$lib/components/app/snackbar';
	import { LoadingState } from '$lib/components/app';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { captureUnexpectedOperationalError } from '$lib/monitoring/capture';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { useConvexClient } from 'convex-svelte';

	const convexClient = useConvexClient();
	const applicationsResponse = useStableQuery(api.clubApplications.listReviewableApplications, {});
	let applications = $derived(applicationsResponse.data ?? []);
	let principlesScores = $state<Record<string, string>>({});
	let safetyScores = $state<Record<string, string>>({});
	let notes = $state<Record<string, string>>({});
	let pendingApplicationId = $state<string | null>(null);

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
		<h1 class="text-2xl font-bold text-gray-900">Club applications</h1>
		<p class="text-sm leading-6 text-gray-600">Assigned to you for peer review.</p>
	</div>

	{#if applicationsResponse.isLoading}
		<LoadingState label="Loading applications" />
	{:else if applicationsResponse.error}
		<p class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
			{applicationsResponse.error.message}
		</p>
	{:else if applications.length === 0}
		<p class="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">
			No applications are currently assigned to you for review.
		</p>
	{:else}
		<div class="grid gap-4">
			{#each applications as application (application._id)}
				<Card>
					<CardHeader>
						<CardTitle>{application.name}</CardTitle>
					</CardHeader>
					<CardContent class="flex flex-col gap-4">
						<div class="flex flex-col gap-1 text-sm leading-6 text-gray-600">
							{#if application.location}<p>{application.location}</p>{/if}
							{#if application.description}<p>{application.description}</p>{/if}
						</div>

						<div class="grid gap-3 sm:grid-cols-2">
							<label class="flex flex-col gap-1 text-sm text-gray-600">
								Guiding Principles alignment (0-10)
								<Input
									type="number"
									min="0"
									max="10"
									step="1"
									placeholder="0-10"
									value={principlesScores[application._id] ?? ''}
									oninput={(event) =>
										(principlesScores[application._id] = event.currentTarget.value)}
								/>
							</label>
							<label class="flex flex-col gap-1 text-sm text-gray-600">
								Safety (0-10)
								<Input
									type="number"
									min="0"
									max="10"
									step="1"
									placeholder="0-10"
									value={safetyScores[application._id] ?? ''}
									oninput={(event) => (safetyScores[application._id] = event.currentTarget.value)}
								/>
							</label>
						</div>
						<div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
							<Textarea
								placeholder="Required review note"
								value={notes[application._id] ?? ''}
								oninput={(event) => (notes[application._id] = event.currentTarget.value)}
							/>
							<Button
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
