<script lang="ts">
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { LoadingState, ActionMenu } from '$lib/components/app';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import { _, t } from '$lib/i18n';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import UserMinusIcon from '@lucide/svelte/icons/user-minus';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const convexClient = useConvexClient();
	const session = authClient.useSession();

	const clubsResponse = useStableQuery(api.clubs.getMyClubs, () => ($session.data ? {} : 'skip'));
	let clubId = $derived((page.params as Record<string, string | undefined>).clubId ?? null);
	let clubItem = $derived(
		clubId ? ((clubsResponse.data ?? []).find((club) => club.clubId === clubId) ?? null) : null
	);
	let clubPermissions = $derived(clubItem?.rolePermissions ?? []);
	let canKick = $derived(clubPermissions.includes('club_member:kick'));
	let canPromote = $derived(clubPermissions.includes('club_member:promote'));
	let isGuide = $derived(clubItem?.roleKey === 'guide');
	let clubIdTyped = $derived(clubId ? (clubId as Id<'clubs'>) : null);
	let myProfileId = $derived(clubItem?.memberProfileId ?? null);

	const membersResponse = useStableQuery(api.clubs.getMembers, () =>
		clubIdTyped ? { clubId: clubIdTyped } : 'skip'
	);

	let filter = $state('');
	let errorMessage = $state('');
	let pending = $state(false);

	let filteredMembers = $derived(
		(membersResponse.data ?? []).filter((member) => {
			const haystack = [
				member.firstName ?? '',
				member.lastName ?? '',
				member.username ?? '',
				member.roleName ?? ''
			]
				.join(' ')
				.toLowerCase();
			return haystack.includes(filter.trim().toLowerCase());
		})
	);

	let initialMemberImageUrls = $derived.by(() => {
		return new Map(
			(data.initialMemberImages ?? []).map((asset) => [asset.assetId, asset.signedUrl] as const)
		);
	});

	const memberImageUrl = (member: { profileImageMediaAssetId?: Id<'mediaAssets'> | null }) => {
		if (member.profileImageMediaAssetId) {
			return initialMemberImageUrls.get(member.profileImageMediaAssetId) ?? null;
		}

		return null;
	};

	const initialsFor = (member: {
		firstName?: string | null;
		lastName?: string | null;
		username?: string | null;
		userId: string;
	}) => {
		const label =
			[member.firstName ?? '', member.lastName ?? ''].join(' ').trim() ||
			member.username ||
			member.userId;
		const parts = label.split(/\s+/).filter(Boolean);
		const initials = [parts[0]?.[0] ?? '', parts.at(-1)?.[0] ?? ''].join('').toUpperCase();
		return initials || label.slice(0, 2).toUpperCase();
	};

	const displayNameFor = (member: {
		firstName?: string | null;
		lastName?: string | null;
		username?: string | null;
		userId: string;
	}) =>
		[member.firstName ?? '', member.lastName ?? ''].join(' ').trim() ||
		member.username ||
		t('membersPage.title');

	const roleLabelFor = (roleKey: 'guide' | 'learner' | null) =>
		roleKey === 'guide' ? t('membersPage.roleGuide') : t('membersPage.roleLearner');

	// ── Promote ──────────────────────────────────────────────────────────
	const promoteMember = async (clubMemberId: Id<'clubMembers'>) => {
		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.clubs.promoteMember, { clubMemberId });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('membersPage.promoteFailure');
		} finally {
			pending = false;
		}
	};

	// ── Remove (kick) with required reason ──────────────────────────────
	let removeDialogOpen = $state(false);
	let removeTarget = $state<Id<'clubMembers'> | null>(null);
	let removeReason = $state('');
	let removePending = $state(false);
	let removeErrorMessage = $state('');
	const REMOVE_REASON_MAX_LENGTH = 500;

	const openRemoveDialog = (clubMemberId: Id<'clubMembers'>) => {
		removeTarget = clubMemberId;
		removeReason = '';
		removeErrorMessage = '';
		removeDialogOpen = true;
	};

	const confirmRemoveMember = async () => {
		const reason = removeReason.trim();
		if (!removeTarget) return;
		if (!reason) {
			removeErrorMessage = t('membersPage.removeReasonRequired');
			return;
		}

		removePending = true;
		removeErrorMessage = '';
		try {
			await convexClient.mutation(api.clubs.kickMember, {
				clubMemberId: removeTarget,
				reason
			});
			removeDialogOpen = false;
		} catch (error) {
			removeErrorMessage = error instanceof Error ? error.message : t('membersPage.removeFailure');
		} finally {
			removePending = false;
		}
	};

	// ── Self demote ──────────────────────────────────────────────────────
	const demoteSelf = async () => {
		if (!clubIdTyped) return;
		if (!window.confirm(t('membersPage.demoteSelfConfirm'))) return;
		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.clubs.demoteSelfToLearner, { clubId: clubIdTyped });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('membersPage.demoteSelfFailure');
		} finally {
			pending = false;
		}
	};

	// ── Leave club ───────────────────────────────────────────────────────
	const leaveClub = async () => {
		if (!clubIdTyped) return;
		const activeGuideCount = (membersResponse.data ?? []).filter(
			(member) => member.roleKey === 'guide'
		).length;
		const isLastGuide = isGuide && activeGuideCount <= 1;
		const hasLearners = (membersResponse.data ?? []).some(
			(member) => member.roleKey !== 'guide'
		);

		if (isLastGuide && hasLearners) {
			errorMessage = t('membersPage.leaveClubBlockedLastGuide');
			return;
		}

		const confirmMessage =
			isLastGuide && !hasLearners
				? `${t('membersPage.leaveClubAbandonWarning')}\n\n${t('membersPage.leaveClubConfirm')}`
				: t('membersPage.leaveClubConfirm');
		if (!window.confirm(confirmMessage)) return;

		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.clubs.leaveClub, { clubId: clubIdTyped });
			await goto('/');
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('membersPage.leaveClubFailure');
		} finally {
			pending = false;
		}
	};

	let selfActionItems = $derived(
		[
			isGuide
				? {
						id: 'demote-self',
						label: t('membersPage.demoteSelfAction'),
						Icon: UserMinusIcon,
						disabled: pending,
						onSelect: () => void demoteSelf()
					}
				: null,
			{
				id: 'leave-club',
				label: t('membersPage.leaveClubAction'),
				Icon: LogOutIcon,
				tone: 'destructive' as const,
				separatorBefore: isGuide,
				disabled: pending,
				onSelect: () => void leaveClub()
			}
		].filter((item): item is NonNullable<typeof item> => item !== null)
	);

	const memberActionItems = (member: {
		clubMemberId: Id<'clubMembers'>;
		roleKey: 'guide' | 'learner' | null;
	}) =>
		[
			canPromote && member.roleKey === 'learner'
				? {
						id: 'promote',
						label: t('membersPage.promoteAction'),
						Icon: UserPlusIcon,
						disabled: pending,
						onSelect: () => void promoteMember(member.clubMemberId)
					}
				: null,
			canKick && member.roleKey === 'learner'
				? {
						id: 'remove',
						label: t('membersPage.removeAction'),
						Icon: UserMinusIcon,
						tone: 'destructive' as const,
						disabled: pending,
						onSelect: () => openRemoveDialog(member.clubMemberId)
					}
				: null
		].filter((item): item is NonNullable<typeof item> => item !== null);
</script>

{#if !clubIdTyped}
	<Alert>
		<AlertTitle>No active club</AlertTitle>
		<AlertDescription>Select a club to view members.</AlertDescription>
	</Alert>
{:else if membersResponse.error}
	<Alert>
		<AlertTitle>{$_('membersPage.accessDeniedTitle')}</AlertTitle>
		<AlertDescription>{$_('membersPage.accessDeniedDescription')}</AlertDescription>
	</Alert>
{:else}
	<Card>
		<CardHeader class="flex flex-row items-center justify-between gap-2">
			<div class="flex flex-col gap-2">
				<CardTitle>{$_('membersPage.title')}</CardTitle>
				<CardDescription>{$_('membersPage.description')}</CardDescription>
			</div>
			{#if myProfileId}
				<ActionMenu items={selfActionItems} ariaLabel={$_('membersPage.openActionsLabel')} />
			{/if}
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			{#if errorMessage}
				<Alert variant="destructive">
					<AlertTitle>{$_('membersPage.actionFailedTitle')}</AlertTitle>
					<AlertDescription>{errorMessage}</AlertDescription>
				</Alert>
			{/if}

			<div class="flex flex-col gap-2">
				<Label for="memberFilter">{$_('membersPage.searchLabel')}</Label>
				<Input
					id="memberFilter"
					bind:value={filter}
					placeholder={$_('membersPage.searchPlaceholder')}
				/>
			</div>

			{#if membersResponse.isLoading}
				<LoadingState label={$_('membersPage.title')} />
			{:else if (filteredMembers.length ?? 0) === 0}
				<p class="text-sm text-muted-foreground">{$_('membersPage.noMatches')}</p>
			{:else}
				<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
					{#each filteredMembers as member (member.clubMemberId)}
						<div class="flex flex-col gap-3 rounded-md border border-border p-4">
							<div class="flex items-start justify-between gap-3">
								<div class="flex items-center gap-3">
									<Avatar class="size-10">
										{#if memberImageUrl(member)}
											<AvatarImage
												src={memberImageUrl(member) ?? undefined}
												alt={displayNameFor(member)}
											/>
										{/if}
										<AvatarFallback>{initialsFor(member)}</AvatarFallback>
									</Avatar>
									<div class="flex flex-col">
										<p class="font-medium">{displayNameFor(member)}</p>
										{#if member.profileId === myProfileId}
											<span class="text-xs text-muted-foreground">{$_('membersPage.youBadge')}</span>
										{/if}
									</div>
								</div>
								<div class="flex shrink-0 items-center gap-1">
									<Badge variant="outline">{roleLabelFor(member.roleKey)}</Badge>
									{#if member.profileId !== myProfileId}
										<ActionMenu
											items={memberActionItems(member)}
											ariaLabel={$_('membersPage.openActionsLabel')}
										/>
									{/if}
								</div>
							</div>
							<div class="flex flex-col gap-1 text-sm text-muted-foreground">
								{#if member.username}
									<p>@{member.username}</p>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</CardContent>
	</Card>
{/if}

<Dialog.Root bind:open={removeDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{$_('membersPage.removeDialogTitle')}</Dialog.Title>
			<Dialog.Description>{$_('membersPage.removeDialogDescription')}</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-3">
			{#if removeErrorMessage}
				<Alert variant="destructive">
					<AlertDescription>{removeErrorMessage}</AlertDescription>
				</Alert>
			{/if}
			<div class="flex flex-col gap-2">
				<Label for="removeReason">{$_('membersPage.removeReasonLabel')}</Label>
				<Textarea
					id="removeReason"
					bind:value={removeReason}
					rows={4}
					maxlength={REMOVE_REASON_MAX_LENGTH}
					placeholder={$_('membersPage.removeReasonPlaceholder')}
					required
				/>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (removeDialogOpen = false)}>
				{$_('membersPage.removeCancelAction')}
			</Button>
			<Button
				variant="destructive"
				disabled={removePending || !removeReason.trim()}
				onclick={() => void confirmRemoveMember()}
			>
				{removePending ? $_('common.saving') : $_('membersPage.removeConfirmAction')}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
