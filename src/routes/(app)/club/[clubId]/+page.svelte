<script lang="ts">
	import { browser } from '$app/environment';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import FolderKanbanIcon from '@lucide/svelte/icons/folder-kanban';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import {
		canMutateOnline as canMutateOnlineStore,
		reportMutationFailure,
		reportMutationSuccess
	} from '$lib/app/connectivity';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { fromStore } from 'svelte/store';

	import HomeSectionHeader from '$lib/components/app/home/home-section-header.svelte';
	import HomeActionLink from '$lib/components/app/home/home-action-link.svelte';
	import HomeEmptyCard from '$lib/components/app/home/home-empty-card.svelte';
	import ClubSessionCard from '$lib/components/app/sessions/club-session-card.svelte';
	import ClubProjectCard from '$lib/components/app/projects/club-project-card.svelte';
	import InviteLearnerDialog from '$lib/components/app/home/invite-learner-dialog.svelte';
	import { routes } from '$lib/routes';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { SessionDateTimeForm } from '$lib/components/ui/date-picker';
	import * as Dialog from '$lib/components/ui/dialog';
	import { FieldLabel } from '$lib/components/ui/field';
	import { Textarea } from '$lib/components/ui/textarea';
	import { page } from '$app/state';
	import { formatSessionHeaderLine } from '$lib/domain/session';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const convexClient = useConvexClient();
	const clubsResponse = useStableQuery(api.clubs.getMyClubs, {});
	const canMutateOnlineState = fromStore(canMutateOnlineStore);

	let clubId = $derived((page.params as Record<string, string | undefined>).clubId ?? null);
	let clubPath = $derived(clubId ? `/club/${clubId}` : '/onboarding/get-started');

	let clubItem = $derived(
		clubId ? ((clubsResponse.data ?? []).find((club) => club.clubId === clubId) ?? null) : null
	);
	let clubPermissions = $derived(clubItem?.rolePermissions ?? []);
	let canReadMembers = $derived(clubPermissions.includes('club_member:read_active'));
	let canCreateSession = $derived(clubPermissions.includes('session:create'));
	let canDeleteSession = $derived(clubPermissions.includes('session:delete'));

	let clubIdTyped = $derived(clubId ? (clubId as Id<'clubs'>) : null);

	const upcomingSessionCardsResponse = useStableQuery(
		api.sessions.listCardPreviewsByClub,
		() => (clubIdTyped ? { clubId: clubIdTyped, upcomingOnly: true, limit: 1 } : 'skip'),
		{ cache: 'memory' }
	);
	const projectsPreviewResponse = useStableQuery(
		api.projects.listPreviewsByClub,
		() => (clubIdTyped ? { clubId: clubIdTyped, limit: 6 } : 'skip'),
		{ cache: 'memory' }
	);
	const learnersResponse = useStableQuery(
		api.clubs.getMembers,
		() =>
			clubIdTyped && canReadMembers
				? { clubId: clubIdTyped, roleName: 'Learner' as const }
				: 'skip',
		{ cache: 'memory' }
	);

	let nextSessionCard = $derived((upcomingSessionCardsResponse.data ?? [])[0] ?? null);
	let nextSession = $derived(nextSessionCard?.session ?? null);
	let noUpcomingSessionDescription = $derived(
		canCreateSession ? 'Plan your next meeting to keep your club moving.' : ''
	);
	let canMutateOnline = $derived(canMutateOnlineState.current);

	let visibleProjects = $derived(projectsPreviewResponse.data ?? []);
	let createSessionDialogOpen = $state(false);
	let createSessionPending = $state(false);
	let createSessionError = $state('');
	let createSessionForm = $state({
		startTime: null as number | null,
		endTime: null as number | null,
		description: ''
	});
	let projectRailNode = $state<HTMLDivElement | null>(null);

	const PROJECT_RAIL_SCROLL_KEY_PREFIX = 'club-dashboard-projects-rail-scroll';
	const SESSION_CREATE_TIMEOUT_MS = 6_000;

	async function withTimeout<T>(
		promise: Promise<T>,
		timeoutMs: number,
		timeoutMessage: string
	): Promise<T> {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
			})
		]);
	}

	const buildDefaultSessionForm = () => {
		const now = Date.now();
		return {
			startTime: now + 3_600_000,
			endTime: now + 7_200_000,
			description: ''
		};
	};

	const openCreateSessionDialog = () => {
		createSessionForm = buildDefaultSessionForm();
		createSessionError = '';
		createSessionDialogOpen = true;
	};

	const createSession = async () => {
		const startTime = createSessionForm.startTime;
		const endTime = createSessionForm.endTime;
		if (
			!canCreateSession ||
			!clubIdTyped ||
			startTime === null ||
			endTime === null
		) {
			return;
		}

		createSessionPending = true;
		createSessionError = '';
		try {
			const desc = createSessionForm.description.trim();
			const session = await withTimeout(
				convexClient.mutation(api.sessions.create, {
					clubId: clubIdTyped,
					startTime,
					endTime,
					...(desc ? { description: desc } : {})
				}),
				SESSION_CREATE_TIMEOUT_MS,
				'Request timed out. Check your connection and try again.'
			);
			reportMutationSuccess();
			if (session?._id) {
				const target = resolve(`/session/${session._id}/activities`);
				const headerTitleHint = Number.isFinite(startTime)
					? formatSessionHeaderLine(startTime)
					: undefined;
				try {
					await goto(target, {
						state: {
							...(headerTitleHint ? { headerTitleHint } : {}),
							headerTitleHintPath: `/session/${session._id}`
						}
					});
				} catch {
					await goto(target);
				}
				createSessionDialogOpen = false;
				return;
			}
			createSessionError = 'Session was created, but could not be opened automatically.';
		} catch (error) {
			reportMutationFailure(error);
			createSessionError = error instanceof Error ? error.message : 'Failed to create session.';
		} finally {
			createSessionPending = false;
		}
	};

	const initialsFor = (name: string) => {
		const cleaned = name.trim();
		if (!cleaned) return '?';
		const parts = cleaned.split(/\s+/g).filter(Boolean);
		const letters = [parts[0]?.[0] ?? '', parts.at(-1)?.[0] ?? ''].join('').toUpperCase();
		return letters || cleaned.slice(0, 2).toUpperCase();
	};

	let initialLearnerImageUrls = $derived.by(() => {
		return new Map(
			(data.initialLearnerImages ?? []).map((asset) => [asset.assetId, asset.signedUrl] as const)
		);
	});

	const learnerImageUrl = (learner: {
		profileImageMediaAssetId?: Id<'mediaAssets'> | null;
		coverPhotoUrl?: string | null;
	}) => {
		if (learner.profileImageMediaAssetId) {
			return initialLearnerImageUrls.get(learner.profileImageMediaAssetId) ?? null;
		}

		return learner.coverPhotoUrl ?? null;
	};

	const getProjectRailScrollKey = () => (clubId ? `${PROJECT_RAIL_SCROLL_KEY_PREFIX}:${clubId}` : null);

	const restoreProjectRailScroll = (node: HTMLDivElement) => {
		if (!browser) return;
		const key = getProjectRailScrollKey();
		if (!key) return;
		const savedScrollLeft = Number(sessionStorage.getItem(key));
		if (!Number.isFinite(savedScrollLeft) || savedScrollLeft <= 0) {
			sessionStorage.removeItem(key);
			return;
		}
		requestAnimationFrame(() => {
			node.scrollLeft = savedScrollLeft;
			// One-time restore so this is only used for immediate back-and-forth.
			sessionStorage.removeItem(key);
		});
	};

	const mountProjectRail = (node: HTMLDivElement) => {
		projectRailNode = node;
		restoreProjectRailScroll(node);
		// Persist only when navigation starts from this rail (not from unrelated route changes).
		node.addEventListener('click', handleProjectRailClick);
		return {
			destroy() {
				node.removeEventListener('click', handleProjectRailClick);
				if (projectRailNode === node) {
					projectRailNode = null;
				}
			}
		};
	};

	const handleProjectRailClick = (event: MouseEvent) => {
		if (!browser || !projectRailNode) return;
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		const projectLink = target.closest('a[href]');
		if (!projectLink || !projectRailNode.contains(projectLink)) return;
		const key = getProjectRailScrollKey();
		if (!key) return;
		const scrollLeft = projectRailNode.scrollLeft;
		if (scrollLeft > 0) {
			sessionStorage.setItem(key, String(Math.round(scrollLeft)));
			return;
		}
		sessionStorage.removeItem(key);
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
			{#if canCreateSession}
				<HomeEmptyCard
					title="No upcoming sessions"
					description={noUpcomingSessionDescription}
					Icon={CalendarIcon}
				>
					{#snippet action()}
						<Button variant="outline" disabled={!canMutateOnline} onclick={openCreateSessionDialog}
							>Plan a session</Button
						>
					{/snippet}
				</HomeEmptyCard>
			{:else}
				<HomeEmptyCard
					title="No upcoming sessions"
					description={noUpcomingSessionDescription}
					Icon={CalendarIcon}
				/>
			{/if}
		{:else if upcomingSessionCardsResponse.isLoading}
			<HomeEmptyCard
				title="Loading upcoming sessions"
				description="Checking the schedule for this club."
				actionLabel="Loading..."
				disabled={true}
				Icon={CalendarIcon}
			/>
		{:else if !nextSession}
			{#if canCreateSession}
				<HomeEmptyCard
					title="No upcoming sessions"
					description={noUpcomingSessionDescription}
					Icon={CalendarIcon}
				>
					{#snippet action()}
						<Button variant="outline" disabled={!canMutateOnline} onclick={openCreateSessionDialog}
							>Plan a session</Button
						>
					{/snippet}
				</HomeEmptyCard>
			{:else}
				<HomeEmptyCard
					title="No upcoming sessions"
					description={noUpcomingSessionDescription}
					Icon={CalendarIcon}
				/>
			{/if}
		{:else}
			<ClubSessionCard
				session={nextSession}
				sessionHref={routes.sessionDetail(nextSession._id)}
				prefetchedCardData={nextSessionCard}
				{canReadMembers}
				canDelete={canDeleteSession}
				showAttendeesSection={false}
				showActions={false}
			/>
		{/if}

		{#if canCreateSession}
			<Dialog.Root bind:open={createSessionDialogOpen}>
				<Dialog.Content>
					<Dialog.Header>
						<Dialog.Title>Create session</Dialog.Title>
						<Dialog.Description
							>Use local date and time values for this club session.</Dialog.Description
						>
					</Dialog.Header>
					{#if createSessionError}
						<Alert variant="destructive">
							<AlertTitle>Unable to open session</AlertTitle>
							<AlertDescription>{createSessionError}</AlertDescription>
						</Alert>
					{/if}
					<div class="flex flex-col gap-3">
						<SessionDateTimeForm
							bind:startTime={createSessionForm.startTime}
							bind:endTime={createSessionForm.endTime}
						/>
						<div class="flex flex-col gap-2">
							<FieldLabel for="sessionDescription">Description</FieldLabel>
							<Textarea
								id="sessionDescription"
								bind:value={createSessionForm.description}
								rows={3}
							/>
						</div>
					</div>
					<Dialog.Footer>
						<Button variant="outline" onclick={() => (createSessionDialogOpen = false)}
							>Cancel</Button
						>
						<Button
							disabled={createSessionPending || !canCreateSession || !canMutateOnline}
							onclick={() => void createSession()}
						>
							{createSessionPending ? 'Creating...' : 'Open'}
						</Button>
					</Dialog.Footer>
				</Dialog.Content>
			</Dialog.Root>
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
				<div class="flex gap-4 overflow-x-auto pb-2" use:mountProjectRail>
					{#each visibleProjects as entry (entry.project._id)}
						<ClubProjectCard
							project={entry.project}
							memberPreview={entry.members}
							status="current"
							href={routes.projectDetail(entry.project._id)}
							navigationState={{
								headerTitleHint: entry.project.name,
								headerTitleHintPath: `/project/${entry.project._id}`
							}}
							class="w-[18.5rem] shrink-0 sm:w-[20rem]"
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
								{#if learnerImageUrl(learner)}
									<AvatarImage src={learnerImageUrl(learner) ?? undefined} alt={learner.email ?? learner.userId} />
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
									{[learner.firstName ?? '', learner.lastName ?? ''].join(' ').trim() ||
										learner.email}
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
