<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Clock3Icon from '@lucide/svelte/icons/clock-3';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import { api } from '$convex/_generated/api';
	import { PageHeaderActions, PageHeaderTitle } from '$lib/components/app';
	import UpdateCard from '$lib/components/app/feed/update-card.svelte';
	import chessIcon from '$lib/assets/chess.svg';
	import ideaIcon from '$lib/assets/idea.svg';
	import nodesIcon from '$lib/assets/nodes.svg';
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
	const updatesResponse = useStableQuery(api.updates.listMine, {});
	const sessionsAttendedResponse = useStableQuery(api.sessions.countAttendedForViewer, {});
	const projectsCountResponse = useStableQuery(api.projects.countForViewer, {});

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
	const bio = $derived(profileResponse.data?.about?.trim() ?? '');
	const profileImageUrl = $derived.by(() => {
		const profileImageAssetId = profileResponse.data?.profileImageMediaAssetId ?? null;
		if (profileImageAssetId && data.initialProfileImage?.assetId === profileImageAssetId) {
			return data.initialProfileImage.signedUrl;
		}
		return null;
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

	let clubs = $derived(clubsResponse.data ?? []);
	let updates = $derived(updatesResponse.data ?? []);
	let updatesCount = $derived(updates.length);
	let sessionsAttendedCount = $derived(sessionsAttendedResponse.data ?? 0);
	let projectsCount = $derived(projectsCountResponse.data ?? 0);

	const clubLocationLabel = (location?: string | null) => {
		const value = location?.trim();
		if (!value) return null;
		return value.split(',')[0]?.trim() || value;
	};
	const meetingSchedule = (day?: string | null, time?: string | null) => {
		if (day && time) return `${day} at ${time}`;
		return day ?? time ?? null;
	};
	const statCardClasses =
		'flex min-w-0 flex-col items-start gap-1 rounded-xl border border-transparent bg-[#f6f7f9] px-3 py-2 text-left';
</script>

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

<div class="flex w-full flex-col gap-4 py-4">
	{#if profileResponse.error}
		<Alert variant="destructive">
			<AlertTitle>Could not load profile</AlertTitle>
			<AlertDescription>{profileResponse.error.message}</AlertDescription>
		</Alert>
	{/if}

	<section class="rounded-2xl border border-border/70 bg-white p-4 sm:p-5">
		<div class="flex flex-col gap-5">
			<div class="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
				<div class="min-w-0">
					<p class="truncate text-[2rem] leading-[2.2rem] font-bold text-[#262626]">
						{displayName}
					</p>
					{#if handle}
						<p class="truncate text-sm text-[#8b8fa0]">{handle}</p>
					{/if}
					{#if bio}
						<p class="mt-2 text-[1.03rem] leading-7 text-[#353535]">{bio}</p>
					{/if}
				</div>
				<Avatar class="mt-1 size-20 shrink-0 border border-border/70 sm:size-24">
					<AvatarImage src={profileImageUrl ?? undefined} alt={displayName} />
					<AvatarFallback class="bg-[#d8dbe5] text-lg font-bold text-[#3a3f50]"
						>{fallback}</AvatarFallback
					>
				</Avatar>
			</div>

			<div class="grid grid-cols-3 gap-2">
				<div class={statCardClasses}>
					<div class="flex min-w-0 items-center gap-2">
						<img src={chessIcon} alt="" class="size-4 shrink-0" aria-hidden="true" />
						<p class="text-[1.9rem] leading-[2.1rem] font-bold text-[#6f73af]">{updatesCount}</p>
					</div>
					<p class="text-sm font-medium text-[#8085a1]">Updates</p>
				</div>
				<div class={statCardClasses}>
					<div class="flex min-w-0 items-center gap-2">
						<img src={ideaIcon} alt="" class="size-4 shrink-0" aria-hidden="true" />
						<p class="text-[1.9rem] leading-[2.1rem] font-bold text-[#6f73af]">
							{sessionsAttendedCount}
						</p>
					</div>
					<p class="text-sm font-medium text-[#8085a1]">Sessions attended</p>
				</div>
				<div class={statCardClasses}>
					<div class="flex min-w-0 items-center gap-2">
						<img src={nodesIcon} alt="" class="size-4 shrink-0" aria-hidden="true" />
						<p class="text-[1.9rem] leading-[2.1rem] font-bold text-[#6f73af]">{projectsCount}</p>
					</div>
					<p class="text-sm font-medium text-[#8085a1]">Projects</p>
				</div>
			</div>

			<div class="rounded-xl bg-[#f6f7f9] px-3 py-2">
				<p class="text-xs text-[#8b8fa0]">Curiosity learner since</p>
				<p class="text-[1.05rem] font-bold text-[#6f73af]">{joinedDateText}</p>
			</div>

			{#if clubs.length > 0}
				<div class="flex flex-col gap-3">
					<p class="text-[1.2rem] leading-6 font-bold text-[#44495f]">Current clubs</p>
					<div class="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:-mx-5 sm:px-5">
						{#each clubs as club (club.clubId)}
							<a
								href={routes.clubHome(club.clubId)}
								class="flex min-h-36 w-[17.5rem] shrink-0 flex-col justify-between rounded-2xl border border-[#f0decc] bg-[#f8ecdf] p-4 transition-colors hover:border-orange-200 hover:bg-orange-50"
								data-sveltekit-preload-code="hover"
								data-sveltekit-preload-data="hover"
							>
								<div class="min-w-0">
									<p class="truncate text-[1.35rem] leading-7 font-bold text-orange-500">
										{club.clubName}
									</p>
									{#if club.roleName}
										<p class="text-sm font-medium text-[#7a5c45]">{club.roleName}</p>
									{/if}
								</div>
								<div class="flex max-w-full flex-col gap-2">
									{#if clubLocationLabel(club.clubLocation)}
										<Badge
											class="w-fit max-w-full gap-1 rounded-full bg-orange-500 px-3 py-1 text-sm text-white"
										>
											<MapPinIcon class="size-3.5 shrink-0" />
											<span class="truncate">{clubLocationLabel(club.clubLocation)}</span>
										</Badge>
									{/if}
									{#if meetingSchedule(club.clubMeetingDay, club.clubMeetingTime)}
										<Badge
											class="w-fit max-w-full gap-1 rounded-full bg-orange-500 px-3 py-1 text-sm text-white"
										>
											<Clock3Icon class="size-3.5 shrink-0" />
											<span class="truncate"
												>{meetingSchedule(club.clubMeetingDay, club.clubMeetingTime)}</span
											>
										</Badge>
									{/if}
								</div>
							</a>
						{/each}
					</div>
				</div>
			{/if}

			<button
				type="button"
				class="flex w-full items-center justify-center gap-2 py-2 text-[1.35rem] leading-7 font-bold text-[#5e637a] transition-colors hover:text-[#43475d]"
				onclick={() => void signOut()}
			>
				<LogOutIcon class="size-5" />
				Logout
			</button>
		</div>
	</section>

	<section class="flex flex-col gap-3">
		<div class="flex items-center justify-between gap-3">
			<p class="text-[1.5rem] leading-8 font-bold text-[#44495f]">Updates</p>
		</div>
		{#if updatesResponse.isLoading && updates.length === 0}
			<div class="rounded-[1.1rem] border border-border/80 bg-white px-4 py-6 text-center">
				<p class="text-[1.02rem] text-[#6b6f80]">Loading updates...</p>
			</div>
		{:else if updates.length === 0}
			<div class="rounded-[1.1rem] border border-dashed border-border/80 bg-white px-4 py-6 text-center">
				<p class="text-[1.02rem] text-[#6b6f80]">No updates yet.</p>
			</div>
		{:else}
			<div class="flex flex-col gap-3">
				{#each updates as item (item.updateId)}
					<UpdateCard
						authorName={item.authorName ?? displayName}
						authorImageUrl={item.authorImageUrl ?? profileImageUrl}
						createdAt={item.createdAt}
						content={item.content}
						relatedQuestion={item.questionContent ? { label: item.questionContent } : null}
						relatedProject={item.projectId && item.projectName
							? {
									label: item.projectName,
									href: routes.projectDetail(item.projectId),
									navigationState: {
										headerTitleHint: item.projectName,
										headerTitleHintPath: `/project/${item.projectId}`
									}
								}
							: null}
					/>
				{/each}
			</div>
		{/if}
	</section>
</div>
