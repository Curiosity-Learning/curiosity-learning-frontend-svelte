<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ClipboardCheckIcon from '@lucide/svelte/icons/clipboard-check';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import RocketIcon from '@lucide/svelte/icons/rocket';
	import UsersRoundIcon from '@lucide/svelte/icons/users-round';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardDescription, CardTitle } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { LoadingState, PageHeaderTitle } from '$lib/components/app';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { api } from '$convex/_generated/api';
	import { routes } from '$lib/routes';
	import myClubImage from '$lib/assets/images/my_club.png';

	const applicationsResponse = useStableQuery(api.clubApplications.listMyApplications, {});
	let applications = $derived(applicationsResponse.data ?? []);
	const applicationStatusLabel = (status: string) =>
		status === 'finalized'
			? 'Finalized'
			: status === 'incomplete'
				? 'Incomplete'
				: 'Pending review';
	const applicationDateLabel = (timestamp: number | undefined) => {
		if (!timestamp) return null;
		return new Date(timestamp).toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	};
</script>

<PageHeaderTitle title="New club" />

<div class="flex w-full flex-col gap-4 py-4">
	<section
		class="grid overflow-hidden rounded-2xl border border-border/70 bg-white lg:grid-cols-[minmax(0,1fr)_18rem]"
	>
		<div class="flex flex-col justify-center gap-6 p-5 sm:p-6 lg:p-8">
			<div class="flex flex-col gap-3">
				<Badge class="w-fit rounded-full bg-orange-50 px-3 py-1 text-orange-600 hover:bg-orange-50">
					No active club
				</Badge>
				<div class="flex flex-col gap-2">
					<h1 class="type-h1 text-[#262626]">Pick your next Curiosity Club</h1>
					<p class="type-lead max-w-2xl text-[#545766]">
						Join an existing club or send in an application to start a new club for your community.
					</p>
				</div>
			</div>

			<div class="grid gap-3 sm:grid-cols-2">
				<Button href={routes.newClubJoin} size="xl" class="h-12 justify-between px-4">
					<span class="inline-flex items-center gap-2">
						<UsersRoundIcon class="size-5" />
						Join a club
					</span>
					<ArrowRightIcon class="size-4" />
				</Button>
				<Button
					href={routes.newClubStart}
					variant="outline"
					size="xl"
					class="h-12 justify-between px-4"
				>
					<span class="inline-flex items-center gap-2">
						<RocketIcon class="size-5" />
						Start a club
					</span>
					<ArrowRightIcon class="size-4" />
				</Button>
			</div>
		</div>

		<div class="hidden items-end justify-center bg-[#f8ecdf] px-6 pt-6 lg:flex">
			<img src={myClubImage} alt="" class="h-auto w-full max-w-[15rem] object-contain" />
		</div>
	</section>

	<div>
		<Card class="gap-4 p-5">
			<div class="flex items-center gap-3">
				<div
					class="flex size-11 items-center justify-center rounded-xl bg-orange-50 text-orange-500"
				>
					<ClipboardCheckIcon class="size-5" />
				</div>
				<div class="min-w-0">
					<CardTitle>Applications</CardTitle>
					<CardDescription>Your Start Club requests</CardDescription>
				</div>
			</div>
			<div class="flex flex-col gap-3">
				{#if applicationsResponse.isLoading}
					<LoadingState variant="inline" size="sm" label="Loading your applications" />
				{:else if applications.length > 0}
					<div class="flex flex-col divide-y divide-border/70">
						{#each applications as application (application._id)}
							<div class="py-3 first:pt-0 last:pb-0">
								<div class="flex items-start justify-between gap-3">
									<div class="min-w-0">
										<p class="type-body-bold truncate text-gray-900">{application.name}</p>
										{#if application.location}
											<p class="type-sm flex items-center gap-1 text-gray-600">
												<MapPinIcon class="size-3.5 shrink-0" />
												<span class="truncate">{application.location}</span>
											</p>
										{/if}
										{#if applicationDateLabel(application.createdAt)}
											<p class="type-sm text-gray-500">
												Submitted {applicationDateLabel(application.createdAt)}
											</p>
										{/if}
									</div>
									<Badge variant="outline" class="shrink-0">
										{applicationStatusLabel(application.status)}
									</Badge>
								</div>
								{#if application.status === 'incomplete'}
									<Button href={routes.newClubStartVideo} variant="outline" class="mt-3 h-9 px-3">
										Resume application
									</Button>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<p class="type-body text-gray-600">
						You have not submitted a Start Club application yet.
					</p>
				{/if}
			</div>
		</Card>
	</div>
</div>
