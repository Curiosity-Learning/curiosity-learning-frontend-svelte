<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { useQuery } from 'convex-svelte';

	import HomeSectionHeader from '$lib/components/app/home/home-section-header.svelte';
	import HomeActionLink from '$lib/components/app/home/home-action-link.svelte';
	import HomeEmptyCard from '$lib/components/app/home/home-empty-card.svelte';
	import UpcomingSessionCard from '$lib/components/app/home/upcoming-session-card.svelte';
	import ProjectPreviewCard from '$lib/components/app/home/project-preview-card.svelte';
	import InviteLearnerDialog from '$lib/components/app/home/invite-learner-dialog.svelte';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { page } from '$app/state';
	import { profileReady } from '$lib/app/client-init';

	const clubsResponse = useQuery(api.clubs.getMyClubs, () => ($profileReady ? {} : 'skip'));

	let clubId = $derived((page.params as Record<string, string | undefined>).clubId ?? null);
	let clubPath = $derived(clubId ? `/${clubId}` : '/onboarding/get-started');

	let clubItem = $derived(
		clubId ? (clubsResponse.data ?? []).find((club) => club.clubId === clubId) ?? null : null
	);
	let clubPermissions = $derived(clubItem?.rolePermissions ?? []);
	let canReadMembers = $derived(clubPermissions.includes('club_member:read_active'));

	let clubIdTyped = $derived((clubId ? (clubId as Id<'clubs'>) : null));

	const upcomingSessionsResponse = useQuery(api.sessions.listByClub, () =>
		clubIdTyped ? { clubId: clubIdTyped, upcomingOnly: true, limit: 1 } : 'skip'
	);
	const projectsPreviewResponse = useQuery(api.projects.listPreviewsByClub, () =>
		clubIdTyped ? { clubId: clubIdTyped, limit: 6 } : 'skip'
	);
	const learnersResponse = useQuery(api.clubs.getMembers, () =>
		clubIdTyped && canReadMembers ? { clubId: clubIdTyped, roleName: 'Learner' as const } : 'skip'
	);

	let nextSession = $derived((upcomingSessionsResponse.data ?? [])[0] ?? null);

	let visibleProjects = $derived(projectsPreviewResponse.data ?? []);

	const initialsFor = (name: string) => {
		const cleaned = name.trim();
		if (!cleaned) return '?';
		const parts = cleaned.split(/\s+/g).filter(Boolean);
		const letters = [parts[0]?.[0] ?? '', parts.at(-1)?.[0] ?? ''].join('').toUpperCase();
		return letters || cleaned.slice(0, 2).toUpperCase();
	};
</script>

<div class="flex flex-col gap-10">
	<section class="flex flex-col gap-4">
		<HomeSectionHeader title="Upcoming session">
			{#snippet action()}
				<HomeActionLink href={`${clubPath}/sessions`} label="View all" Icon={ArrowRightIcon} />
			{/snippet}
		</HomeSectionHeader>

		{#if !clubId}
			<HomeEmptyCard label="Plan session" href={`${clubPath}/sessions`} minHeightClass="min-h-44" />
		{:else if upcomingSessionsResponse.isLoading}
			<HomeEmptyCard label="Loading..." href={`${clubPath}/sessions`} minHeightClass="min-h-44" />
	{:else if !nextSession}
		<HomeEmptyCard label="Plan session" href={`${clubPath}/sessions`} minHeightClass="min-h-44" />
	{:else}
		<UpcomingSessionCard session={nextSession} {canReadMembers} />
	{/if}
	</section>

	<section class="flex flex-col gap-4">
		<HomeSectionHeader title="Current projects">
			{#snippet action()}
				<HomeActionLink href={`${clubPath}/projects`} label="View all" Icon={ArrowRightIcon} />
			{/snippet}
		</HomeSectionHeader>

		{#if !clubId}
			<HomeEmptyCard label="Create project" href={`${clubPath}/projects`} minHeightClass="min-h-56" />
		{:else if projectsPreviewResponse.isLoading}
			<HomeEmptyCard label="Loading..." href={`${clubPath}/projects`} minHeightClass="min-h-56" />
		{:else if (projectsPreviewResponse.data?.length ?? 0) === 0}
			<HomeEmptyCard label="Create project" href={`${clubPath}/projects`} minHeightClass="min-h-56" />
		{:else}
			<div class="flex flex-col gap-3">
				<div class="flex gap-4 overflow-x-auto pb-2">
					{#each visibleProjects as entry (entry.project._id)}
						<ProjectPreviewCard project={entry.project} memberPreview={entry.members} />
					{/each}
				</div>
			</div>
		{/if}
	</section>

	<section class="flex flex-col gap-4">
		{#if clubId && canReadMembers && (learnersResponse.data?.length ?? 0) > 0}
			<HomeSectionHeader title="Active learners">
				{#snippet action()}
					<HomeActionLink href={`${clubPath}/members`} label="View all" Icon={ArrowRightIcon} />
				{/snippet}
			</HomeSectionHeader>

			<div class="flex flex-col gap-3">
				{#each (learnersResponse.data ?? []).slice(0, 4) as learner (learner.userId)}
					<div class="flex items-center gap-4 rounded-xl border border-border bg-background/60 p-4">
						<Avatar class="size-12">
							{#if learner.coverPhotoUrl}
								<AvatarImage src={learner.coverPhotoUrl} alt={learner.email ?? learner.userId} />
							{/if}
							<AvatarFallback class="text-sm font-semibold">
								{initialsFor(
									[learner.firstName ?? '', learner.lastName ?? ''].join(' ').trim() ||
										learner.email ||
										learner.userId
								)}
							</AvatarFallback>
						</Avatar>
						<div class="flex flex-1 flex-col gap-1">
							<p class="font-semibold leading-none">
								{[learner.firstName ?? '', learner.lastName ?? ''].join(' ').trim() || learner.email}
							</p>
							<p class="text-sm text-muted-foreground">{learner.email ?? learner.userId}</p>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<HomeSectionHeader title="Learners">
				{#snippet action()}
					<InviteLearnerDialog clubCode={clubItem?.clubCode} triggerLabel="Invite all learners" />
				{/snippet}
			</HomeSectionHeader>

			<InviteLearnerDialog
				clubCode={clubItem?.clubCode}
				triggerStyle="card"
				triggerLabel="Invite learner"
				cardMinHeightClass="min-h-56"
			/>
		{/if}
	</section>
</div>
