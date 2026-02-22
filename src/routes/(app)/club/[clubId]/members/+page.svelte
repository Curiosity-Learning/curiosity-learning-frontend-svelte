<script lang="ts">
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
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { page } from '$app/state';
	import { authClient } from '$lib/auth-client';

	const convexClient = useConvexClient();
	const session = authClient.useSession();

	const clubsResponse = useStableQuery(api.clubs.getMyClubs, () => ($session.data ? {} : 'skip'));
	let clubId = $derived((page.params as Record<string, string | undefined>).clubId ?? null);
	let clubItem = $derived(
		clubId ? ((clubsResponse.data ?? []).find((club) => club.clubId === clubId) ?? null) : null
	);
	let clubPermissions = $derived(clubItem?.rolePermissions ?? []);
	let canKick = $derived(clubPermissions.includes('club_member:kick'));
	let clubIdTyped = $derived(clubId ? (clubId as Id<'clubs'>) : null);

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
				member.email ?? '',
				member.roleName ?? ''
			]
				.join(' ')
				.toLowerCase();
			return haystack.includes(filter.trim().toLowerCase());
		})
	);

	const kickMember = async (clubMemberId: Id<'clubMembers'>) => {
		if (!window.confirm('Remove this member from the club?')) return;
		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.clubs.kickMember, { clubMemberId });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to remove member.';
		} finally {
			pending = false;
		}
	};
</script>

{#if !clubIdTyped}
	<Alert>
		<AlertTitle>No active club</AlertTitle>
		<AlertDescription>Select a club to view members.</AlertDescription>
	</Alert>
{:else if membersResponse.error}
	<Alert>
		<AlertTitle>Access denied</AlertTitle>
		<AlertDescription>You do not have permission to view members for this club.</AlertDescription>
	</Alert>
{:else}
	<Card>
		<CardHeader class="flex flex-col gap-2">
			<CardTitle>Club people</CardTitle>
			<CardDescription>Learners and guides currently active in this club.</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			{#if errorMessage}
				<Alert variant="destructive">
					<AlertTitle>Action failed</AlertTitle>
					<AlertDescription>{errorMessage}</AlertDescription>
				</Alert>
			{/if}

			<div class="flex flex-col gap-2">
				<Label for="memberFilter">Search members</Label>
				<Input id="memberFilter" bind:value={filter} placeholder="Name, role, email" />
			</div>

			{#if membersResponse.isLoading}
				<p class="text-sm text-muted-foreground">Loading members...</p>
			{:else if (filteredMembers.length ?? 0) === 0}
				<p class="text-sm text-muted-foreground">No members matched your filter.</p>
			{:else}
				<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
					{#each filteredMembers as member (member.clubMemberId)}
						<div class="flex flex-col gap-3 rounded-md border border-border p-4">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<p class="font-medium">
									{member.firstName ?? ''}
									{member.lastName ?? ''}
								</p>
								{#if member.roleName}
									<Badge variant="outline">{member.roleName}</Badge>
								{/if}
							</div>
							<div class="flex flex-col gap-1 text-sm text-muted-foreground">
								<p>{member.email ?? member.userId}</p>
								{#if member.username}
									<p>@{member.username}</p>
								{/if}
							</div>
							{#if canKick}
								<Button
									variant="destructive"
									size="sm"
									disabled={pending}
									onclick={() => void kickMember(member.clubMemberId)}
								>
									Remove member
								</Button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</CardContent>
	</Card>
{/if}
