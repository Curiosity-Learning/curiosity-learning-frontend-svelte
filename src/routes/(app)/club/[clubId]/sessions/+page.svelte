<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import {
		canMutateOnline as canMutateOnlineStore,
		reportMutationFailure,
		reportMutationSuccess
	} from '$lib/app/connectivity';
	import {
		LoadingState,
		PageHeaderActions,
		PageHeaderBackButton,
		PageHeaderSearch
	} from '$lib/components/app';
	import ClubSessionCard from '$lib/components/app/sessions/club-session-card.svelte';
	import { formatSessionHeaderLine } from '$lib/domain/session';
	import { combineDateAndTime, nextScheduledSession } from '$lib/domain/schedule';
	import { routes } from '$lib/routes';
	import { t } from '$lib/i18n';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { SessionDateTimeForm } from '$lib/components/ui/date-picker';
	import * as Dialog from '$lib/components/ui/dialog';
	import { FieldLabel } from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { fromStore } from 'svelte/store';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const convexClient = useConvexClient();
	const canMutateOnlineState = fromStore(canMutateOnlineStore);

	const clubsResponse = useStableQuery(api.clubs.getMyClubs, {});

	let clubId = $derived((page.params as Record<string, string | undefined>).clubId ?? null);
	let clubIdTyped = $derived(clubId ? (clubId as Id<'clubs'>) : null);
	let clubItem = $derived(
		clubId ? ((clubsResponse.data ?? []).find((club) => club.clubId === clubId) ?? null) : null
	);
	let clubPermissions = $derived(clubItem?.rolePermissions ?? []);
	let canCreate = $derived(clubPermissions.includes('session:create'));
	let canCancel = $derived(clubPermissions.includes('session:cancel'));
	let canReadMembers = $derived(clubPermissions.includes('club_member:read_active'));
	let canRsvp = $derived(clubPermissions.includes('session_rsvp:set'));
	let canMutateOnline = $derived(canMutateOnlineState.current);
	let rsvpPendingSessionId = $state<Id<'sessions'> | null>(null);

	const sessionCardsResponse = useStableQuery(
		api.sessions.listCardPreviewsByClub,
		() =>
			clubIdTyped
				? { clubId: clubIdTyped, upcomingOnly: false, includeAttendees: canReadMembers }
				: 'skip',
		{ cache: 'memory' }
	);

	const scheduleSlotsResponse = useStableQuery(api.clubScheduleSlots.listByClub, () =>
		clubIdTyped ? { clubId: clubIdTyped } : 'skip'
	);

	const buildDefaultSessionForm = () => {
		const now = Date.now();
		const slots = scheduleSlotsResponse.data ?? [];

		if (slots.length > 0) {
			const lastSessionStart = (sessionCardsResponse.data ?? []).reduce<number | null>(
				(latest, entry) =>
					latest === null || entry.session.startTime > latest ? entry.session.startTime : latest,
				null
			);
			const next = nextScheduledSession(
				slots,
				new Date(now),
				lastSessionStart !== null ? new Date(lastSessionStart) : null
			);
			if (next) {
				return {
					startTime: combineDateAndTime(next.date, next.slot.startTime),
					endTime: combineDateAndTime(next.date, next.slot.endTime),
					description: '',
					location: next.slot.location
				};
			}
		}

		return {
			startTime: now + 3_600_000,
			endTime: now + 7_200_000,
			description: '',
			location: ''
		};
	};
	const SESSION_CREATE_TIMEOUT_MS = 6_000;

	async function withTimeout<T>(
		promise: Promise<T>,
		timeoutMs: number,
		timeoutMessage: string
	): Promise<T> {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
			})
		]);
	}

	let createDialogOpen = $state(page.url.searchParams.get('openCreateSession') === '1');
	let sessionForm = $state(buildDefaultSessionForm());

	let searchText = $state('');
	let pending = $state(false);
	let errorMessage = $state('');

	let sortedSessionCards = $derived(
		[...(sessionCardsResponse.data ?? [])].sort(
			(left, right) => left.session.startTime - right.session.startTime
		)
	);

	// PRD 6.16: sessions are searchable by date, description, and activity name. The card
	// preview payload carries every activity title (plus building-block tag names), so the
	// filter can stay client-side over the already-authorized, fully loaded list.
	let visibleSessionCards = $derived(
		sortedSessionCards.filter((entry) => {
			const session = entry.session;
			const query = searchText.trim().toLowerCase();
			if (!query) return true;
			const dateLabel = new Date(session.startTime).toLocaleDateString(undefined, {
				weekday: 'short',
				month: 'short',
				day: 'numeric'
			});
			return [
				session.description,
				dateLabel,
				...entry.allActivityNames,
				...entry.tagNames
			]
				.join(' ')
				.toLowerCase()
				.includes(query);
		})
	);

	let initialSessionAttendeeImageUrls = $derived.by(() => {
		return new Map(
			(data.initialSessionAttendeeImages ?? []).map((asset) => [asset.assetId, asset.signedUrl] as const)
		);
	});

	let visibleSessionCardsWithSignedAttendees = $derived(
		visibleSessionCards.map((entry) => ({
			...entry,
			attendees: entry.attendees.map((attendee) => ({
				name: attendee.name,
				imageUrl: attendee.profileImageMediaAssetId
					? (initialSessionAttendeeImageUrls.get(attendee.profileImageMediaAssetId) ?? null)
					: null
			}))
		}))
	);

	const openCreateSession = () => {
		sessionForm = buildDefaultSessionForm();
		createDialogOpen = true;
	};

	const createSession = async () => {
		const startTime = sessionForm.startTime;
		const endTime = sessionForm.endTime;
		if (
			!canCreate ||
			!canMutateOnline ||
			!clubIdTyped ||
			startTime === null ||
			endTime === null
		) {
			return;
		}

		pending = true;
		errorMessage = '';
		try {
			const desc = sessionForm.description.trim();
			const location = sessionForm.location.trim();
			const session = await withTimeout(
				convexClient.mutation(api.sessions.create, {
					clubId: clubIdTyped,
					startTime,
					endTime,
					...(desc ? { description: desc } : {}),
					...(location ? { location } : {})
				}),
				SESSION_CREATE_TIMEOUT_MS,
				'Request timed out. Check your connection and try again.'
			);
			reportMutationSuccess();
			if (session?._id) {
				const target = resolve(`/session/${session._id}/activities`);
				const headerTitleHint = Number.isFinite(startTime)
					? formatSessionHeaderLine(startTime)
					: undefined;
				try {
					await goto(target, {
						state: {
							...(headerTitleHint ? { headerTitleHint } : {}),
							headerTitleHintPath: `/session/${session._id}`
						}
					});
				} catch {
					await goto(target);
				}
				createDialogOpen = false;
				return;
			}
			errorMessage = 'Session was created, but could not be opened automatically.';
		} catch (error) {
			reportMutationFailure(error);
			errorMessage = error instanceof Error ? error.message : 'Failed to create session.';
		} finally {
			pending = false;
		}
	};

	const cancelSession = async (sessionId: Id<'sessions'>) => {
		if (!window.confirm(t('sessionCancel.confirm'))) return;
		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.sessions.cancel, { sessionId });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('sessionCancel.failure');
		} finally {
			pending = false;
		}
	};

	const setRsvp = async (sessionId: Id<'sessions'>, status: 'going' | 'not_going') => {
		rsvpPendingSessionId = sessionId;
		errorMessage = '';
		try {
			await convexClient.mutation(api.sessions.setRsvp, { sessionId, status });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('sessionRsvp.updateFailure');
		} finally {
			rsvpPendingSessionId = null;
		}
	};
</script>

<PageHeaderBackButton fallbackHref={clubId ? `/club/${clubId}` : '/onboarding/get-started'} />
<PageHeaderSearch
	bind:value={searchText}
	placeholder="Search sessions by date, description, or activity"
	ariaLabel="Search sessions"
	mode="auto"
/>
<PageHeaderActions>
	<div class="flex items-center gap-1">
		<Button
			variant="ghost"
			size="icon"
			aria-label="Create session"
			disabled={!canCreate || !canMutateOnline}
			onclick={openCreateSession}
		>
			<PlusIcon class="size-5 text-muted-foreground" />
		</Button>
	</div>
</PageHeaderActions>

{#if !clubIdTyped}
	<Alert>
		<AlertTitle>No active club</AlertTitle>
		<AlertDescription>Choose or create a club first from onboarding.</AlertDescription>
	</Alert>
{:else}
	<div class="flex w-full flex-col gap-4">
		{#if errorMessage}
			<Alert variant="destructive">
				<AlertTitle>Action failed</AlertTitle>
				<AlertDescription>{errorMessage}</AlertDescription>
			</Alert>
		{/if}

		{#if sessionCardsResponse.isLoading}
			<LoadingState label="Loading sessions" />
		{:else if visibleSessionCards.length === 0}
			<p class="text-sm text-muted-foreground">
				{searchText ? 'No sessions match your search.' : 'No sessions yet.'}
			</p>
		{:else}
			<div class="flex flex-col gap-4">
				{#each visibleSessionCardsWithSignedAttendees as entry (entry.session._id)}
					<ClubSessionCard
						session={entry.session}
						sessionHref={routes.sessionDetail(entry.session._id)}
						prefetchedCardData={entry}
						{canReadMembers}
						canDelete={canCancel}
						{canRsvp}
						rsvpPending={rsvpPendingSessionId === entry.session._id}
						onDelete={() => void cancelSession(entry.session._id)}
						onSetRsvp={(status) => void setRsvp(entry.session._id, status)}
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
					<FieldLabel for="sessionLocation">Location</FieldLabel>
					<Input
						id="sessionLocation"
						bind:value={sessionForm.location}
						placeholder="Address, description, or meeting URL"
					/>
				</div>
				<div class="flex flex-col gap-2">
					<FieldLabel for="sessionDescription">Description</FieldLabel>
					<Textarea id="sessionDescription" bind:value={sessionForm.description} rows={3} />
				</div>
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (createDialogOpen = false)}>Cancel</Button>
				<Button disabled={pending || !canCreate || !canMutateOnline} onclick={() => void createSession()}
					>{pending ? 'Creating...' : 'Open'}</Button
				>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
