<script lang="ts">
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { setContext } from 'svelte';
	import AppShell from '$lib/components/app/app-shell.svelte';
	import {
		buildAppNavigation,
		type AppNavKey,
		type AppNavItem
	} from '$lib/components/app/navigation';
	import { LoadingState } from '$lib/components/app';
	import ClubSwitcher from '$lib/components/app/club/club-switcher.svelte';
	import ReportIssueDialog from '$lib/components/app/report-issue-dialog.svelte';
	import { Button } from '$lib/components/ui/button';
	import { LAST_CLUB_ID_STORAGE_KEY } from '$lib/auth/onboarding-state';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { api } from '$convex/_generated/api';
	import { routes } from '$lib/routes';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { t } from '$lib/i18n';
	import {
		PAGE_HEADER_CTX,
		type HeaderActionsOverride,
		type HeaderBackConfig,
		type HeaderBannerOverride,
		type BottomNavHiddenOverride,
		type HeaderSearchOverride,
		type HeaderTitleContentOverride,
		type HeaderTitleOverride,
		type PageContentModeOverride,
		type PageHeaderController
	} from '$lib/app/page-header';

	let { children } = $props();

	const auth = useAuth();
	let isAuthReady = $derived(!auth.isLoading && auth.isAuthenticated);
	let ensuredProfileForSession = $state(false);

	const convexClient = useConvexClient();
	const clubsResponse = useStableQuery(api.clubs.getMyClubs, () => (isAuthReady ? {} : 'skip'));
	const activeContextResponse = useStableQuery(api.clubs.getActiveClubContext, () =>
		isAuthReady ? {} : 'skip'
	);
	const profileResponse = useStableQuery(api.profiles.getMe, () => (isAuthReady ? {} : 'skip'));
	let clubs = $derived(clubsResponse.data ?? []);
	let sidebarProfileName = $derived.by(() => {
		const profile = profileResponse.data;
		if (!profile) return 'Profile';
		const fullName = [profile.firstName ?? '', profile.lastName ?? ''].join(' ').trim();
		return profile.username || fullName || 'Profile';
	});
	let sidebarProfileInitials = $derived.by(() => {
		const name = sidebarProfileName.trim();
		if (!name) return 'PR';
		return name
			.split(' ')
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('');
	});
	let sidebarProfileImageUrl = $derived(profileResponse.data?.coverPhotoUrl ?? null);

	// PRD 6.14.7 (CL-730): suspended users get a blocking screen instead of the app shell. Report
	// Issue must stay reachable per PRD, so it's rendered directly on this screen (not gated by
	// the suspension check itself — `reports.submitReport` deliberately bypasses it server-side).
	let isSuspended = $derived(Boolean(profileResponse.data?.suspendedAt));
	let suspendedReason = $derived(profileResponse.data?.suspendedReason ?? null);
	let suspendedReportDialogOpen = $state(false);

	$effect(() => {
		if (!browser) return;
		if (!isAuthReady) {
			ensuredProfileForSession = false;
			return;
		}
		if (ensuredProfileForSession) return;
		ensuredProfileForSession = true;
		// Keep this non-blocking so navigation does not wait on account initialization.
		void convexClient.mutation(api.auth.ensureProfile, {}).catch(() => {
			// Ignore; profile will be ensured by subsequent authenticated mutations/queries.
		});
	});

	const isActivePath = (pathname: string, href: string) =>
		pathname === href || pathname.startsWith(`${href}/`);

	const deriveNavState = (items: AppNavItem[], pathname: string) => {
		for (const item of items) {
			for (const child of item.children ?? []) {
				if (isActivePath(pathname, child.href)) {
					return { activeNav: item.key, title: child.label };
				}
			}
			if (isActivePath(pathname, item.href)) {
				return { activeNav: item.key, title: item.label };
			}
		}
		return { activeNav: 'club' as AppNavKey, title: 'Club' };
	};

	let activePath = $derived(page.url.pathname);

	let clubIdFromUrl = $derived((page.params as Record<string, string | undefined>).clubId ?? null);
	let activeClubId = $derived(clubIdFromUrl ?? activeContextResponse.data?.activeClubId ?? null);

	$effect(() => {
		if (!browser) return;
		if (!activeClubId) return;
		try {
			localStorage.setItem(LAST_CLUB_ID_STORAGE_KEY, activeClubId);
		} catch {
			// ignore
		}
	});

	let activeClubItem = $derived(clubs.find((club) => club.clubId === activeClubId) ?? null);
	let clubSwitcherItems = $derived(
		clubs.map((club) => ({
			clubId: club.clubId,
			clubName: club.clubName,
			roleKey: club.roleKey,
			clubKind: club.clubKind
		}))
	);

	let clubIdForNav = $derived(activeClubId ?? clubs[0]?.clubId ?? null);
	let hasClubAccess = $derived(clubs.length > 0);
	let navigation = $derived(
		buildAppNavigation(clubIdForNav, {
			hasClubAccess
		})
	);
	let navState = $derived(deriveNavState(navigation, activePath));
	let activeNav = $derived(navState.activeNav);

	// The club switcher replaces the plain title on the club dashboard's top-level
	// tabs (dashboard root, sessions, projects, members). Drill-down views like club
	// settings set their own static title via PageHeaderTitle, so they are excluded.
	let isClubSwitcherRoute = $derived.by(() => {
		if (activeNav !== 'club' || !clubIdForNav) return false;
		const clubRoot = `/club/${clubIdForNav}`;
		if (activePath === clubRoot) return true;
		const subViewsWithSwitcher = ['/sessions', '/projects', '/members'];
		return subViewsWithSwitcher.some(
			(subView) => activePath === `${clubRoot}${subView}` || activePath.startsWith(`${clubRoot}${subView}/`)
		);
	});

	let title = $derived(
		activeNav === 'club' && navState.title === 'Club'
			? (activeClubItem?.clubName ?? 'Club')
			: navState.title
	);

	$effect(() => {
		if (!browser) return;
		if (!isAuthReady) return;
		if (clubsResponse.isLoading) return;
		if (clubs.length > 0) return;
		if (
			activePath === routes.noClub ||
			activePath === routes.newClub ||
			activePath.startsWith(`${routes.newClub}/`) ||
			activePath === routes.profile ||
			activePath === routes.settings ||
			activePath === routes.notifications
		) {
			return;
		}
		void goto(routes.newClub, { replaceState: true });
	});
	let hintedTitle = $derived.by(() => {
		const hint = page.state.headerTitleHint?.trim();
		const hintPath = page.state.headerTitleHintPath;
		if (!hint || !hintPath) return null;
		return isActivePath(activePath, hintPath) ? hint : null;
	});

	let actionsOverride: HeaderActionsOverride = $state(null);
	let searchOverride: HeaderSearchOverride = $state(null);
	let bannerOverride: HeaderBannerOverride = $state(null);
	let backConfigOverride: HeaderBackConfig = $state(null);
	let titleOverride: HeaderTitleOverride = $state(null);
	let titleContentOverride: HeaderTitleContentOverride = $state(null);
	let bottomNavHiddenOverride: BottomNavHiddenOverride = $state(null);
	let contentModeOverride: PageContentModeOverride = $state(null);
	let showDefaultClubSwitcher = $derived(isClubSwitcherRoute && titleContentOverride === null);

	setContext(PAGE_HEADER_CTX, {
		setActions: (value) => {
			actionsOverride = value;
		},
		clearActions: () => {
			actionsOverride = null;
		},
		setSearch: (value) => {
			searchOverride = value;
		},
		clearSearch: () => {
			searchOverride = null;
		},
		setBanner: (value) => {
			bannerOverride = value;
		},
		clearBanner: () => {
			bannerOverride = null;
		},
		setBackConfig: (value) => {
			backConfigOverride = value;
		},
		clearBackConfig: () => {
			backConfigOverride = null;
		},
		setTitle: (value) => {
			titleOverride = value;
		},
		clearTitle: () => {
			titleOverride = null;
		},
		setTitleContent: (value) => {
			titleContentOverride = value;
		},
		clearTitleContent: () => {
			titleContentOverride = null;
		},
		setBottomNavHidden: (value) => {
			bottomNavHiddenOverride = value;
		},
		clearBottomNavHidden: () => {
			bottomNavHiddenOverride = null;
		},
		setContentMode: (value) => {
			contentModeOverride = value;
		},
		clearContentMode: () => {
			contentModeOverride = null;
		}
	} satisfies PageHeaderController);
</script>

{#snippet clubSwitcherTitleContent()}
	<ClubSwitcher clubs={clubSwitcherItems} {activeClubId} />
{/snippet}

{#if isSuspended}
	<div class="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
		<h1 class="type-lg-bold text-foreground">{t('suspendedScreen.title')}</h1>
		<p class="type-sm max-w-md text-muted-foreground">
			{suspendedReason || t('suspendedScreen.defaultReason')}
		</p>
		<Button variant="outline" onclick={() => (suspendedReportDialogOpen = true)}>
			{t('suspendedScreen.reportIssueAction')}
		</Button>
	</div>
	<ReportIssueDialog
		targetType="user"
		targetId={profileResponse.data?._id ?? ''}
		showTrigger={false}
		bind:open={suspendedReportDialogOpen}
	/>
{:else}
<AppShell
	title={titleOverride ?? hintedTitle ?? title}
	{activeNav}
	{activePath}
	{navigation}
	headerBack={backConfigOverride ?? undefined}
	headerTitleContent={titleContentOverride ??
		(showDefaultClubSwitcher ? clubSwitcherTitleContent : undefined)}
	hideBottomNav={bottomNavHiddenOverride ?? undefined}
	headerActions={actionsOverride === null || actionsOverride === false
		? undefined
		: actionsOverride}
	headerSearch={searchOverride ?? undefined}
	contentMode={contentModeOverride ?? undefined}
	banner={bannerOverride ?? undefined}
	{sidebarProfileName}
	{sidebarProfileImageUrl}
	{sidebarProfileInitials}
>
	{#if auth.isLoading}
		<LoadingState class="min-h-48" label="Loading account" />
	{:else if !auth.isAuthenticated}
		<Alert>
			<AlertTitle>Session expired</AlertTitle>
			<AlertDescription>Sign in again to continue.</AlertDescription>
		</Alert>
	{:else}
		{#if clubsResponse.error || activeContextResponse.error}
			<Alert variant="destructive">
				<AlertTitle>Unable to load account context</AlertTitle>
				<AlertDescription
					>Please refresh the page. If this keeps happening, sign out and sign in again.</AlertDescription
				>
			</Alert>
		{/if}
		{#if activeNav === 'club' && activePath !== routes.noClub && !clubIdForNav && !clubsResponse.isLoading}
			<Alert>
				<AlertTitle>No active club</AlertTitle>
				<AlertDescription
					>Create a new club or join one with an invite code to unlock sessions, projects, and
					members.</AlertDescription
				>
			</Alert>
		{/if}
		{@render children()}
	{/if}
</AppShell>
{/if}
