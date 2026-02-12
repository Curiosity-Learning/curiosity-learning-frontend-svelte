<script lang="ts">
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { setContext } from 'svelte';
	import AppShell from '$lib/components/app/app-shell.svelte';
	import { buildAppNavigation, type AppNavKey, type AppNavItem } from '$lib/components/app/navigation';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { api } from '$convex/_generated/api';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import {
		PAGE_HEADER_CTX,
		type HeaderActionsOverride,
		type HeaderBackConfig,
		type HeaderBannerOverride,
		type HeaderTitleOverride,
		type PageHeaderController
	} from '$lib/app/page-header';

	let { children } = $props();

	const convexClient = useConvexClient();
	const clubsResponse = useQuery(api.clubs.getMyClubs, {});
	const activeContextResponse = useQuery(api.clubs.getActiveClubContext, {});
	let clubs = $derived(clubsResponse.data ?? []);

	$effect(() => {
		if (!browser) return;
		if (clubsResponse.isLoading) return;
		// Run seeding in the background; it is idempotent but can be slow.
		const key = 'cl_bootstrapped_v1';
		if (localStorage.getItem(key) === '1') return;
		void (async () => {
			try {
				await convexClient.mutation(api.bootstrap.seedDefaults, {});
				localStorage.setItem(key, '1');
			} catch {
				// Ignore; we'll retry next time.
			}
		})();
	});

	const isActivePath = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

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
			localStorage.setItem('cl_last_club_id', activeClubId);
		} catch {
			// ignore
		}
	});

	let activeClubItem = $derived(
		clubs.find((club) => club.clubId === activeClubId) ?? null
	);

	let clubIdForNav = $derived(activeClubId ?? (clubs[0]?.clubId ?? null));
	let navigation = $derived(buildAppNavigation(clubIdForNav));
	let navState = $derived(deriveNavState(navigation, activePath));
	let activeNav = $derived(navState.activeNav);
	let title = $derived(
		activeNav === 'club' && navState.title === 'Club'
			? (activeClubItem?.clubName ?? 'Club')
			: navState.title
	);

	let actionsOverride: HeaderActionsOverride = $state(null);
	let bannerOverride: HeaderBannerOverride = $state(null);
	let backConfigOverride: HeaderBackConfig = $state(null);
	let titleOverride: HeaderTitleOverride = $state(null);

	setContext(
		PAGE_HEADER_CTX,
		{
			setActions: (value) => {
				actionsOverride = value;
			},
			clearActions: () => {
				actionsOverride = null;
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
			}
		} satisfies PageHeaderController
	);
</script>

<AppShell
	title={titleOverride ?? title}
	activeNav={activeNav}
	activePath={activePath}
	navigation={navigation}
	headerBack={backConfigOverride ?? undefined}
	headerActions={actionsOverride === null || actionsOverride === false ? undefined : actionsOverride}
	banner={bannerOverride ?? undefined}
>
	{#if clubsResponse.error || activeContextResponse.error}
		<Alert variant="destructive">
			<AlertTitle>Unable to load account context</AlertTitle>
			<AlertDescription>Please refresh the page. If this keeps happening, sign out and sign in again.</AlertDescription>
		</Alert>
	{/if}
	{#if activeNav === 'club' && !clubIdForNav && !clubsResponse.isLoading}
		<Alert>
			<AlertTitle>No active club</AlertTitle>
			<AlertDescription
				>Create a new club or join one with an invite code to unlock sessions, projects, and members.</AlertDescription
			>
		</Alert>
	{/if}
	{@render children()}
</AppShell>
