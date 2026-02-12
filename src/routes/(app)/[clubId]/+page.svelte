<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import FolderKanbanIcon from '@lucide/svelte/icons/folder-kanban';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { useQuery } from 'convex-svelte';

	import HomeSectionHeader from '$lib/components/app/home/home-section-header.svelte';
	import HomeActionLink from '$lib/components/app/home/home-action-link.svelte';
	import HomeEmptyCard from '$lib/components/app/home/home-empty-card.svelte';
	import UpcomingSessionCard from '$lib/components/app/home/upcoming-session-card.svelte';
	import ProjectPreviewCard from '$lib/components/app/home/project-preview-card.svelte';
	import InviteLearnerDialog from '$lib/components/app/home/invite-learner-dialog.svelte';
	import { routes } from '$lib/routes';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { page } from '$app/state';

	const clubsResponse = useQuery(api.clubs.getMyClubs, {});

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
			<HomeEmptyCard
				title="No upcoming sessions"
				description="Plan your next meeting to keep your club moving."
				actionLabel="Plan a session"
				href={`${clubPath}/sessions`}
				Icon={CalendarIcon}
			/>
		{:else if upcomingSessionsResponse.isLoading}
			<HomeEmptyCard
				title="Loading upcoming sessions"
				description="Checking the schedule for this club."
				actionLabel="Loading..."
				disabled={true}
				Icon={CalendarIcon}
			/>
		{:else if !nextSession}
			<HomeEmptyCard
				title="No upcoming sessions"
				description="Plan your next meeting to keep your club moving."
				actionLabel="Plan a session"
				href={`${clubPath}/sessions`}
				Icon={CalendarIcon}
			/>
		{:else}
			<UpcomingSessionCard
				session={nextSession}
				{canReadMembers}
				href={routes.sessionDetail(nextSession._id)}
			/>
		{/if}
	</section>

	<section class="flex flex-col gap-4">
		<HomeSectionHeader title="Current projects">
			{#snippet action()}
				<HomeActionLink href={`${clubPath}/projects`} label="View all" Icon={ArrowRightIcon} />
			{/snippet}
		</HomeSectionHeader>

		{#if !clubId}
			<HomeEmptyCard
				title="No active projects"
				description="Start a project to track goals and progress."
				actionLabel="Plan a project"
				href={`${clubPath}/projects`}
				Icon={FolderKanbanIcon}
			/>
		{:else if projectsPreviewResponse.isLoading}
			<HomeEmptyCard
				title="Loading active projects"
				description="Fetching project work in progress."
				actionLabel="Loading..."
				disabled={true}
				Icon={FolderKanbanIcon}
			/>
		{:else if (projectsPreviewResponse.data?.length ?? 0) === 0}
			<HomeEmptyCard
				title="No active projects"
				description="Start a project to track goals and progress."
				actionLabel="Plan a project"
				href={`${clubPath}/projects`}
				Icon={FolderKanbanIcon}
			/>
		{:else}
			<div class="flex flex-col gap-3">
				<div class="flex gap-4 overflow-x-auto pb-2">
					{#each visibleProjects as entry (entry.project._id)}
						<ProjectPreviewCard
							project={entry.project}
							memberPreview={entry.members}
							href={`${clubPath}/projects`}
						/>
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
					<Card class="gap-0 py-0">
						<CardContent class="flex items-center gap-4 p-5">
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
								<p class="type-h6-bold">
									{[learner.firstName ?? '', learner.lastName ?? ''].join(' ').trim() || learner.email}
								</p>
								<p class="type-sm text-muted-foreground">{learner.email ?? learner.userId}</p>
							</div>
						</CardContent>
					</Card>
				{/each}
			</div>
		{:else}
			<HomeSectionHeader title="Active learners" />

			<HomeEmptyCard
				title="No active learners"
				description="Invite a learner to get your next session started."
				actionLabel="Invite a learner"
				Icon={UsersIcon}
			>
				{#snippet action()}
					<InviteLearnerDialog
						clubCode={clubItem?.clubCode}
						triggerStyle="button"
						triggerLabel="Invite a learner"
					/>
				{/snippet}
			</HomeEmptyCard>
		{/if}
	</section>
</div>
