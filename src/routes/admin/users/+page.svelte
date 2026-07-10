<script lang="ts">
	import { api } from '$convex/_generated/api';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Textarea } from '$lib/components/ui/textarea';
	import { t } from '$lib/i18n';
	import type { Id } from '$convex/_generated/dataModel';

	// CL-730 (PRD 6.14.7): username search + suspend/unsuspend. "Remove user" is out of scope for
	// v1 (full deletion is GDPR-workflows scope, CL-741) — suspension is the only action offered,
	// labeled honestly as "Suspend", not "Remove".
	let usernameQuery = $state('');
	const convexClient = useConvexClient();

	const usersResponse = useStableQuery(api.moderation.searchUsers, () =>
		usernameQuery.trim() ? { usernamePrefix: usernameQuery.trim() } : 'skip'
	);
	let users = $derived(usersResponse.data ?? []);

	let errorMessage = $state('');
	let pendingProfileId = $state<Id<'profiles'> | null>(null);

	let suspendDialogOpen = $state(false);
	let suspendReason = $state('');
	let suspendTargetId = $state<Id<'profiles'> | null>(null);

	const displayName = (user: { firstName: string | null; lastName: string | null; username: string | null }) =>
		[user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username || 'Unknown';

	const openSuspend = (profileId: Id<'profiles'>) => {
		suspendTargetId = profileId;
		suspendReason = '';
		suspendDialogOpen = true;
	};

	const confirmSuspend = async () => {
		if (!suspendTargetId) return;
		const reason = suspendReason.trim();
		if (!reason) {
			errorMessage = 'A reason is required to suspend a user.';
			return;
		}
		pendingProfileId = suspendTargetId;
		errorMessage = '';
		try {
			await convexClient.mutation(api.moderation.suspendUser, {
				profileId: suspendTargetId,
				reason
			});
			suspendDialogOpen = false;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to suspend user';
		} finally {
			pendingProfileId = null;
		}
	};

	const unsuspend = async (profileId: Id<'profiles'>) => {
		pendingProfileId = profileId;
		errorMessage = '';
		try {
			await convexClient.mutation(api.moderation.unsuspendUser, { profileId });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to unsuspend user';
		} finally {
			pendingProfileId = null;
		}
	};

	// PRD 6.14.4: minimal club override (name/description/discoverable) via a simple club search.
	let clubQuery = $state('');
	const clubsResponse = useStableQuery(api.moderation.searchClubs, () =>
		clubQuery.trim() ? { namePrefix: clubQuery.trim() } : 'skip'
	);
	let clubs = $derived(clubsResponse.data ?? []);

	let clubEditDialogOpen = $state(false);
	let clubEditId = $state<Id<'clubs'> | null>(null);
	let clubEditName = $state('');
	let clubEditDescription = $state('');
	let clubEditDiscoverable = $state(true);
	let clubEditError = $state('');
	let clubEditPending = $state(false);

	const openClubEdit = (club: (typeof clubs)[number]) => {
		clubEditId = club.clubId;
		clubEditName = club.name;
		clubEditDescription = club.description ?? '';
		clubEditDiscoverable = club.discoverable;
		clubEditError = '';
		clubEditDialogOpen = true;
	};

	const saveClubEdit = async () => {
		if (!clubEditId) return;
		clubEditPending = true;
		clubEditError = '';
		try {
			await convexClient.mutation(api.moderation.adminUpdateClub, {
				clubId: clubEditId,
				name: clubEditName.trim(),
				description: clubEditDescription.trim() || null,
				discoverable: clubEditDiscoverable
			});
			clubEditDialogOpen = false;
		} catch (error) {
			clubEditError = error instanceof Error ? error.message : 'Failed to update club';
		} finally {
			clubEditPending = false;
		}
	};
</script>

<div class="flex flex-col gap-8">
	<div>
		<h1 class="text-xl font-semibold">{t('admin.navUsers')}</h1>
		<p class="mt-1 text-sm text-neutral-500">
			Search by username. "Suspend" blocks the account platform-wide; full deletion is out of
			scope for v1 (see CL-741).
		</p>
	</div>

	{#if errorMessage}
		<p class="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p>
	{/if}

	<div class="flex flex-col gap-3">
		<Input placeholder="Search by username..." bind:value={usernameQuery} class="max-w-sm" />

		{#if usersResponse.isLoading}
			<p class="text-sm text-neutral-500">Searching...</p>
		{:else if usernameQuery.trim() && users.length === 0}
			<p class="text-sm text-neutral-500">No matching users.</p>
		{:else if users.length > 0}
			<ul class="flex flex-col gap-2">
				{#each users as user (user.profileId)}
					<li class="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-3">
						<div class="flex items-center gap-2">
							<span class="text-sm font-medium">{displayName(user)}</span>
							{#if user.username}
								<span class="text-xs text-neutral-400">@{user.username}</span>
							{/if}
							{#if user.globalRole === 'admin'}
								<Badge variant="secondary">admin</Badge>
							{/if}
							{#if user.suspendedAt}
								<Badge variant="destructive">suspended</Badge>
							{/if}
						</div>
						<div class="flex items-center gap-2">
							{#if user.suspendedAt}
								<Button
									size="sm"
									variant="outline"
									disabled={pendingProfileId === user.profileId}
									onclick={() => unsuspend(user.profileId)}
								>
									Unsuspend
								</Button>
							{:else}
								<Button
									size="sm"
									variant="destructive"
									disabled={pendingProfileId === user.profileId}
									onclick={() => openSuspend(user.profileId)}
								>
									Suspend
								</Button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<div class="flex flex-col gap-3 border-t border-neutral-200 pt-6">
		<h2 class="text-sm font-semibold text-neutral-600">Club override</h2>
		<Input placeholder="Search clubs by name..." bind:value={clubQuery} class="max-w-sm" />
		{#if clubs.length > 0}
			<ul class="flex flex-col gap-2">
				{#each clubs as club (club.clubId)}
					<li class="flex items-center justify-between rounded-lg border border-neutral-200 bg-white p-3">
						<div class="flex items-center gap-2">
							<span class="text-sm font-medium">{club.name}</span>
							{#if !club.discoverable}
								<Badge variant="outline">hidden</Badge>
							{/if}
						</div>
						<Button size="sm" variant="outline" onclick={() => openClubEdit(club)}>Edit</Button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<Dialog.Root bind:open={suspendDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Suspend user</Dialog.Title>
			<Dialog.Description>
				The user will be blocked from all main actions and notified immediately. A reason is
				required.
			</Dialog.Description>
		</Dialog.Header>
		<Textarea bind:value={suspendReason} rows={3} placeholder="Reason for suspension" />
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (suspendDialogOpen = false)}>Cancel</Button>
			<Button
				variant="destructive"
				disabled={pendingProfileId === suspendTargetId}
				onclick={() => void confirmSuspend()}
			>
				Suspend
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={clubEditDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Edit club</Dialog.Title>
			<Dialog.Description>Admin override of name, description, and discoverability.</Dialog.Description>
		</Dialog.Header>
		{#if clubEditError}
			<p class="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{clubEditError}</p>
		{/if}
		<div class="flex flex-col gap-3">
			<Input bind:value={clubEditName} placeholder="Club name" />
			<Textarea bind:value={clubEditDescription} rows={3} placeholder="Description" />
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" bind:checked={clubEditDiscoverable} />
				Discoverable
			</label>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (clubEditDialogOpen = false)}>Cancel</Button>
			<Button disabled={clubEditPending} onclick={() => void saveClubEdit()}>Save</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
