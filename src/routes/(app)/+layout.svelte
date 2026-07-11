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
	import * as Dialog from '$lib/components/ui/dialog';
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
	// Only clubId/clubName/roleKey/clubKind are used in this layout (switcher items + the
	// clubName title fallback below) — the lightweight switcher query avoids the schedule
	// slots/video URL/profile fetches `getMyClubs` does per club. Pages that need the full
	// payload (settings, sessions, members, etc.) still query `getMyClubs` directly.
	const clubsResponse = useStableQuery(api.clubs.getMyClubSwitcherItems, () =>
		isAuthReady ? {} : 'skip'
	);
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

	// PRD 6.11.3 (CL-733): graduated feedback enforcement. Server-computed phase (none / reminder
	// / escalation / blocked) keyed to the oldest overdue feedback obligation. This is a UI-level
	// access block, not a data-layer one (see forms.ts getMyEnforcementState for the full judgment
	// call write-up) — /feedback and the Report Issue dialog must both keep working from the
	// blocked screen, which is why neither route nor those mutations are gated behind this check.
	const enforcementResponse = useStableQuery(api.forms.getMyEnforcementState, () =>
		isAuthReady ? {} : 'skip'
	);
	let enforcementPhase = $derived(enforcementResponse.data?.phase ?? 'none');
	let enforcementClubName = $derived(enforcementResponse.data?.clubName ?? '');
	let blockedReportDialogOpen = $state(false);

	const REMINDER_DISMISS_KEY = 'feedback-enforcement-reminder-dismissed';
	const ESCALATION_MODAL_SEEN_KEY = 'feedback-enforcement-escalation-modal-seen';
	let reminderBannerDismissed = $state(false);
	let escalationModalOpen = $state(false);

	$effect(() => {
		if (!browser) return;
		if (enforcementPhase !== 'reminder') {
			reminderBannerDismissed = false;
			return;
		}
		reminderBannerDismissed = sessionStorage.getItem(REMINDER_DISMISS_KEY) === '1';
	});

	$effect(() => {
		if (!browser) return;
		if (enforcementPhase !== 'escalation') {
			escalationModalOpen = false;
			return;
		}
		const alreadySeen = sessionStorage.getItem(ESCALATION_MODAL_SEEN_KEY) === '1';
		if (alreadySeen) return;
		escalationModalOpen = true;
		sessionStorage.setItem(ESCALATION_MODAL_SEEN_KEY, '1');
	});

	const dismissReminderBanner = () => {
		reminderBannerDismissed = true;
		if (browser) sessionStorage.setItem(REMINDER_DISMISS_KEY, '1');
	};

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
	// PRD 6.11.3 (CL-733): /feedback must stay reachable from every enforcement phase (including
	// blocked), so both the blocked-screen gate and the reminder/escalation banners suppress
	// themselves on /feedback routes.
	let isFeedbackRoute = $derived(activePath === routes.feedback || activePath.startsWith('/feedback/'));
	let isBlocked = $derived(enforcementPhase === 'blocked' && !isFeedbackRoute);

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
			activePath === routes.notifications ||
			activePath === routes.child ||
			activePath.startsWith(`${routes.child}/`)
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
{:else if isBlocked}
	<!-- PRD 6.11.3 (CL-733): day 15+ overdue feedback blocks platform access. Distinct copy from
	     the suspension screen above (this is about unresolved feedback, not a suspension) — /feedback
	     itself and the Report Issue dialog both stay reachable (route check in isFeedbackRoute
	     above lets /feedback render past this block; the dialog is rendered directly here). -->
	<div class="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
		<h1 class="type-lg-bold text-foreground">{t('feedbackEnforcement.blockedTitle')}</h1>
		<p class="type-sm max-w-md text-muted-foreground">
			{t('feedbackEnforcement.blockedBody').replace('{club}', enforcementClubName)}
		</p>
		<Button onclick={() => goto(routes.feedback)}>
			{t('feedbackEnforcement.blockedAction')}
		</Button>
		<Button variant="outline" onclick={() => (blockedReportDialogOpen = true)}>
			{t('feedbackEnforcement.reportIssueAction')}
		</Button>
	</div>
	<ReportIssueDialog
		targetType="user"
		targetId={profileResponse.data?._id ?? ''}
		showTrigger={false}
		bind:open={blockedReportDialogOpen}
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
		<!-- PRD 6.11.3 (CL-733): reminder phase (days 1-7 past deadline) — persistent banner,
		     dismissible for the rest of this browser session (sessionStorage), not per-route. -->
		{#if enforcementPhase === 'reminder' && !reminderBannerDismissed && !isFeedbackRoute}
			<Alert class="flex items-start justify-between gap-3">
				<div>
					<AlertTitle
						>{t('feedbackEnforcement.reminderBanner').replace('{club}', enforcementClubName)}</AlertTitle
					>
				</div>
				<div class="flex shrink-0 items-center gap-2">
					<Button size="sm" onclick={() => goto(routes.feedback)}>
						{t('feedbackEnforcement.reminderBannerAction')}
					</Button>
					<Button size="sm" variant="ghost" onclick={dismissReminderBanner}>
						{t('feedbackEnforcement.reminderBannerDismiss')}
					</Button>
				</div>
			</Alert>
		{/if}
		<!-- Escalation phase (days 8-14): same persistent banner as reminder, plus a once-per-session
		     modal (below) prompted on app open. -->
		{#if enforcementPhase === 'escalation' && !isFeedbackRoute}
			<Alert variant="destructive" class="flex items-start justify-between gap-3">
				<div>
					<AlertTitle
						>{t('feedbackEnforcement.reminderBanner').replace('{club}', enforcementClubName)}</AlertTitle
					>
				</div>
				<Button size="sm" onclick={() => goto(routes.feedback)}>
					{t('feedbackEnforcement.reminderBannerAction')}
				</Button>
			</Alert>
		{/if}
		{@render children()}
	{/if}
</AppShell>

<Dialog.Root bind:open={escalationModalOpen}>
	<Dialog.Content class="flex flex-col gap-4">
		<Dialog.Header class="flex flex-col gap-2">
			<Dialog.Title>{t('feedbackEnforcement.escalationModalTitle')}</Dialog.Title>
			<Dialog.Description>
				{t('feedbackEnforcement.escalationModalBody').replace('{club}', enforcementClubName)}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (escalationModalOpen = false)}>
				{t('feedbackEnforcement.escalationModalDismiss')}
			</Button>
			<Button
				onclick={() => {
					escalationModalOpen = false;
					goto(routes.feedback);
				}}
			>
				{t('feedbackEnforcement.escalationModalAction')}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
{/if}
