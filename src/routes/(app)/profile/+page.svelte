<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import BellIcon from '@lucide/svelte/icons/bell';
	import ClipboardCheckIcon from '@lucide/svelte/icons/clipboard-check';
	import Clock3Icon from '@lucide/svelte/icons/clock-3';
	import MessageSquareTextIcon from '@lucide/svelte/icons/message-square-text';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import { env } from '$env/dynamic/public';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { EmptyState, PageHeaderActions, PageHeaderTitle } from '$lib/components/app';
	import UpdateCard from '$lib/components/app/feed/update-card.svelte';
	import type { UpdateCardMediaItem } from '$lib/components/app/feed/update-card.svelte';
	import chessIcon from '$lib/assets/chess.svg';
	import ideaIcon from '$lib/assets/idea.svg';
	import nodesIcon from '$lib/assets/nodes.svg';
	import { authClient } from '$lib/auth-client';
	import { clearClientSessionArtifacts } from '$lib/auth/onboarding-state';
	import { formatScheduleSlot } from '$lib/domain/schedule';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { routes } from '$lib/routes';
	import { t } from '$lib/i18n';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const profileResponse = useStableQuery(api.profiles.getMe, {});
	const globalRoleResponse = useStableQuery(api.profiles.getMyGlobalRole, {});
	let isGlobalAdmin = $derived(globalRoleResponse.data === 'admin');
	// The admin dashboard now lives in a separate repo/deployment (curiosity-learning-admin) —
	// this link only renders when its URL is configured, so we don't hardcode a path that no
	// longer resolves inside this app.
	const adminUrl = env.PUBLIC_ADMIN_URL?.trim() || '';
	const clubsResponse = useStableQuery(api.clubs.getMyClubs, {});
	const updatesResponse = useStableQuery(api.updates.listMine, {});
	const sessionsAttendedResponse = useStableQuery(api.sessions.countAttendedForViewer, {});
	const projectsCountResponse = useStableQuery(api.projects.countForViewer, {});
	const unreadNotificationsResponse = useStableQuery(api.notifications.unreadCount, {});
	const reviewableCountResponse = useStableQuery(api.clubApplications.countReviewableApplications, {});
	const outstandingFormsResponse = useStableQuery(api.forms.listMyOutstandingForms, {});
	let unreadNotifications = $derived(unreadNotificationsResponse.data ?? 0);
	// null = viewer is not a Guide anywhere; the review entry point is hidden entirely.
	let reviewableCount = $derived(reviewableCountResponse.data ?? null);
	let outstandingFormsCount = $derived(outstandingFormsResponse.data?.length ?? 0);

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
	let initialUpdateMediaById = $derived.by(() => {
		return new Map((data.initialUpdateMedia ?? []).map((asset) => [asset.assetId, asset] as const));
	});
	let updates = $derived.by(() => {
		return (updatesResponse.data ?? []).map((item) => ({
			...item,
			media: (item.mediaAssetIds ?? []).map((assetId): UpdateCardMediaItem => {
				const asset = initialUpdateMediaById.get(assetId as Id<'mediaAssets'>) ?? null;
				const isVideo = asset?.mediaKind === 'video' || asset?.contentType?.startsWith('video/');
				return {
					assetId,
					kind: isVideo ? 'video' : 'image',
					url: asset?.signedUrl ?? null
				};
			})
		}));
	});
	let updatesCount = $derived(updates.length);
	let sessionsAttendedCount = $derived(sessionsAttendedResponse.data ?? 0);
	let projectsCount = $derived(projectsCountResponse.data ?? 0);

	const clubLocationLabel = (location?: string | null) => {
		const value = location?.trim();
		if (!value) return null;
		return value.split(',')[0]?.trim() || value;
	};
	const primaryScheduleLabel = (
		scheduleSlots: Array<{
			dayOfWeek: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
			startTime: string;
			endTime: string;
			location: string;
		}>
	) => {
		const [firstSlot] = scheduleSlots;
		return firstSlot ? formatScheduleSlot(firstSlot) : null;
	};
	const statCardClasses =
		'flex min-w-0 flex-col items-start gap-1 rounded-xl border border-transparent bg-gray-50 px-3 py-2 text-left';
</script>

<PageHeaderTitle title="My profile" />
<PageHeaderActions>
	<Button
		variant="ghost"
		size="icon-sm"
		aria-label={unreadNotifications > 0
			? `Open notifications (${unreadNotifications} unread)`
			: 'Open notifications'}
		class="relative"
		href={routes.notifications}
	>
		<BellIcon class="size-5" />
		{#if unreadNotifications > 0}
			<span
				class="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[0.65rem] leading-none font-bold text-white"
			>
				{unreadNotifications > 99 ? '99+' : unreadNotifications}
			</span>
		{/if}
	</Button>
	<Button
		variant="ghost"
		size="icon-sm"
		aria-label="Open settings"
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
					<p class="truncate text-[2rem] leading-[2.2rem] font-bold text-foreground">
						{displayName}
					</p>
					{#if handle}
						<p class="truncate type-body-compact text-muted-foreground">{handle}</p>
					{/if}
					{#if bio}
						<p class="mt-2 type-lead text-foreground">{bio}</p>
					{/if}
				</div>
				<Avatar class="mt-1 size-20 shrink-0 border border-border/70 sm:size-24">
					<AvatarImage src={profileImageUrl ?? undefined} alt={displayName} />
					<AvatarFallback class="bg-gray-200 text-lg font-bold text-gray-800"
						>{fallback}</AvatarFallback
					>
				</Avatar>
			</div>

			<div class="grid grid-cols-3 gap-2">
				<div class={statCardClasses}>
					<div class="flex min-w-0 items-center gap-2">
						<img src={chessIcon} alt="" class="size-4 shrink-0" aria-hidden="true" />
						<p class="text-[1.9rem] leading-[2.1rem] font-bold text-purple-700 tabular-nums">
							{updatesCount}
						</p>
					</div>
					<p class="type-body-medium text-muted-foreground">Updates</p>
				</div>
				<div class={statCardClasses}>
					<div class="flex min-w-0 items-center gap-2">
						<img src={ideaIcon} alt="" class="size-4 shrink-0" aria-hidden="true" />
						<p class="text-[1.9rem] leading-[2.1rem] font-bold text-purple-700 tabular-nums">
							{sessionsAttendedCount}
						</p>
					</div>
					<p class="type-body-medium text-muted-foreground">Sessions attended</p>
				</div>
				<div class={statCardClasses}>
					<div class="flex min-w-0 items-center gap-2">
						<img src={nodesIcon} alt="" class="size-4 shrink-0" aria-hidden="true" />
						<p class="text-[1.9rem] leading-[2.1rem] font-bold text-purple-700 tabular-nums">
							{projectsCount}
						</p>
					</div>
					<p class="type-body-medium text-muted-foreground">Projects</p>
				</div>
			</div>

			<div class="rounded-xl bg-gray-50 px-3 py-2">
				<p class="type-sm text-muted-foreground">Curiosity learner since</p>
				<p class="type-lead-bold text-purple-700 tabular-nums">{joinedDateText}</p>
			</div>

			{#if reviewableCount !== null}
				<a
					href={routes.applicationsReview}
					class="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-gray-50 px-3 py-3 transition-colors hover:border-orange-200 hover:bg-orange-50"
					data-sveltekit-preload-code="hover"
					data-sveltekit-preload-data="hover"
				>
					<div class="flex min-w-0 items-center gap-2">
						<ClipboardCheckIcon class="size-5 shrink-0 text-purple-700" />
						<p class="truncate type-lead-bold text-foreground">Application reviews</p>
					</div>
					{#if reviewableCount > 0}
						<Badge class="shrink-0 rounded-full bg-orange-500 px-2.5 py-0.5 text-sm text-white">
							{reviewableCount}
						</Badge>
					{/if}
				</a>
			{/if}

			<a
				href={routes.feedback}
				class="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-gray-50 px-3 py-3 transition-colors hover:border-orange-200 hover:bg-orange-50"
				data-sveltekit-preload-code="hover"
				data-sveltekit-preload-data="hover"
			>
				<div class="flex min-w-0 items-center gap-2">
					<MessageSquareTextIcon class="size-5 shrink-0 text-purple-700" />
					<p class="truncate type-lead-bold text-foreground">
						{t('feedback.entryPointTitle')}
					</p>
				</div>
				{#if outstandingFormsCount > 0}
					<Badge class="shrink-0 rounded-full bg-orange-500 px-2.5 py-0.5 text-sm text-white">
						{outstandingFormsCount}
					</Badge>
				{/if}
			</a>

			{#if isGlobalAdmin && adminUrl}
				<a
					href={adminUrl}
					class="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-gray-50 px-3 py-3 transition-colors hover:border-orange-200 hover:bg-orange-50"
				>
					<div class="flex min-w-0 items-center gap-2">
						<ShieldIcon class="size-5 shrink-0 text-purple-700" />
						<p class="truncate type-lead-bold text-foreground">
							{t('admin.profileLinkLabel')}
						</p>
					</div>
				</a>
			{/if}

			{#if clubs.length > 0}
				<div class="flex flex-col gap-3">
					<p class="type-h5-bold text-foreground">Current clubs</p>
					<div class="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:-mx-5 sm:px-5">
						{#each clubs as club (club.clubId)}
							<a
								href={routes.clubHome(club.clubId)}
								class="flex min-h-36 w-[17.5rem] shrink-0 flex-col justify-between rounded-2xl border border-orange-100 bg-orange-50 p-4 transition-colors hover:border-orange-200 hover:bg-orange-50"
								data-sveltekit-preload-code="hover"
								data-sveltekit-preload-data="hover"
							>
								<div class="min-w-0">
									<p class="truncate text-[1.35rem] leading-7 font-bold text-orange-500">
										{club.clubName}
									</p>
									{#if club.roleName}
										<p class="type-body-medium text-orange-700">{club.roleName}</p>
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
									{#if primaryScheduleLabel(club.clubScheduleSlots)}
										<Badge
											class="w-fit max-w-full gap-1 rounded-full bg-orange-500 px-3 py-1 text-sm text-white"
										>
											<Clock3Icon class="size-3.5 shrink-0" />
											<span class="truncate">{primaryScheduleLabel(club.clubScheduleSlots)}</span>
										</Badge>
									{/if}
								</div>
							</a>
						{/each}
					</div>
				</div>
			{/if}

			<Button
				variant="ghost"
				class="h-auto w-full py-2 text-[1.35rem] leading-7 text-muted-foreground hover:bg-transparent hover:text-foreground active:bg-transparent"
				onclick={() => void signOut()}
			>
				<LogOutIcon class="size-5" />
				Logout
			</Button>
		</div>
	</section>

	<section class="flex flex-col gap-3">
		<div class="flex items-center justify-between gap-3">
			<p class="type-h4-bold text-foreground">Updates</p>
		</div>
		{#if updatesResponse.isLoading && updates.length === 0}
			<div class="rounded-[1.1rem] border border-border/80 bg-white px-4 py-6 text-center">
				<p class="type-lead text-muted-foreground">Loading updates...</p>
			</div>
		{:else if updates.length === 0}
			<EmptyState
				title={t('feed.profileEmptyTitle')}
				description={t('feed.profileEmptyDescription')}
				class="px-4 py-6"
			/>
		{:else}
			<div class="flex flex-col gap-3">
				{#each updates as item (item.updateId)}
					<UpdateCard
						updateId={item.updateId}
						authorName={item.authorName ?? displayName}
						authorImageUrl={item.authorImageUrl ?? profileImageUrl}
						createdAt={item.createdAt}
						content={item.content}
						media={item.media}
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
						relatedClub={item.clubName
							? {
									label: item.clubName,
									href: routes.clubHome(item.clubId),
									navigationState: {
										headerTitleHint: item.clubName,
										headerTitleHintPath: `/club/${item.clubId}`
									}
								}
							: null}
					/>
				{/each}
			</div>
		{/if}
	</section>
</div>
