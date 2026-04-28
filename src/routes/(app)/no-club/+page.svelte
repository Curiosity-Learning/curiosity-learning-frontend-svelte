<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { LoadingState } from '$lib/components/app';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { api } from '$convex/_generated/api';
	import { routes } from '$lib/routes';

	const applicationsResponse = useStableQuery(api.clubApplications.listMyApplications, {});
	let applications = $derived(applicationsResponse.data ?? []);
	let latestApplication = $derived(applications[0] ?? null);
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
	<div class="flex flex-col gap-2">
		<h1 class="text-2xl font-bold text-gray-900">No active club yet</h1>
		<p class="text-sm leading-6 text-gray-600">
			Join an existing Curiosity Club or submit an application to start one.
		</p>
	</div>

	<div class="grid gap-3 sm:grid-cols-2">
		<Button href={routes.onboardingJoinClub} size="xl" class="h-12">Join a club</Button>
		<Button href={routes.onboardingStartClub} variant="outline" size="xl" class="h-12">
			Start a club
		</Button>
	</div>

	<Card>
		<CardHeader>
			<CardTitle>Club application</CardTitle>
		</CardHeader>
		<CardContent class="flex flex-col gap-3">
			{#if applicationsResponse.isLoading}
				<LoadingState variant="inline" size="sm" label="Loading your applications" />
			{:else if latestApplication}
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0">
						<p class="font-semibold text-gray-900">{latestApplication.name}</p>
						{#if latestApplication.location}
							<p class="text-sm text-gray-600">{latestApplication.location}</p>
						{/if}
					</div>
					<Badge variant="outline">
						{latestApplication.status === 'finalized' ? 'Finalized' : 'Pending review'}
					</Badge>
				</div>
				<p class="text-sm leading-6 text-gray-600">
					Your application is being reviewed by existing Guides. We will unlock your club here when
					it is finalized.
				</p>
			{:else}
				<p class="text-sm leading-6 text-gray-600">
					You have not submitted a Start Club application yet.
				</p>
			{/if}
		</CardContent>
	</Card>
</div>
