<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CheckIcon from '@lucide/svelte/icons/check';
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
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import { formatT, t } from '$lib/i18n';
	import { buildClubSwitchPath } from '$lib/navigation/club-switch-path';
	import { LAST_CLUB_ID_STORAGE_KEY } from '$lib/auth/onboarding-state';

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
	let hasMultipleClubs = $derived(clubs.length > 1);
	let switchingClubId = $state<string | null>(null);

	const roleLabel = (roleKey: ClubSwitcherItem['roleKey']) => {
		if (roleKey === 'guide') return t('clubSwitcher.roleGuide');
		if (roleKey === 'learner') return t('clubSwitcher.roleLearner');
		return null;
	};

	const switchClub = async (nextClubId: string) => {
		if (!activeClubId || nextClubId === activeClubId || switchingClubId) return;
		switchingClubId = nextClubId;
		try {
			await convexClient.mutation(api.clubs.switchActiveClub, {
				clubId: nextClubId as Id<'clubs'>
			});
			try {
				localStorage.setItem(LAST_CLUB_ID_STORAGE_KEY, nextClubId);
			} catch {
				// Ignore storage errors; the server-side active club is still updated.
			}
			const target = buildClubSwitchPath(page.url.pathname, activeClubId, nextClubId);
			await goto(target);
		} catch (error) {
			showGlobalSnackbar({
				title: t('clubSwitcher.switchFailureTitle'),
				description: error instanceof Error ? error.message : t('clubSwitcher.switchFailureDescription')
			});
		} finally {
			switchingClubId = null;
		}
	};
</script>

{#if hasMultipleClubs}
	<DropdownMenu>
		<DropdownMenuTrigger class={`-ml-2 inline-flex w-fit max-w-full min-w-0 overflow-hidden ${className ?? ''}`}>
			<Button
				variant="ghost"
				class="max-w-full min-w-0 shrink justify-start gap-1 px-1.5 text-[#262626] hover:text-[#262626]"
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
		</DropdownMenuContent>
	</DropdownMenu>
{:else}
	<span class={`type-step-title min-w-0 flex-1 truncate text-[#262626] ${className ?? ''}`}>
		{activeClub?.clubName ?? ''}
	</span>
{/if}
