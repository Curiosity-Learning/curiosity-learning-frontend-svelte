<script lang="ts">
	import { goto } from '$app/navigation';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import Clock3Icon from '@lucide/svelte/icons/clock-3';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import { api } from '$convex/_generated/api';
	import { PageHeaderActions, PageHeaderTitle } from '$lib/components/app';
	import myClubImage from '$lib/assets/images/my_club.png';
	import chessIcon from '$lib/assets/chess.svg';
	import ideaIcon from '$lib/assets/idea.svg';
	import nodesIcon from '$lib/assets/nodes.svg';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { routes } from '$lib/routes';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const profileResponse = useStableQuery(api.profiles.getMe, {});
	const clubsResponse = useStableQuery(api.clubs.getMyClubs, {});
	const activeContext = useStableQuery(api.clubs.getActiveClubContext, {});
	const updatesResponse = useStableQuery(api.updates.listForViewer, { limit: 24 });

	let activeClubId = $derived(activeContext.data?.activeClubId ?? null);
	const projectsResponse = useStableQuery(api.projects.listByClub, () =>
		activeClubId ? { clubId: activeClubId } : 'skip'
	);
	const sessionsResponse = useStableQuery(api.sessions.listByClub, () =>
		activeClubId ? { clubId: activeClubId } : 'skip'
	);

	let activeClubItem = $derived(
		(clubsResponse.data ?? []).find((club) => club.clubId === activeClubId) ?? null
	);
	let activeClubUpdates = $derived.by(() => {
		if (!activeClubId) {
			return updatesResponse.data ?? [];
		}
		return (updatesResponse.data ?? []).filter((item) => item.clubId === activeClubId);
	});
	let latestUpdate = $derived(activeClubUpdates[0] ?? null);

	const fullName = $derived(
		[profileResponse.data?.firstName, profileResponse.data?.lastName]
			.filter(Boolean)
			.join(' ')
			.trim()
	);
	let displayName = $derived(
		fullName ||
			profileResponse.data?.username ||
			profileResponse.data?.email ||
			'Your profile'
	);
	const handle = $derived(profileResponse.data?.username ? `@${profileResponse.data.username}` : '');
	const fallback = $derived(
		(profileResponse.data?.username ?? profileResponse.data?.firstName ?? 'Me').slice(0, 2).toUpperCase()
	);
	const aboutText = $derived(
		profileResponse.data?.about?.trim() ||
			'Curious learner who loves designing products and interfaces.'
	);
	const profileImageUrl = $derived.by(() => {
		const profileImageAssetId = profileResponse.data?.profileImageMediaAssetId ?? null;
		if (profileImageAssetId && data.initialProfileImage?.assetId === profileImageAssetId) {
			return data.initialProfileImage.signedUrl;
		}

		return null;
	});

	const meetingSchedule = $derived.by(() => {
		if (!activeClubItem) return null;
		if (activeClubItem.clubMeetingDay && activeClubItem.clubMeetingTime) {
			return `${activeClubItem.clubMeetingDay} at ${activeClubItem.clubMeetingTime}`;
		}
		return activeClubItem.clubMeetingDay ?? activeClubItem.clubMeetingTime ?? null;
	});

	const formatRelativeTime = (timestamp: number) => {
		const diff = Date.now() - timestamp;
		if (diff <= 0) return 'now';
		const minutes = Math.floor(diff / 60_000);
		if (minutes < 1) return 'now';
		if (minutes < 60) return `${minutes}m`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h`;
		const days = Math.floor(hours / 24);
		return `${days}d`;
	};

	let updatesCount = $derived(activeClubUpdates.length);
	let activitiesCount = $derived(sessionsResponse.data?.length ?? 0);
	let projectsCount = $derived(projectsResponse.data?.length ?? 0);
let selectedStat = $state<'updates' | 'activities' | 'projects'>('updates');

const statCardClasses = (isSelected: boolean) =>
	`group flex flex-col items-center justify-center gap-3 rounded-2xl border p-4 text-center transition ${
		isSelected ? 'border-[#a1a4d7] bg-white shadow-sm' : 'border-border/70 bg-[#f5f6fb]'
	}`;

const iconWrapperClasses = (isSelected: boolean) =>
	`grid h-12 w-12 place-items-center rounded-full border p-2 ${
		isSelected ? 'border-[#a1a4d7] bg-white text-[#6a6db2]' : 'border-border/70 bg-white text-[#7577AD]'
	}`;
</script>

<PageHeaderActions>
	<Button
		variant="ghost"
		size="icon-sm"
		aria-label="Open settings"
		class="text-gray-500 hover:text-gray-700"
		href={routes.settings}
	>
		<SettingsIcon class="size-5" />
	</Button>
</PageHeaderActions>

<div class="-mx-4 flex w-full flex-col gap-3 bg-transparent px-4 py-0 sm:-mx-6 sm:bg-transparent sm:px-6 sm:py-5 lg:-mx-8 lg:px-8 lg:py-6">
	{#if profileResponse.error}
		<Alert variant="destructive">
			<AlertTitle>Could not load profile</AlertTitle>
			<AlertDescription>{profileResponse.error.message}</AlertDescription>
		</Alert>
	{/if}

	<section class="rounded-[1.1rem] border border-border/70 bg-white p-3 sm:p-4">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
			<div class="min-w-0 flex-1">
				<p class="truncate text-[1.5rem] leading-[1.8rem] font-bold sm:text-[2rem] sm:leading-[2.2rem] text-[#262626]">{displayName}</p>
				{#if handle}
					<p class="truncate text-xs sm:text-sm text-[#8b8fa0]">{handle}</p>
				{/if}
				<p class="mt-2 text-[0.95rem] leading-6 sm:text-[1.07rem] sm:leading-7 text-[#353535]">{aboutText}</p>
			</div>
			<div class="relative shrink-0">
				<Avatar class="size-20 border border-border/70 sm:size-24">
					<AvatarImage src={profileImageUrl ?? undefined} alt={displayName} />
					<AvatarFallback class="bg-[#d8dbe5] text-lg font-bold text-[#3a3f50]">{fallback}</AvatarFallback>
				</Avatar>
				<button
					type="button"
					aria-label="Update profile picture"
					class="absolute bottom-0 right-0 grid size-8 place-items-center rounded-full border border-white bg-orange-500 text-white shadow-sm"
				>
					<CameraIcon class="size-4" />
				</button>
			</div>
		</div>
		<Button variant="outline" class="mt-4 w-full">Share profile</Button>
	</section>

	<section class="rounded-[1.1rem] border border-[#f0decc] bg-[#f8ecdf] p-3 sm:p-4">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
			<div class="min-w-0">
				<p class="text-[1.5rem] leading-[1.8rem] font-bold sm:text-[2rem] sm:leading-[2.2rem] text-orange-500">My club</p>
				<p class="mt-1 truncate text-[1rem] sm:text-[1.05rem] font-semibold text-[#2d2d2d]">
					{activeClubItem?.clubName ?? 'Join a club to get started'}
				</p>
				<div class="mt-3 flex flex-col gap-2">
					<Badge class="w-fit gap-1 rounded-full bg-orange-500 px-3 py-1 text-sm text-white">
						<MapPinIcon class="size-3.5" />
						{activeClubItem?.clubLocation ?? 'Location TBD'}
					</Badge>
					{#if meetingSchedule}
						<Badge class="w-fit gap-1 rounded-full bg-orange-500 px-3 py-1 text-sm text-white">
							<Clock3Icon class="size-3.5" />
							{meetingSchedule}
						</Badge>
					{/if}
				</div>
			</div>
			<img
				src={myClubImage}
				alt="My club"
				class="h-24 w-24 rounded-2xl object-cover sm:h-28 sm:w-28"
				loading="lazy"
			/>
		</div>
	</section>

	<section class="grid grid-cols-1 gap-2 sm:grid-cols-3">
		<button
			type="button"
			class={statCardClasses(selectedStat === 'updates')}
			title="View updates"
			onclick={() => {
				selectedStat = 'updates';
			}}
		>
			<div class={iconWrapperClasses(selectedStat === 'updates')}>
				<img src={chessIcon} alt="Updates" class="size-6" />
			</div>
			<p class="text-2xl font-bold text-[#6a6db2]">{updatesCount}</p>
			<p class="text-sm text-[#8085a1]">Updates</p>
		</button>
		<button
			type="button"
			class={statCardClasses(selectedStat === 'activities')}
			title="View activities"
			onclick={() => {
				selectedStat = 'activities';
				activeClubId && void goto(routes.clubSessions(activeClubId));
			}}
		>
			<div class={iconWrapperClasses(selectedStat === 'activities')}>
				<img src={ideaIcon} alt="Activities" class="size-6" />
			</div>
			<p class="text-2xl font-bold text-[#6a6db2]">{activitiesCount}</p>
			<p class="text-sm text-[#8085a1]">Activities</p>
		</button>
		<button
			type="button"
			class={statCardClasses(selectedStat === 'projects')}
			title="View projects"
			onclick={() => {
				selectedStat = 'projects';
				activeClubId && void goto(routes.clubProjects(activeClubId));
			}}
		>
			<div class={iconWrapperClasses(selectedStat === 'projects')}>
				<img src={nodesIcon} alt="Projects" class="size-6" />
			</div>
			<p class="text-2xl font-bold text-[#6a6db2]">{projectsCount}</p>
			<p class="text-sm text-[#8085a1]">Projects</p>
		</button>
	</section>

	{#if latestUpdate}
		<section class="overflow-hidden rounded-[1.1rem] border border-border/80 bg-white">
			<div class="space-y-2 p-3">
				<div class="flex items-center gap-2">
					<Avatar class="size-7 bg-[#d8dbe5]">
						<AvatarImage src={profileImageUrl ?? undefined} alt={displayName} />
						<AvatarFallback class="text-xs font-bold text-[#3a3f50]">{fallback}</AvatarFallback>
					</Avatar>
					<p class="truncate text-[1.07rem] font-bold text-[#2a2a2a]">{latestUpdate.authorName ?? displayName}</p>
					<p class="text-sm text-[#8b8fa0]">{formatRelativeTime(latestUpdate.createdAt)}</p>
				</div>
				<p class="text-[1.05rem] font-bold text-orange-500">Today I learned</p>
				<p class="text-[1.03rem] leading-6 text-[#303030]">{latestUpdate.content}</p>
			</div>
			<div class="grid grid-cols-2 gap-[2px] bg-[#d8dbe5]">
				{#each Array.from({ length: 4 }) as _, index (`tile-${index}`)}
					<img
						src={myClubImage}
						alt={`Update image ${index + 1}`}
						class="aspect-[4/3] w-full object-cover"
						loading="lazy"
					/>
				{/each}
			</div>
		</section>
	{:else}
		<section class="rounded-[1.1rem] border border-dashed border-border/80 bg-white px-4 py-6 text-center">
			<p class="text-[1.02rem] text-[#6b6f80]">No updates yet.</p>
		</section>
	{/if}
</div>
