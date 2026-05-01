<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import Clock3Icon from '@lucide/svelte/icons/clock-3';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import { api } from '$convex/_generated/api';
	import { PageHeaderActions, PageHeaderBackButton, PageHeaderTitle } from '$lib/components/app';
	import chessIcon from '$lib/assets/chess.svg';
	import ideaIcon from '$lib/assets/idea.svg';
	import nodesIcon from '$lib/assets/nodes.svg';
	import myClubImage from '$lib/assets/images/my_club.png';
	import { authClient } from '$lib/auth-client';
	import { clearClientSessionArtifacts } from '$lib/auth/onboarding-state';
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
	let visibleDesktopUpdates = $derived(activeClubUpdates.slice(0, 2));
	let visibleMobileUpdates = $derived(activeClubUpdates.slice(0, 1));

	const fullName = $derived(
		[profileResponse.data?.firstName, profileResponse.data?.lastName]
			.filter(Boolean)
			.join(' ')
			.trim()
	);
	let displayName = $derived(fullName || profileResponse.data?.username || 'My profile');
	const handle = $derived(
		profileResponse.data?.username ? `@${profileResponse.data.username}` : ''
	);
	const fallback = $derived(
		(profileResponse.data?.username ?? profileResponse.data?.firstName ?? 'Me')
			.slice(0, 2)
			.toUpperCase()
	);
	const aboutText = $derived(
		profileResponse.data?.about?.trim() ||
			'A curious learner who loves designing products and interfaces'
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
	const clubLocationLabel = $derived.by(() => {
		const location = activeClubItem?.clubLocation?.trim();
		if (!location) return 'Location TBD';
		return location.split(',')[0]?.trim() || location;
	});
	const joinedDateText = $derived.by(() => {
		const source = profileResponse.data?._creationTime ?? profileResponse.data?.updatedAt ?? null;
		if (!source) return 'Unknown';
		return new Date(source).toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
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

	const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
	const signOut = async () => {
		clearClientSessionArtifacts();
		await authClient.signOut();
		for (let attempt = 0; attempt < 5; attempt += 1) {
			try {
				const session = await authClient.getSession({
					query: { disableCookieCache: true }
				});
				if (!session.data) break;
			} catch {
				break;
			}
			await delay(150);
		}
		await goto(resolve('/auth/sign-in'), { replaceState: true, invalidateAll: true });
	};

	let updatesCount = $derived(activeClubUpdates.length);
	let activitiesCount = $derived(sessionsResponse.data?.length ?? 0);
	let projectsCount = $derived(projectsResponse.data?.length ?? 0);
	let selectedStat = $state<'updates' | 'activities' | 'projects'>('updates');

	const statCardClasses = (isSelected: boolean) =>
		`flex flex-col items-start gap-1 rounded-xl border px-3 py-2 text-left transition ${
			isSelected
				? 'border-orange-200 bg-white shadow-[0_0_0_1px_rgba(245,121,29,0.10)]'
				: 'border-transparent bg-[#f6f7f9]'
		}`;
</script>

<PageHeaderBackButton fallbackHref={routes.feedMyClubs} />
<PageHeaderTitle title="My profile" />
<PageHeaderActions>
	<Button
		variant="ghost"
		size="icon-sm"
		aria-label="Open settings"
		class="text-[#767b92] hover:text-[#565b72]"
		href={routes.settings}
	>
		<SettingsIcon class="size-5" />
	</Button>
</PageHeaderActions>

<div class="mx-auto flex w-full max-w-7xl flex-col gap-4 py-4">
	{#if profileResponse.error}
		<Alert variant="destructive">
			<AlertTitle>Could not load profile</AlertTitle>
			<AlertDescription>{profileResponse.error.message}</AlertDescription>
		</Alert>
	{/if}

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20.5rem]">
		<section class="rounded-2xl border border-border/70 bg-white p-4 sm:p-5">
			<div class="space-y-4">
				<div class="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
					<div class="min-w-0">
						<p class="truncate text-[2rem] leading-[2.2rem] font-bold text-[#262626]">
							{displayName}
						</p>
						{#if handle}
							<p class="truncate text-sm text-[#8b8fa0]">{handle}</p>
						{/if}
						<p class="mt-2 text-[1.03rem] leading-7 text-[#353535]">{aboutText}</p>
					</div>
					<div class="relative mt-1 size-20 shrink-0 sm:size-24">
						<Avatar class="size-full border border-border/70">
							<AvatarImage src={profileImageUrl ?? undefined} alt={displayName} />
							<AvatarFallback class="bg-[#d8dbe5] text-lg font-bold text-[#3a3f50]"
								>{fallback}</AvatarFallback
							>
						</Avatar>
						<button
							type="button"
							aria-label="Update profile picture"
							class="absolute right-0 bottom-0 z-10 grid size-7 translate-x-1/4 translate-y-1/4 place-items-center rounded-full border-2 border-white bg-orange-500 text-white shadow-sm sm:size-8"
						>
							<CameraIcon class="size-3.5 sm:size-4" />
						</button>
					</div>
				</div>

				<Button
					variant="outline"
					class="h-12 w-full border-orange-200 text-[1.05rem] font-bold text-orange-500 hover:bg-orange-50 hover:text-orange-600"
				>
					Share profile
				</Button>

				<div class="rounded-2xl border border-[#f0decc] bg-[#f8ecdf] p-3 sm:p-4">
					<div
						class="grid grid-cols-[minmax(0,1fr)_5.25rem] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_7rem] sm:gap-3"
					>
						<div class="min-w-0">
							<p class="text-[2rem] leading-[2.2rem] font-bold text-orange-500">My club</p>
							<div class="mt-3 flex max-w-full flex-col gap-2 pr-1">
								<Badge
									class="w-fit max-w-full gap-1 rounded-full bg-orange-500 px-3 py-1 text-sm text-white"
								>
									<MapPinIcon class="size-3.5" />
									<span class="truncate">{clubLocationLabel}</span>
								</Badge>
								{#if meetingSchedule}
									<Badge
										class="w-fit max-w-full gap-1 rounded-full bg-orange-500 px-3 py-1 text-sm text-white"
									>
										<Clock3Icon class="size-3.5" />
										<span class="truncate">{meetingSchedule}</span>
									</Badge>
								{/if}
							</div>
						</div>
						<img
							src={myClubImage}
							alt="My club"
							class="h-20 w-20 self-end rounded-2xl object-cover sm:h-28 sm:w-28"
							loading="lazy"
						/>
					</div>
				</div>

				<div class="grid grid-cols-3 gap-2">
					<button
						type="button"
						class={statCardClasses(selectedStat === 'updates')}
						onclick={() => {
							selectedStat = 'updates';
						}}
					>
						<div class="flex items-center gap-2">
							<img src={chessIcon} alt="" class="size-4" aria-hidden="true" />
							<p class="text-[1.9rem] leading-[2.1rem] font-bold text-[#6f73af]">{updatesCount}</p>
						</div>
						<p class="text-sm font-medium text-[#8085a1]">Updates</p>
					</button>
					<button
						type="button"
						class={statCardClasses(selectedStat === 'activities')}
						onclick={() => {
							selectedStat = 'activities';
							if (activeClubId) {
								void goto(routes.clubSessions(activeClubId));
							}
						}}
					>
						<div class="flex items-center gap-2">
							<img src={ideaIcon} alt="" class="size-4" aria-hidden="true" />
							<p class="text-[1.9rem] leading-[2.1rem] font-bold text-[#6f73af]">
								{activitiesCount}
							</p>
						</div>
						<p class="text-sm font-medium text-[#8085a1]">Activities</p>
					</button>
					<button
						type="button"
						class={statCardClasses(selectedStat === 'projects')}
						onclick={() => {
							selectedStat = 'projects';
							if (activeClubId) {
								void goto(routes.clubProjects(activeClubId));
							}
						}}
					>
						<div class="flex items-center gap-2">
							<img src={nodesIcon} alt="" class="size-4" aria-hidden="true" />
							<p class="text-[1.9rem] leading-[2.1rem] font-bold text-[#6f73af]">{projectsCount}</p>
						</div>
						<p class="text-sm font-medium text-[#8085a1]">Projects</p>
					</button>
				</div>

				<div class="rounded-xl bg-[#f2f3fa] px-3 py-2">
					<p class="text-xs text-[#8b8fa0]">Curiosity learner since</p>
					<p class="text-[1.05rem] font-bold text-[#6f73af]">{joinedDateText}</p>
				</div>

				<button
					type="button"
					class="flex w-full items-center justify-center gap-2 py-2 text-[1.6rem] leading-7 font-bold text-[#5e637a] transition-colors hover:text-[#43475d]"
					onclick={() => void signOut()}
				>
					<LogOutIcon class="size-5" />
					Logout
				</button>
			</div>
		</section>

		<section
			class="hidden rounded-2xl border border-border/70 bg-white p-4 lg:flex lg:flex-col lg:gap-3"
		>
			<p class="text-[2rem] leading-[2.2rem] font-bold text-[#44495f]">Updates</p>
			{#if visibleDesktopUpdates.length === 0}
				<div class="rounded-xl border border-dashed border-border/80 px-4 py-6 text-center">
					<p class="text-[1.02rem] text-[#6b6f80]">No updates yet.</p>
				</div>
			{:else}
				{#each visibleDesktopUpdates as item (item.updateId)}
					<div class="rounded-xl border border-border/80 bg-white p-3">
						<div class="flex items-center gap-2">
							<Avatar class="size-6 bg-[#d8dbe5]">
								<AvatarImage
									src={item.authorImageUrl ?? profileImageUrl ?? undefined}
									alt={item.authorName}
								/>
								<AvatarFallback class="text-[0.6rem] font-bold text-[#3a3f50]"
									>{fallback}</AvatarFallback
								>
							</Avatar>
							<p class="truncate text-[1.05rem] font-bold text-[#2a2a2a]">
								{item.authorName ?? displayName}
							</p>
							<p class="text-sm text-[#8b8fa0]">{formatRelativeTime(item.createdAt)}</p>
						</div>
						<p class="mt-1 text-[1.05rem] font-bold text-orange-500">Today I learned</p>
						<p class="mt-1 line-clamp-3 text-[1rem] leading-6 text-[#303030]">{item.content}</p>
						<div class="mt-2 grid grid-cols-2 gap-[2px] overflow-hidden rounded-md bg-[#d8dbe5]">
							{#each Array.from({ length: 4 }, (_, index) => index) as index (`desktop-tile-${item.updateId}-${index}`)}
								<div class="relative">
									<img
										src={myClubImage}
										alt={`Update image ${index + 1}`}
										class="aspect-[4/3] w-full object-cover"
										loading="lazy"
									/>
									{#if index === 3}
										<div
											class="absolute inset-0 grid place-items-center bg-black/45 text-2xl font-bold text-white"
										>
											+3
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/each}
			{/if}
		</section>
	</div>

	<section class="flex flex-col gap-3 lg:hidden">
		{#if visibleMobileUpdates.length === 0}
			<section
				class="rounded-[1.1rem] border border-dashed border-border/80 bg-white px-4 py-6 text-center"
			>
				<p class="text-[1.02rem] text-[#6b6f80]">No updates yet.</p>
			</section>
		{:else}
			{#each visibleMobileUpdates as item (item.updateId)}
				<div class="rounded-xl border border-border/80 bg-white p-3">
					<div class="flex items-center gap-2">
						<Avatar class="size-7 bg-[#d8dbe5]">
							<AvatarImage
								src={item.authorImageUrl ?? profileImageUrl ?? undefined}
								alt={item.authorName}
							/>
							<AvatarFallback class="text-xs font-bold text-[#3a3f50]">{fallback}</AvatarFallback>
						</Avatar>
						<p class="truncate text-[1.07rem] font-bold text-[#2a2a2a]">
							{item.authorName ?? displayName}
						</p>
						<p class="text-sm text-[#8b8fa0]">{formatRelativeTime(item.createdAt)}</p>
					</div>
					<p class="mt-1 text-[1.05rem] font-bold text-orange-500">Today I learned</p>
					<p class="mt-1 text-[1.03rem] leading-6 text-[#303030]">{item.content}</p>
					<div class="mt-2 grid grid-cols-2 gap-[2px] overflow-hidden rounded-md bg-[#d8dbe5]">
						{#each Array.from({ length: 4 }, (_, index) => index) as index (`mobile-tile-${item.updateId}-${index}`)}
							<div class="relative">
								<img
									src={myClubImage}
									alt={`Update image ${index + 1}`}
									class="aspect-[4/3] w-full object-cover"
									loading="lazy"
								/>
								{#if index === 3}
									<div
										class="absolute inset-0 grid place-items-center bg-black/45 text-2xl font-bold text-white"
									>
										+3
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}
		{/if}
	</section>
</div>
