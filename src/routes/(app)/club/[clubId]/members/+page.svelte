<script lang="ts">
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import {
		LoadingState,
		ActionMenu,
		ConfirmDialog,
		EmptyState,
		PageHeaderActions,
		PageHeaderBackButton,
		PageHeaderSearch
	} from '$lib/components/app';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import InviteLearnerDialog from '$lib/components/app/home/invite-learner-dialog.svelte';
	import ReportIssueDialog from '$lib/components/app/report-issue-dialog.svelte';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import { routes } from '$lib/routes';
	import { _, t, formatT } from '$lib/i18n';
	import { formatMonthYear } from '$lib/domain/date';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import UserMinusIcon from '@lucide/svelte/icons/user-minus';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import FlagIcon from '@lucide/svelte/icons/flag';
	import UsersIcon from '@lucide/svelte/icons/users';
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
	let canInvite = $derived(clubItem?.roleKey === 'guide');
	let isGuide = $derived(clubItem?.roleKey === 'guide');
	let clubIdTyped = $derived(clubId ? (clubId as Id<'clubs'>) : null);
	let myProfileId = $derived(clubItem?.memberProfileId ?? null);

	const membersResponse = useStableQuery(api.clubs.getMembers, () =>
		clubIdTyped ? { clubId: clubIdTyped } : 'skip'
	);

	let filter = $state('');
	let errorMessage = $state('');
	let pending = $state(false);

	type Member = NonNullable<typeof membersResponse.data>[number];

	let allMembers = $derived(membersResponse.data ?? []);
	let guideMembers = $derived(allMembers.filter((member) => member.roleKey === 'guide'));
	let learnerMembers = $derived(allMembers.filter((member) => member.roleKey !== 'guide'));

	const matchesFilter = (member: Member, query: string) => {
		if (!query) return true;
		const haystack = [
			member.firstName ?? '',
			member.lastName ?? '',
			member.username ?? '',
			member.roleName ?? ''
		]
			.join(' ')
			.toLowerCase();
		return haystack.includes(query);
	};

	let normalizedFilter = $derived(filter.trim().toLowerCase());
	let filteredGuides = $derived(guideMembers.filter((member) => matchesFilter(member, normalizedFilter)));
	let filteredLearners = $derived(
		learnerMembers.filter((member) => matchesFilter(member, normalizedFilter))
	);
	let hasAnyResults = $derived(filteredGuides.length + filteredLearners.length > 0);
	let isSearching = $derived(normalizedFilter.length > 0);

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

	const joinedLabelFor = (member: { joinedAt?: number }) => {
		if (!member.joinedAt) return null;
		return formatT('membersPage.joinedOn', { date: formatMonthYear(member.joinedAt) });
	};

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

	// ── Report member ────────────────────────────────────────────────────
	let reportDialogOpen = $state(false);
	let reportTargetProfileId = $state<Id<'profiles'> | null>(null);
	let reportTargetContext = $state('');

	const openReportDialog = (member: {
		profileId: Id<'profiles'>;
		firstName?: string | null;
		lastName?: string | null;
		username?: string | null;
		userId: string;
	}) => {
		reportTargetProfileId = member.profileId;
		reportTargetContext = displayNameFor(member);
		reportDialogOpen = true;
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
	let demoteSelfDialogOpen = $state(false);

	const demoteSelf = async () => {
		if (!clubIdTyped) return;
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
	let leaveClubDialogOpen = $state(false);
	let leaveClubIsAbandon = $derived(
		isGuide && guideMembers.length <= 1 && learnerMembers.length === 0
	);

	const openLeaveClubDialog = () => {
		if (!clubIdTyped) return;
		const isLastGuide = isGuide && guideMembers.length <= 1;
		const hasLearners = learnerMembers.length > 0;

		if (isLastGuide && hasLearners) {
			errorMessage = t('membersPage.leaveClubBlockedLastGuide');
			return;
		}

		leaveClubDialogOpen = true;
	};

	const leaveClub = async () => {
		if (!clubIdTyped) return;
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
						onSelect: () => (demoteSelfDialogOpen = true)
					}
				: null,
			{
				id: 'leave-club',
				label: t('membersPage.leaveClubAction'),
				Icon: LogOutIcon,
				tone: 'destructive' as const,
				separatorBefore: isGuide,
				disabled: pending,
				onSelect: openLeaveClubDialog
			}
		].filter((item): item is NonNullable<typeof item> => item !== null)
	);

	const memberActionItems = (member: {
		clubMemberId: Id<'clubMembers'>;
		profileId: Id<'profiles'>;
		roleKey: 'guide' | 'learner' | null;
		firstName?: string | null;
		lastName?: string | null;
		username?: string | null;
		userId: string;
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
				: null,
			{
				id: 'report',
				label: t('reportEntryPoints.memberAction'),
				Icon: FlagIcon,
				separatorBefore: canPromote || canKick,
				onSelect: () => openReportDialog(member)
			}
		].filter((item): item is NonNullable<typeof item> => item !== null);
</script>

{#snippet memberRow(member: Member)}
	<div
		class="group flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 transition-colors hover:border-border sm:p-4"
	>
		<a
			href={routes.profileDetail(member.profileId)}
			class="flex min-w-0 flex-1 items-center gap-3"
			data-sveltekit-preload-code="hover"
			data-sveltekit-preload-data="hover"
		>
			<Avatar class="size-12 shrink-0 border border-orange-100 bg-orange-50 sm:size-14">
				{#if memberImageUrl(member)}
					<AvatarImage src={memberImageUrl(member) ?? undefined} alt={displayNameFor(member)} />
				{/if}
				<AvatarFallback class="type-body-bold bg-orange-50 text-orange-600"
					>{initialsFor(member)}</AvatarFallback
				>
			</Avatar>

			<div class="flex min-w-0 flex-1 flex-col gap-0.5">
				<div class="flex min-w-0 flex-wrap items-center gap-2">
					<p class="truncate type-body-bold text-foreground hover:underline">
						{displayNameFor(member)}
					</p>
					{#if member.profileId === myProfileId}
						<Badge variant="secondary" size="sm" class="type-caption-medium text-muted-foreground">
							{$_('membersPage.youBadge')}
						</Badge>
					{/if}
				</div>
				{#if member.username}
					<p class="truncate type-sm text-muted-foreground">@{member.username}</p>
				{/if}
				{#if joinedLabelFor(member)}
					<p class="truncate type-caption text-muted-foreground">{joinedLabelFor(member)}</p>
				{/if}
			</div>
		</a>

		<div
			class="shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
		>
			{#if member.profileId === myProfileId}
				<ActionMenu items={selfActionItems} ariaLabel={$_('membersPage.openActionsLabel')} />
			{:else}
				<ActionMenu
					items={memberActionItems(member)}
					ariaLabel={$_('membersPage.openActionsLabel')}
				/>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet sectionEmptyState(kind: 'guides' | 'learners')}
	{#if kind === 'learners' && isGuide && !isSearching}
		<EmptyState
			icon={UsersIcon}
			title={$_('membersPage.noLearnersYetTitle')}
			description={$_('membersPage.noLearnersYetDescription')}
		>
			<InviteLearnerDialog
				clubCode={clubItem?.clubCode}
				triggerLabel={$_('membersPage.inviteAction')}
				triggerStyle="button"
			/>
		</EmptyState>
	{:else}
		<p class="type-sm text-muted-foreground">
			{kind === 'guides' ? $_('membersPage.noGuidesMatch') : $_('membersPage.noLearnersMatch')}
		</p>
	{/if}
{/snippet}

<PageHeaderBackButton fallbackHref={clubId ? routes.clubHome(clubId) : '/onboarding/get-started'} />
<PageHeaderSearch
	bind:value={filter}
	placeholder={$_('membersPage.searchPlaceholder')}
	ariaLabel={$_('membersPage.searchLabel')}
	mode="auto"
/>
<PageHeaderActions none={!canInvite}>
	{#if canInvite}
		<InviteLearnerDialog
			clubCode={clubItem?.clubCode}
			triggerLabel={$_('membersPage.inviteAction')}
			triggerStyle="button"
		/>
	{/if}
</PageHeaderActions>

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
	<div class="flex w-full flex-col gap-4">
		{#if errorMessage}
			<Alert variant="destructive">
				<AlertTitle>{$_('membersPage.actionFailedTitle')}</AlertTitle>
				<AlertDescription>{errorMessage}</AlertDescription>
			</Alert>
		{/if}

		{#if membersResponse.isLoading}
			<LoadingState label="Loading members" />
		{:else if isSearching && !hasAnyResults}
			<EmptyState
				title={$_('membersPage.noSearchResultsTitle')}
				description={$_('membersPage.noSearchResultsDescription')}
			/>
		{:else}
			<section class="flex flex-col gap-3">
				<div class="flex items-center gap-2 px-1">
					<h2 class="type-lead-bold text-foreground/80">
						{$_('membersPage.guidesSectionTitle')}
					</h2>
					<Badge variant="outline" size="sm" class="type-caption-medium text-muted-foreground">
						{guideMembers.length}
					</Badge>
				</div>
				{#if filteredGuides.length === 0}
					{@render sectionEmptyState('guides')}
				{:else}
					<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
						{#each filteredGuides as member (member.clubMemberId)}
							{@render memberRow(member)}
						{/each}
					</div>
				{/if}
			</section>

			<section class="flex flex-col gap-3">
				<div class="flex items-center gap-2 px-1">
					<h2 class="type-lead-bold text-foreground/80">
						{$_('membersPage.learnersSectionTitle')}
					</h2>
					<Badge variant="outline" size="sm" class="type-caption-medium text-muted-foreground">
						{learnerMembers.length}
					</Badge>
				</div>
				{#if filteredLearners.length === 0}
					{@render sectionEmptyState('learners')}
				{:else}
					<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
						{#each filteredLearners as member (member.clubMemberId)}
							{@render memberRow(member)}
						{/each}
					</div>
				{/if}
			</section>
		{/if}
	</div>
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

{#if reportTargetProfileId}
	<ReportIssueDialog
		bind:open={reportDialogOpen}
		showTrigger={false}
		targetType="user"
		targetId={reportTargetProfileId}
		contextText={reportTargetContext}
	/>
{/if}

<ConfirmDialog
	bind:open={demoteSelfDialogOpen}
	title={t('membersPage.demoteSelfConfirm')}
	confirmLabel={t('membersPage.demoteSelfAction')}
	variant="destructive"
	onConfirm={demoteSelf}
/>

<ConfirmDialog
	bind:open={leaveClubDialogOpen}
	title={t('membersPage.leaveClubConfirm')}
	description={leaveClubIsAbandon ? t('membersPage.leaveClubAbandonWarning') : undefined}
	confirmLabel={t('membersPage.leaveClubAction')}
	variant="destructive"
	onConfirm={leaveClub}
/>
