<script lang="ts">
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { LoadingState } from '$lib/components/app';
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
		'Club member';

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
				<LoadingState label="Loading members" />
			{:else if (filteredMembers.length ?? 0) === 0}
				<p class="text-sm text-muted-foreground">No members matched your filter.</p>
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
									<p class="font-medium">{displayNameFor(member)}</p>
								</div>
								{#if member.roleName}
									<Badge variant="outline">{member.roleName}</Badge>
								{/if}
							</div>
							<div class="flex flex-col gap-1 text-sm text-muted-foreground">
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
