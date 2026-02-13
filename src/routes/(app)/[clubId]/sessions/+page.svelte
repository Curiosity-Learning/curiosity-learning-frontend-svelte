<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import {
		PageHeaderActions,
		PageHeaderBackButton
	} from '$lib/components/app';
	import ClubSessionCard from '$lib/components/app/sessions/club-session-card.svelte';
	import { routes } from '$lib/routes';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { SessionDateTimeForm } from '$lib/components/ui/date-picker';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { FieldLabel } from '$lib/components/ui/field';
	import { Textarea } from '$lib/components/ui/textarea';
	import { useConvexClient, useQuery } from 'convex-svelte';

	const convexClient = useConvexClient();

	const clubsResponse = useQuery(api.clubs.getMyClubs, {});

	let clubId = $derived((page.params as Record<string, string | undefined>).clubId ?? null);
	let clubIdTyped = $derived((clubId ? (clubId as Id<'clubs'>) : null));
	let clubItem = $derived(
		clubId ? (clubsResponse.data ?? []).find((club) => club.clubId === clubId) ?? null : null
	);
	let clubPermissions = $derived(clubItem?.rolePermissions ?? []);
	let canCreate = $derived(clubPermissions.includes('session:create'));
	let canDelete = $derived(clubPermissions.includes('session:delete'));
	let canReadMembers = $derived(clubPermissions.includes('club_member:read_active'));

	const sessionsResponse = useQuery(api.sessions.listByClub, () =>
		clubIdTyped ? { clubId: clubIdTyped, upcomingOnly: false } : 'skip'
	);

	let createDialogOpen = $state(false);
	let sessionForm = $state({
		startTime: null as number | null,
		endTime: null as number | null,
		description: ''
	});

	let searchOpen = $state(false);
	let searchText = $state('');
	let pending = $state(false);
	let errorMessage = $state('');

	let sortedSessions = $derived(
		[...(sessionsResponse.data ?? [])].sort((left, right) => left.startTime - right.startTime)
	);

	let visibleSessions = $derived(
		sortedSessions.filter((session) => {
			const query = searchText.trim().toLowerCase();
			if (!query) return true;
			const dateLabel = new Date(session.startTime).toLocaleDateString(undefined, {
				weekday: 'short',
				month: 'short',
				day: 'numeric'
			});
			return [session.description, dateLabel].join(' ').toLowerCase().includes(query);
		})
	);

	const openCreateSession = () => {
		const now = Date.now();
		sessionForm = {
			startTime: now + 3_600_000,
			endTime: now + 7_200_000,
			description: ''
		};
		createDialogOpen = true;
	};

	const createSession = async () => {
		if (!clubIdTyped || sessionForm.startTime === null || sessionForm.endTime === null) return;

		pending = true;
		errorMessage = '';
		try {
			const desc = sessionForm.description.trim();
			const session = await convexClient.mutation(api.sessions.create, {
				clubId: clubIdTyped,
				startTime: sessionForm.startTime,
				endTime: sessionForm.endTime,
				...(desc ? { description: desc } : {})
			});
			createDialogOpen = false;
			if (session?._id) {
				await goto(routes.sessionDetail(session._id) + '/activities');
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to create session.';
		} finally {
			pending = false;
		}
	};

	const removeSession = async (sessionId: Id<'sessions'>) => {
		if (!window.confirm('Delete this session and all related activities?')) return;
		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.sessions.remove, { sessionId });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to delete session.';
		} finally {
			pending = false;
		}
	};
</script>

<PageHeaderBackButton fallbackHref={clubId ? `/${clubId}` : '/onboarding/get-started'} />
<PageHeaderActions>
	<div class="flex items-center gap-1">
		<Button
			variant="ghost"
			size="icon"
			aria-label="Create session"
			disabled={!canCreate}
			onclick={openCreateSession}
		>
			<PlusIcon class="size-5 text-muted-foreground" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			aria-label={searchOpen ? 'Hide search' : 'Search sessions'}
			onclick={() => {
				searchOpen = !searchOpen;
				if (!searchOpen) searchText = '';
			}}
		>
			<SearchIcon class="size-5 text-muted-foreground" />
		</Button>
	</div>
</PageHeaderActions>

{#if !clubIdTyped}
	<Alert>
		<AlertTitle>No active club</AlertTitle>
		<AlertDescription>Choose or create a club first from onboarding.</AlertDescription>
	</Alert>
{:else}
	<div class="mx-auto flex w-full flex-col gap-4">
		{#if searchOpen}
			<Input bind:value={searchText} placeholder="Search by title or date" />
		{/if}

		{#if errorMessage}
			<Alert variant="destructive">
				<AlertTitle>Action failed</AlertTitle>
				<AlertDescription>{errorMessage}</AlertDescription>
			</Alert>
		{/if}

		{#if sessionsResponse.isLoading}
			<p class="text-sm text-muted-foreground">Loading sessions...</p>
		{:else if visibleSessions.length === 0}
			<p class="text-sm text-muted-foreground">
				{searchText ? 'No sessions match your search.' : 'No sessions yet.'}
			</p>
		{:else}
			<div class="flex flex-col gap-4">
				{#each visibleSessions as session (session._id)}
					<ClubSessionCard
						{session}
						sessionHref={routes.sessionDetail(session._id)}
						{canReadMembers}
						{canDelete}
						onDelete={() => void removeSession(session._id)}
					/>
				{/each}
			</div>
		{/if}
	</div>

	<Dialog.Root bind:open={createDialogOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Create session</Dialog.Title>
				<Dialog.Description
					>Use local date and time values for this club session.</Dialog.Description
				>
			</Dialog.Header>
			<div class="flex flex-col gap-3">
				<SessionDateTimeForm
					bind:startTime={sessionForm.startTime}
					bind:endTime={sessionForm.endTime}
				/>
				<div class="flex flex-col gap-2">
					<FieldLabel for="sessionDescription">Description</FieldLabel>
					<Textarea id="sessionDescription" bind:value={sessionForm.description} rows={3} />
				</div>
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (createDialogOpen = false)}>Cancel</Button>
				<Button
					disabled={pending}
					onclick={() => void createSession()}>{pending ? 'Creating...' : 'Open'}</Button
				>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
