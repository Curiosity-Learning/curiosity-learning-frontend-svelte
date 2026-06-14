<script lang="ts">
	import { browser } from '$app/environment';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SettingsIcon from '@lucide/svelte/icons/settings';
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
	import {
		LoadingState,
		PageHeaderActions,
		PageHeaderTitleContent,
		showGlobalSnackbar
	} from '$lib/components/app';
	import ClubSessionCard from '$lib/components/app/sessions/club-session-card.svelte';
	import ClubProjectCard from '$lib/components/app/projects/club-project-card.svelte';
	import InviteLearnerDialog from '$lib/components/app/home/invite-learner-dialog.svelte';
	import noSessionFoundImage from '$lib/assets/images/no_session_found.png';
	import noProjectsFoundImage from '$lib/assets/images/no_projects_found.png';
	import noLearnersFoundImage from '$lib/assets/images/no_learners_found.png';
	import { routes } from '$lib/routes';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { SessionDateTimeForm } from '$lib/components/ui/date-picker';
	import * as Dialog from '$lib/components/ui/dialog';
	import { FieldLabel } from '$lib/components/ui/field';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuLabel,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
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
	let canReadAttendance = $derived(clubPermissions.includes('attendance:read'));
	let canReadSessions = $derived(clubPermissions.includes('session:read'));
	let canReadProjects = $derived(clubPermissions.includes('project:read'));
	let canCreateSession = $derived(clubPermissions.includes('session:create'));
	let canCreateProject = $derived(clubPermissions.includes('project:create'));
	let canDeleteSession = $derived(clubPermissions.includes('session:delete'));
	let canEditClub = $derived(clubPermissions.includes('club:edit'));
	let canShowSessionAttendees = $derived(canReadMembers && canReadAttendance);

	let clubIdTyped = $derived(clubId ? (clubId as Id<'clubs'>) : null);

	const upcomingSessionCardsResponse = useStableQuery(
		api.sessions.listCardPreviewsByClub,
		() =>
			clubIdTyped && canReadSessions
				? { clubId: clubIdTyped, upcomingOnly: true, limit: 6, includeAttendees: true }
				: 'skip',
		{ cache: 'memory' }
	);
	const projectsPreviewResponse = useStableQuery(
		api.projects.listPreviewsByClub,
		() => (clubIdTyped && canReadProjects ? { clubId: clubIdTyped, limit: 6 } : 'skip'),
		{ cache: 'memory' }
	);
	const learnersResponse = useStableQuery(
		api.clubs.getMembers,
		() =>
			clubIdTyped && canReadMembers ? { clubId: clubIdTyped, roleKey: 'learner' as const } : 'skip',
		{ cache: 'memory' }
	);

	let visibleUpcomingSessionCards = $derived(upcomingSessionCardsResponse.data ?? []);
	let canMutateOnline = $derived(canMutateOnlineState.current);

	let visibleProjects = $derived(projectsPreviewResponse.data ?? []);
	let visibleLearners = $derived((learnersResponse.data ?? []).slice(0, 8));
	let hiddenLearnersCount = $derived(
		Math.max((learnersResponse.data?.length ?? 0) - visibleLearners.length, 0)
	);
	let createSessionDialogOpen = $state(false);
	let createSessionPending = $state(false);
	let createSessionError = $state('');
	let createSessionForm = $state({
		startTime: null as number | null,
		endTime: null as number | null,
		description: ''
	});
	let projectRailNode = $state<HTMLDivElement | null>(null);
	let switchingClubId = $state<Id<'clubs'> | null>(null);

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
		if (!canCreateSession || !clubIdTyped || startTime === null || endTime === null) {
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

	const learnerDisplayName = (learner: {
		firstName?: string | null;
		lastName?: string | null;
		username?: string | null;
	}) =>
		[learner.firstName ?? '', learner.lastName ?? ''].join(' ').trim() ||
		learner.username ||
		'Learner';

	let initialLearnerImageUrls = $derived.by(() => {
		return new Map(
			(data.initialLearnerImages ?? []).map((asset) => [asset.assetId, asset.signedUrl] as const)
		);
	});
	let initialProjectPreviewImageUrls = $derived.by(() => {
		return new Map(
			(data.initialProjectPreviewImages ?? []).map(
				(asset) => [asset.assetId, asset.signedUrl] as const
			)
		);
	});
	let initialSessionAttendeeImageUrls = $derived.by(() => {
		return new Map(
			(data.initialSessionAttendeeImages ?? []).map(
				(asset) => [asset.assetId, asset.signedUrl] as const
			)
		);
	});

	const learnerImageUrl = (learner: { profileImageMediaAssetId?: Id<'mediaAssets'> | null }) => {
		if (learner.profileImageMediaAssetId) {
			return initialLearnerImageUrls.get(learner.profileImageMediaAssetId) ?? null;
		}

		return null;
	};
	const previewMemberImageUrl = (member: {
		profileImageMediaAssetId?: Id<'mediaAssets'> | null;
	}) => {
		if (member.profileImageMediaAssetId) {
			return initialProjectPreviewImageUrls.get(member.profileImageMediaAssetId) ?? null;
		}

		return null;
	};
	const attendeeImageUrl = (attendee: { profileImageMediaAssetId?: Id<'mediaAssets'> | null }) => {
		if (attendee.profileImageMediaAssetId) {
			return initialSessionAttendeeImageUrls.get(attendee.profileImageMediaAssetId) ?? null;
		}

		return null;
	};
	let visibleUpcomingSessionCardsWithSignedAttendees = $derived(
		visibleUpcomingSessionCards.map((entry) => ({
			...entry,
			attendees: entry.attendees.map((attendee) => ({
				name: attendee.name,
				imageUrl: attendeeImageUrl(attendee)
			}))
		}))
	);
	let visibleProjectsWithSignedMembers = $derived(
		visibleProjects.map((entry) => ({
			...entry,
			members: entry.members.map((member) => ({
				name: member.name,
				imageUrl: previewMemberImageUrl(member)
			}))
		}))
	);

	const getProjectRailScrollKey = () =>
		clubId ? `${PROJECT_RAIL_SCROLL_KEY_PREFIX}:${clubId}` : null;

	const switchClub = async (nextClubId: Id<'clubs'>) => {
		if (nextClubId === clubIdTyped || switchingClubId) return;
		switchingClubId = nextClubId;
		try {
			await convexClient.mutation(api.clubs.switchActiveClub, { clubId: nextClubId });
			await goto(routes.clubHome(nextClubId));
		} catch (error) {
			showGlobalSnackbar({
				title: 'Unable to switch club',
				description: error instanceof Error ? error.message : 'Please try again.'
			});
		} finally {
			switchingClubId = null;
		}
	};

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
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;
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

<PageHeaderTitleContent enabled={Boolean(clubItem)}>
	<DropdownMenu>
		<DropdownMenuTrigger>
			<Button
				variant="ghost"
				class="-ml-2 max-w-full min-w-0 justify-start gap-2 px-2 text-[#262626] hover:text-[#262626]"
				aria-label={`Switch club from ${clubItem?.clubName ?? 'current club'}`}
			>
				<span class="type-step-title truncate">{clubItem?.clubName ?? 'Club'}</span>
				<ChevronDownIcon class="size-5 shrink-0 text-muted-foreground" />
			</Button>
		</DropdownMenuTrigger>
		<DropdownMenuContent align="start" class="w-64">
			<DropdownMenuLabel>Switch club</DropdownMenuLabel>
			{#each clubsResponse.data ?? [] as club (club.clubId)}
				<DropdownMenuItem
					class="justify-between gap-3 py-2"
					disabled={switchingClubId !== null}
					onSelect={() => void switchClub(club.clubId)}
				>
					<span class="truncate">{club.clubName}</span>
					{#if club.clubId === clubIdTyped}
						<CheckIcon class="size-4 text-orange-500" />
					{/if}
				</DropdownMenuItem>
			{/each}
		</DropdownMenuContent>
	</DropdownMenu>
</PageHeaderTitleContent>

<PageHeaderActions none={!canEditClub}>
	<Button
		variant="ghost"
		size="icon-sm"
		aria-label="Open club settings"
		class="text-[#767b92] hover:text-[#565b72]"
		href={clubId ? routes.clubSettings(clubId) : undefined}
	>
		<SettingsIcon class="size-5" />
	</Button>
</PageHeaderActions>

<div
	class="-mx-4 flex min-h-full flex-col gap-8 px-4 py-4 sm:-mx-6 sm:px-6 sm:py-5 lg:-mx-8 lg:px-8 lg:py-6"
>
	<section class="flex flex-col gap-4">
		<HomeSectionHeader title="Sessions">
			{#snippet action()}
				{#if canCreateSession && !upcomingSessionCardsResponse.isLoading && visibleUpcomingSessionCards.length === 0}
					<Button
						variant="ghost"
						size="sm"
						class="type-sm-bold hidden text-orange-500 hover:bg-transparent hover:text-orange-600 sm:inline-flex"
						disabled={!canMutateOnline}
						onclick={openCreateSessionDialog}
					>
						<PlusIcon class="size-4" />
						<span>Add a session</span>
					</Button>
					<div class="sm:hidden">
						<HomeActionLink href={`${clubPath}/sessions`} label="View all" Icon={ArrowRightIcon} />
					</div>
				{:else}
					<HomeActionLink href={`${clubPath}/sessions`} label="View all" Icon={ArrowRightIcon} />
				{/if}
			{/snippet}
		</HomeSectionHeader>

		{#if !clubId}
			<HomeEmptyCard
				title="No sessions to attend"
				illustrationSrc={noSessionFoundImage}
				illustrationAlt="No sessions found"
				centerContent={true}
				variant="plain"
				minHeightClass="min-h-44 sm:min-h-48"
			/>
		{:else if upcomingSessionCardsResponse.isLoading}
			<LoadingState class="min-h-40 sm:min-h-44" label="Loading sessions" />
		{:else if visibleUpcomingSessionCardsWithSignedAttendees.length === 0}
			<HomeEmptyCard
				title="No sessions to attend"
				illustrationSrc={noSessionFoundImage}
				illustrationAlt="No sessions found"
				centerContent={true}
				variant="plain"
				minHeightClass="min-h-44 sm:min-h-48"
			/>
		{:else}
			<div class="flex gap-4 overflow-x-auto pb-2">
				{#each visibleUpcomingSessionCardsWithSignedAttendees as entry (entry.session._id)}
					<ClubSessionCard
						session={entry.session}
						sessionHref={routes.sessionDetail(entry.session._id)}
						prefetchedCardData={{
							tagNames: entry.tagNames,
							attendees: entry.attendees,
							activityItems: entry.activityItems,
							hiddenActivitiesCount: entry.hiddenActivitiesCount
						}}
						canReadMembers={canShowSessionAttendees}
						canDelete={canDeleteSession}
						showActivitiesSection={false}
						showAttendeesSection={canShowSessionAttendees}
						attendeesAvatarSizeClass="size-9"
						showActions={false}
						class="w-[20.25rem] shrink-0 sm:w-[21.5rem]"
					/>
				{/each}
			</div>
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
		<HomeSectionHeader title="Projects">
			{#snippet action()}
				{#if canCreateProject && !projectsPreviewResponse.isLoading && visibleProjects.length === 0}
					<Button
						href={`${clubPath}/projects`}
						variant="ghost"
						size="sm"
						class="type-sm-bold hidden text-orange-500 hover:bg-transparent hover:text-orange-600 sm:inline-flex"
					>
						<PlusIcon class="size-4" />
						<span>Add a project</span>
					</Button>
					<div class="sm:hidden">
						<HomeActionLink href={`${clubPath}/projects`} label="View all" Icon={ArrowRightIcon} />
					</div>
				{:else}
					<HomeActionLink href={`${clubPath}/projects`} label="View all" Icon={ArrowRightIcon} />
				{/if}
			{/snippet}
		</HomeSectionHeader>

		{#if !clubId}
			<HomeEmptyCard
				title="No projects to complete"
				illustrationSrc={noProjectsFoundImage}
				illustrationAlt="No projects found"
				centerContent={true}
				variant="plain"
				minHeightClass="min-h-44 sm:min-h-48"
			/>
		{:else if projectsPreviewResponse.isLoading}
			<LoadingState class="min-h-40 sm:min-h-44" label="Loading projects" />
		{:else if visibleProjectsWithSignedMembers.length === 0}
			<HomeEmptyCard
				title="No projects to complete"
				illustrationSrc={noProjectsFoundImage}
				illustrationAlt="No projects found"
				centerContent={true}
				variant="plain"
				minHeightClass="min-h-44 sm:min-h-48"
			/>
		{:else}
			<div class="flex gap-4 overflow-x-auto pb-2" use:mountProjectRail>
				{#each visibleProjectsWithSignedMembers as entry (entry.project._id)}
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
		{/if}
	</section>

	<section class="flex flex-col gap-4">
		<HomeSectionHeader title="Learners">
			{#snippet action()}
				{#if clubId && canReadMembers && visibleLearners.length > 0}
					<HomeActionLink href={`${clubPath}/members`} label="View all" Icon={ArrowRightIcon} />
				{:else}
					<InviteLearnerDialog
						clubCode={clubItem?.clubCode}
						triggerStyle="link"
						triggerLabel="Invite a learner"
					/>
				{/if}
			{/snippet}
		</HomeSectionHeader>

		{#if clubId && canReadMembers && learnersResponse.isLoading}
			<LoadingState class="min-h-32 sm:min-h-36" label="Loading learners" />
		{:else if clubId && canReadMembers && visibleLearners.length > 0}
			<div class="flex flex-col gap-4">
				<div class="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
					{#each visibleLearners as learner (learner.userId)}
						<a
							href={`${clubPath}/members`}
							class="flex items-center gap-3 rounded-xl px-1 py-1 transition-colors hover:bg-muted/50"
							data-sveltekit-preload-code="hover"
							data-sveltekit-preload-data="hover"
						>
							<Avatar class="size-12">
								{#if learnerImageUrl(learner)}
									<AvatarImage
										src={learnerImageUrl(learner) ?? undefined}
										alt={learnerDisplayName(learner)}
									/>
								{/if}
								<AvatarFallback class="text-sm font-semibold">
									{initialsFor(learnerDisplayName(learner))}
								</AvatarFallback>
							</Avatar>
							<div class="min-w-0 flex-1">
								<p class="type-h6-bold truncate">{learnerDisplayName(learner)}</p>
								{#if learner.username}
									<p class="type-sm truncate text-muted-foreground">@{learner.username}</p>
								{/if}
							</div>
						</a>
					{/each}
				</div>
				{#if hiddenLearnersCount > 0}
					<div class="self-start">
						<HomeActionLink
							href={`${clubPath}/members`}
							label={`+ ${hiddenLearnersCount} others`}
						/>
					</div>
				{/if}
			</div>
		{:else}
			<HomeEmptyCard
				title="No learners to interact with"
				illustrationSrc={noLearnersFoundImage}
				illustrationAlt="No learners found"
				centerContent={true}
				variant="plain"
				minHeightClass="min-h-44 sm:min-h-48"
			/>
		{/if}
	</section>
</div>
