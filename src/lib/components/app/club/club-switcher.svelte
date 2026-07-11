<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { useConvexClient } from 'convex-svelte';
	import { showGlobalSnackbar } from '$lib/components/app';
	import { Button } from '$lib/components/ui/button';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuLabel,
		DropdownMenuSeparator,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import { formatT, t } from '$lib/i18n';
	import { buildClubSwitchPath } from '$lib/navigation/club-switch-path';
	import { markClubSwitchTarget } from '$lib/navigation/back';
	import { LAST_CLUB_ID_STORAGE_KEY } from '$lib/auth/onboarding-state';
	import { routes } from '$lib/routes';

	type ClubSwitcherItem = {
		clubId: string;
		clubName: string;
		roleKey: 'guide' | 'learner' | null;
		clubKind?: 'curiosity' | 'coc';
	};

	type Props = {
		clubs: ClubSwitcherItem[];
		activeClubId: string | null;
		class?: string;
	};

	let { clubs, activeClubId, class: className }: Props = $props();

	const convexClient = useConvexClient();

	let activeClub = $derived(clubs.find((club) => club.clubId === activeClubId) ?? null);
	// The switcher (and its "New club" entry) is always reachable once a user has any club,
	// not just when they belong to more than one — see CEO decision 2026-07-11: without this,
	// a single-club user has no discoverable way back to the join-or-start screen.
	let switchingClubId = $state<string | null>(null);

	const roleLabel = (roleKey: ClubSwitcherItem['roleKey']) => {
		if (roleKey === 'guide') return t('clubSwitcher.roleGuide');
		if (roleKey === 'learner') return t('clubSwitcher.roleLearner');
		return null;
	};

	const switchClub = async (nextClubId: string) => {
		if (!activeClubId || nextClubId === activeClubId || switchingClubId) return;
		switchingClubId = nextClubId;

		// Persist locally and navigate immediately — every downstream consumer (page data
		// queries, mutations like session creation) keys off the URL's clubId, not the
		// server's "active club" pointer, so the visible switch does not need to wait on the
		// switchActiveClub round trip to be correct. That mutation still runs (it's what lets
		// a returning session on another device restore the same active club), but it's fired
		// in the background so a slow network doesn't make the switch feel sluggish.
		try {
			localStorage.setItem(LAST_CLUB_ID_STORAGE_KEY, nextClubId);
		} catch {
			// Ignore storage errors; the server-side active club is still updated below.
		}

		const target = buildClubSwitchPath(page.url.pathname, activeClubId, nextClubId);
		// Mark the destination so the in-app back button prefers the new club's home over
		// history.back() for the very next back action (see $lib/navigation/back.ts).
		markClubSwitchTarget(target);
		// replaceState: the switch itself shouldn't leave a history entry pointing at the
		// old club's page — see $lib/navigation/back.ts for the full rationale.
		const navigatePromise = goto(target, { replaceState: true });

		const mutationPromise = convexClient
			.mutation(api.clubs.switchActiveClub, { clubId: nextClubId as Id<'clubs'> })
			.catch((error) => {
				showGlobalSnackbar({
					title: t('clubSwitcher.switchFailureTitle'),
					description:
						error instanceof Error ? error.message : t('clubSwitcher.switchFailureDescription')
				});
			});

		try {
			await navigatePromise;
		} finally {
			switchingClubId = null;
		}
		void mutationPromise;
	};
</script>

{#if clubs.length > 0}
	<DropdownMenu>
		<DropdownMenuTrigger class={`-ml-2 inline-flex w-fit max-w-full min-w-0 overflow-hidden ${className ?? ''}`}>
			<Button
				variant="ghost"
				class="max-w-full min-w-0 shrink justify-start gap-1 px-1.5 text-foreground hover:text-foreground"
				aria-label={formatT('clubSwitcher.triggerLabel', {
					clubName: activeClub?.clubName ?? ''
				})}
			>
				<span class="type-step-title min-w-0 flex-1 truncate">{activeClub?.clubName ?? ''}</span>
				<ChevronDownIcon class="size-4 shrink-0 text-muted-foreground" />
			</Button>
		</DropdownMenuTrigger>
		<DropdownMenuContent align="start" class="w-64">
			<DropdownMenuLabel>{t('clubSwitcher.menuLabel')}</DropdownMenuLabel>
			{#each clubs as club (club.clubId)}
				<DropdownMenuItem
					class="justify-between gap-3 py-2"
					disabled={switchingClubId !== null}
					onSelect={() => void switchClub(club.clubId)}
				>
					<span class="flex min-w-0 flex-1 items-center gap-2">
						<span class="truncate">{club.clubName}</span>
						{#if club.clubKind === 'coc'}
							<span class="type-xs shrink-0 rounded-full bg-orange-100 px-1.5 py-0.5 text-orange-700">
								{t('clubSwitcher.cocBadge')}
							</span>
						{/if}
						{#if roleLabel(club.roleKey)}
							<span class="type-xs shrink-0 text-muted-foreground">{roleLabel(club.roleKey)}</span>
						{/if}
					</span>
					{#if club.clubId === activeClubId}
						<CheckIcon class="size-4 shrink-0 text-orange-500" />
					{/if}
				</DropdownMenuItem>
			{/each}
			<DropdownMenuSeparator />
			<DropdownMenuItem class="gap-3 py-2" onSelect={() => void goto(routes.newClub)}>
				<PlusIcon class="size-4 shrink-0 text-muted-foreground" />
				<span class="truncate">{t('clubSwitcher.newClubAction')}</span>
			</DropdownMenuItem>
		</DropdownMenuContent>
	</DropdownMenu>
{:else}
	<span class={`type-step-title min-w-0 flex-1 truncate text-foreground ${className ?? ''}`}>
		{activeClub?.clubName ?? ''}
	</span>
{/if}
