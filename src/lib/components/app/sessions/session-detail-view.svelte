<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import {
		ActionMenu,
		ConfirmDialog,
		LoadingState,
		PageHeaderActions,
		PageHeaderBackButton,
		PageHeaderTitle
	} from '$lib/components/app';
	import {
		canMutateOnline as canMutateOnlineStore,
		connectivityMessage as connectivityMessageStore,
		reportMutationFailure,
		reportMutationSuccess
	} from '$lib/app/connectivity';
	import SessionActivityCard from '$lib/components/app/sessions/session-activity-card.svelte';
	import SessionLocation from '$lib/components/app/sessions/session-location.svelte';
	import SessionRsvp from '$lib/components/app/sessions/session-rsvp.svelte';
	import { routes } from '$lib/routes';
	import { ATTENDANCE_LOCK_WINDOW_MS, formatSessionHeaderLine } from '$lib/domain/session';
	import { t } from '$lib/i18n';
	import { createMediaField } from '$lib/media/media-field.svelte';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { SessionDateTimeForm } from '$lib/components/ui/date-picker';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import * as FileDropZone from '$lib/components/ui/file-drop-zone';
	import { Input } from '$lib/components/ui/input';
	import { FieldLabel } from '$lib/components/ui/field';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import BanIcon from '@lucide/svelte/icons/ban';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { dragHandleZone, SHADOW_ITEM_MARKER_PROPERTY_NAME } from 'svelte-dnd-action';
	import { fromStore } from 'svelte/store';

	type Props = {
		view: 'activities' | 'attendees' | 'photos';
	};

	let { view }: Props = $props();

	const convexClient = useConvexClient();

	let sessionIdParam = $derived(
		(page.params as Record<string, string | undefined>).sessionId ?? null
	);
	let sessionIdTyped = $derived(sessionIdParam ? (sessionIdParam as Id<'sessions'>) : null);

	const sessionResponse = useStableQuery(api.sessions.getById, () =>
		sessionIdTyped ? { sessionId: sessionIdTyped } : 'skip'
	);
	let session = $derived(sessionResponse.data ?? null);

	const clubsResponse = useStableQuery(api.clubs.getMyClubs, {});
	let clubItem = $derived(
		session
			? ((clubsResponse.data ?? []).find((club) => club.clubId === session.clubId) ?? null)
			: null
	);
	let clubPermissions = $derived(clubItem?.rolePermissions ?? []);
	let isCancelled = $derived(Boolean(session?.cancelled));
	let canUpdateSession = $derived(clubPermissions.includes('session:update') && !isCancelled);
	let canCancelSession = $derived(
		clubPermissions.includes('session:cancel') &&
			!isCancelled &&
			Boolean(session && session.startTime > Date.now())
	);
	let canCreateActivity = $derived(clubPermissions.includes('session_activity:create'));
	let canUpdateActivity = $derived(clubPermissions.includes('session_activity:update'));
	let canDeleteActivity = $derived(clubPermissions.includes('session_activity:delete'));
	let canReadAttendance = $derived(clubPermissions.includes('attendance:read'));
	let canManageAttendance = $derived(clubPermissions.includes('attendance:create'));
	let sessionHasStarted = $derived(Boolean(session && session.startTime <= Date.now()));
	let hasSessionPhotoPermission = $derived(clubPermissions.includes('session_photo:create'));
	let attendanceWindowOpen = $derived.by(() => {
		if (!session || session.cancelled) return false;
		const now = Date.now();
		return now >= session.startTime && now <= session.endTime + ATTENDANCE_LOCK_WINDOW_MS;
	});

	const canMutateOnlineState = fromStore(canMutateOnlineStore);
	const connectivityMessageState = fromStore(connectivityMessageStore);
	let canMutateOnline = $derived(canMutateOnlineState.current);
	let connectivityMessage = $derived(connectivityMessageState.current);

	let canUpdateSessionOnline = $derived(canUpdateSession && canMutateOnline);
	let canCancelSessionOnline = $derived(canCancelSession && canMutateOnline);
	let canCreateActivityOnline = $derived(canCreateActivity && canMutateOnline);
	let canUpdateActivityOnline = $derived(canUpdateActivity && canMutateOnline);
	let canDeleteActivityOnline = $derived(canDeleteActivity && canMutateOnline);
	let canManageAttendanceOnline = $derived(
		canManageAttendance && canMutateOnline && attendanceWindowOpen
	);
	// RSVP is only actionable before the session starts and while it isn't cancelled; anywhere
	// this is false the control is hidden entirely (CEO decision 2026-07-11). Transient offline
	// keeps the control visible but disabled, matching the rest of the app.
	let canRsvpToSession = $derived(
		clubPermissions.includes('session_rsvp:set') && !isCancelled && !sessionHasStarted
	);

	const activitiesResponse = useStableQuery(api.sessions.listActivities, () =>
		sessionIdTyped && view === 'activities' ? { sessionId: sessionIdTyped } : 'skip'
	);
	const blocksResponse = useStableQuery(api.sessions.listBuildingBlocks, () =>
		view === 'activities' ? {} : 'skip'
	);
	// The attendance roster is only meaningful once the session has started; before that the
	// attendees tab shows the RSVP roster instead.
	const attendanceRosterResponse = useStableQuery(api.sessions.listAttendanceRoster, () =>
		sessionIdTyped && canReadAttendance && view === 'attendees' && sessionHasStarted
			? { sessionId: sessionIdTyped }
			: 'skip'
	);
	const rsvpRosterResponse = useStableQuery(api.sessions.listRsvpRoster, () =>
		sessionIdTyped && view === 'attendees' ? { sessionId: sessionIdTyped } : 'skip'
	);
	let rsvpPending = $state(false);

	const photosResponse = useStableQuery(api.sessions.listPhotos, () =>
		sessionIdTyped && view === 'photos' ? { sessionId: sessionIdTyped } : 'skip'
	);
	const canUploadPhotoResponse = useStableQuery(api.sessions.canUploadSessionPhoto, () =>
		sessionIdTyped && hasSessionPhotoPermission && view === 'photos'
			? { sessionId: sessionIdTyped }
			: 'skip'
	);
	let photos = $derived(photosResponse.data ?? []);
	let canUploadPhotoNow = $derived(Boolean(canUploadPhotoResponse.data));
	let canUploadPhotoOnline = $derived(canUploadPhotoNow && canMutateOnline);
	let sessionPhotoLimitReached = $derived(photos.length >= 4);
	let sessionPhotoField = createMediaField(convexClient, 'sessionPhoto', { mode: 'immediate' });
	let photoUploadPending = $state(false);
	let photoError = $state('');
	let initialSessionPhotos = $derived(
		(page.data.initialSessionPhotos as
			| Array<{ assetId: Id<'mediaAssets'>; signedUrl: string }>
			| undefined) ?? []
	);
	let initialSessionPhotosByAssetId = $derived(
		new Map(initialSessionPhotos.map((asset) => [asset.assetId, asset.signedUrl] as const))
	);
	const photoUrlFor = (mediaAssetId: Id<'mediaAssets'>) =>
		initialSessionPhotosByAssetId.get(mediaAssetId) ?? null;

	onDestroy(() => {
		sessionPhotoField.destroy();
	});

	const uploadSessionPhoto = async (files: File[]) => {
		if (!sessionIdTyped) return;
		if (!canUploadPhotoOnline) {
			photoError = canMutateOnline ? '' : connectivityMessage;
			return;
		}
		if (sessionPhotoLimitReached) {
			photoError = t('sessionPhotos.limitReached');
			return;
		}

		photoUploadPending = true;
		photoError = '';
		try {
			await sessionPhotoField.selectFiles(files);
			if (!sessionPhotoField.isReady || !sessionPhotoField.assetId) {
				throw new Error(sessionPhotoField.errorMessage || t('sessionPhotos.uploadFailure'));
			}
			await sessionPhotoField.persistAttached(async (assetId) => {
				if (!assetId) return;
				await convexClient.mutation(api.sessions.addPhoto, {
					sessionId: sessionIdTyped,
					mediaAssetId: assetId
				});
			});
			reportMutationSuccess();
		} catch (error) {
			reportMutationFailure(error);
			let message = t('sessionPhotos.uploadFailure');
			if (error instanceof Error) {
				const match = error.message.match(/ConvexError:\s*(.+?)(?:\s+at\s+|$)/);
				message = match ? match[1] : error.message;
			}
			photoError = message;
		} finally {
			photoUploadPending = false;
		}
	};

	let deletePhotoDialogOpen = $state(false);
	let deletePhotoTarget = $state<Id<'sessionPhotos'> | null>(null);

	const openDeletePhotoDialog = (sessionPhotoId: Id<'sessionPhotos'>) => {
		deletePhotoTarget = sessionPhotoId;
		deletePhotoDialogOpen = true;
	};

	const deleteSessionPhoto = async () => {
		const sessionPhotoId = deletePhotoTarget;
		if (!sessionPhotoId) return;
		if (!ensureOnlineForMutation((message) => (photoError = message))) return;
		photoError = '';
		try {
			await convexClient.mutation(api.sessions.deletePhoto, { sessionPhotoId });
			reportMutationSuccess();
		} catch (error) {
			reportMutationFailure(error);
			photoError = error instanceof Error ? error.message : t('sessionPhotos.deleteFailure');
		}
	};

	let pending = $state(false);
	let errorMessage = $state('');
	let activityError = $state('');

	const ensureOnlineForMutation = (setError: (message: string) => void) => {
		if (canMutateOnline) return true;
		setError(connectivityMessage);
		return false;
	};

	let sessionDialogOpen = $state(false);
	let sessionForm = $state({
		startTime: null as number | null,
		endTime: null as number | null,
		description: '',
		location: ''
	});

	let activityDialogOpen = $state(false);
	let activityEditId = $state<Id<'sessionActivities'> | null>(null);
	let activityName = $state('');
	let activityContent = $state('');
	let activityMinutes = $state('');
	let activityBlockIds = $state<Array<Id<'buildingBlocks'>>>([]);

	// Drag-and-drop state: local copy of activities that syncs with query data.
	// svelte-dnd-action requires items with `id: string | number`.
	type ActivityData = NonNullable<typeof activitiesResponse.data>[number];
	type DndShadowMarker = { [K in typeof SHADOW_ITEM_MARKER_PROPERTY_NAME]?: boolean };
	type DndActivity = Omit<ActivityData, 'id'> & { id: string } & DndShadowMarker;
	let dndItems = $state<DndActivity[]>([]);
	let isDragging = $state(false);

	// Sync query data into dnd items when not mid-drag
	$effect(() => {
		const data = activitiesResponse.data;
		if (!data || isDragging) return;
		dndItems = data.map((a) => ({ ...a, id: String(a.id) }));
	});

	const handleDndConsider = (e: CustomEvent<{ items: DndActivity[] }>) => {
		isDragging = true;
		dndItems = e.detail.items;
	};

	const handleDndFinalize = async (e: CustomEvent<{ items: DndActivity[] }>) => {
		dndItems = e.detail.items;
		if (!sessionIdTyped || !canUpdateActivityOnline) {
			isDragging = false;
			return;
		}
		const activityIds = dndItems.map((item) => item.id as Id<'sessionActivities'>);
		try {
			await convexClient.mutation(api.sessions.reorderActivities, {
				sessionId: sessionIdTyped,
				activityIds
			});
			reportMutationSuccess();
		} catch (error) {
			reportMutationFailure(error);
			activityError = error instanceof Error ? error.message : 'Failed to reorder activities.';
		} finally {
			isDragging = false;
		}
	};

	let buildingBlockOptions = $derived(
		(blocksResponse.data ?? []).map((block) => ({ id: String(block._id), name: block.name }))
	);
	let rsvpStatusByProfileId = $derived(
		new Map((rsvpRosterResponse.data ?? []).map((row) => [row.profileId, row.status] as const))
	);

	const formatDisplayName = (person: {
		firstName?: string | null;
		lastName?: string | null;
		username?: string | null;
	}) => {
		return (
			[person.firstName ?? '', person.lastName ?? ''].join(' ').trim() ||
			person.username ||
			'Member'
		);
	};

	const saveInlineActivity = async (
		activity: {
			id: string;
			name: string;
			content: string | null;
			minutes: number | null;
			buildingBlocks: Array<Id<'buildingBlocks'>>;
		},
		updates: {
			name?: string;
			content?: string;
			minutes?: number | null;
			buildingBlockIds?: Array<Id<'buildingBlocks'>>;
		}
	) => {
		if (!sessionIdTyped) return;
		if (!canMutateOnline) {
			throw new Error(connectivityMessage);
		}
		const nextName = (updates.name ?? activity.name).trim();
		if (!nextName) {
			throw new Error('Activity name is required.');
		}
		const nextContent = updates.content !== undefined ? updates.content : (activity.content ?? '');
		const nextMinutes = updates.minutes !== undefined ? updates.minutes : activity.minutes;
		const nextBuildingBlockIds = (updates.buildingBlockIds ?? activity.buildingBlocks ?? []).filter(
			(blockId): blockId is Id<'buildingBlocks'> =>
				typeof blockId === 'string' && blockId.length > 0
		);
		const mutationArgs = {
			sessionId: sessionIdTyped,
			activityId: activity.id as Id<'sessionActivities'>,
			name: nextName,
			content: nextContent.trim() || undefined,
			minutes: nextMinutes ?? undefined,
			buildingBlockIds: nextBuildingBlockIds
		};
		try {
			await convexClient.mutation(api.sessions.upsertActivity, mutationArgs, {
				optimisticUpdate: (localStore) => {
					try {
						const queryArgs = { sessionId: mutationArgs.sessionId };
						const currentActivities = localStore.getQuery(api.sessions.listActivities, queryArgs);
						if (!Array.isArray(currentActivities)) return;

						let didPatch = false;
						const nextActivities = currentActivities.map((entry) => {
							if (!entry || typeof entry !== 'object') return entry;
							if (!('id' in entry) || String(entry.id) !== String(mutationArgs.activityId)) {
								return entry;
							}
							didPatch = true;
							return {
								...entry,
								name: mutationArgs.name,
								content: mutationArgs.content ?? null,
								minutes: mutationArgs.minutes ?? null,
								buildingBlocks: mutationArgs.buildingBlockIds
							};
						});
						if (!didPatch) return;
						localStore.setQuery(api.sessions.listActivities, queryArgs, nextActivities);
					} catch (error) {
						console.error('Inline activity optimistic update failed:', error);
					}
				}
			});
			reportMutationSuccess();
		} catch (error) {
			reportMutationFailure(error);
			activityError = error instanceof Error ? error.message : 'Failed to save activity.';
			throw error;
		}
	};

	let headerTitle = $derived(
		session
			? formatSessionHeaderLine(session.startTime)
			: sessionResponse.isLoading || sessionResponse.data === undefined
				? null
				: 'Session'
	);
	let fallbackHref = $derived(
		session ? routes.clubSessions(session.clubId) : routes.onboardingGetStarted
	);

	const openSessionEditor = () => {
		if (!session) return;
		sessionForm = {
			startTime: session.startTime,
			endTime: session.endTime,
			description: session.description ?? '',
			location: session.location ?? ''
		};
		sessionDialogOpen = true;
	};

	const saveSession = async () => {
		if (!session || sessionForm.startTime === null || sessionForm.endTime === null) return;
		const location = sessionForm.location.trim();
		if (!location) return;
		if (!ensureOnlineForMutation((message) => (errorMessage = message))) return;

		pending = true;
		errorMessage = '';
		try {
			const desc = sessionForm.description.trim();
			await convexClient.mutation(api.sessions.update, {
				sessionId: session._id,
				startTime: sessionForm.startTime,
				endTime: sessionForm.endTime,
				location,
				...(desc ? { description: desc } : {})
			});
			reportMutationSuccess();
			sessionDialogOpen = false;
		} catch (error) {
			reportMutationFailure(error);
			errorMessage = error instanceof Error ? error.message : 'Failed to update session.';
		} finally {
			pending = false;
		}
	};

	let cancelSessionDialogOpen = $state(false);

	const cancelSession = async () => {
		if (!session) return;
		if (!ensureOnlineForMutation((message) => (errorMessage = message))) return;
		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.sessions.cancel, { sessionId: session._id });
			reportMutationSuccess();
			// Stay on the session (CEO decision 2026-07-11) — the cancelled banner takes over.
		} catch (error) {
			reportMutationFailure(error);
			errorMessage = error instanceof Error ? error.message : t('sessionCancel.failure');
		} finally {
			pending = false;
		}
	};

	const openCreateActivity = () => {
		if (!canCreateActivityOnline) {
			activityError = connectivityMessage;
			return;
		}
		activityEditId = null;
		activityName = '';
		activityContent = '';
		activityMinutes = '';
		activityBlockIds = [];
		activityError = '';
		activityDialogOpen = true;
	};

	const openEditActivity = (activity: NonNullable<typeof activitiesResponse.data>[number]) => {
		if (!canUpdateActivityOnline) {
			activityError = connectivityMessage;
			return;
		}
		activityEditId = activity.id;
		activityName = activity.name;
		activityContent = activity.content ?? '';
		activityMinutes = activity.minutes ? String(activity.minutes) : '';
		activityBlockIds = activity.buildingBlocks;
		activityError = '';
		activityDialogOpen = true;
	};

	const saveActivity = async () => {
		if (!sessionIdTyped) return;
		if (!activityName.trim()) {
			activityError = 'Activity name is required.';
			return;
		}
		if (!ensureOnlineForMutation((message) => (activityError = message))) return;
		pending = true;
		activityError = '';
		try {
			await convexClient.mutation(api.sessions.upsertActivity, {
				sessionId: sessionIdTyped,
				activityId: activityEditId ?? undefined,
				name: activityName.trim(),
				content: activityContent.trim() || undefined,
				minutes: activityMinutes ? Number(activityMinutes) : undefined,
				buildingBlockIds: activityBlockIds
			});
			reportMutationSuccess();
			activityDialogOpen = false;
		} catch (error) {
			reportMutationFailure(error);
			activityError = error instanceof Error ? error.message : 'Failed to save activity.';
		} finally {
			pending = false;
		}
	};

	const deleteActivity = async (activityId: Id<'sessionActivities'>) => {
		if (!ensureOnlineForMutation((message) => (activityError = message))) return;
		pending = true;
		activityError = '';
		try {
			await convexClient.mutation(api.sessions.deleteActivity, { activityId });
			reportMutationSuccess();
		} catch (error) {
			reportMutationFailure(error);
			activityError = error instanceof Error ? error.message : 'Failed to delete activity.';
		} finally {
			pending = false;
		}
	};

	const setAttendance = async (profileId: Id<'profiles'>, status: 'present' | 'absent') => {
		if (!sessionIdTyped) return;
		if (!ensureOnlineForMutation((message) => (errorMessage = message))) return;
		errorMessage = '';
		const mutationArgs = { sessionId: sessionIdTyped, profileId, status };
		try {
			await convexClient.mutation(api.sessions.setAttendance, mutationArgs, {
				optimisticUpdate: (localStore) => {
					const queryArgs = { sessionId: mutationArgs.sessionId };
					const currentRoster = localStore.getQuery(api.sessions.listAttendanceRoster, queryArgs);
					if (!currentRoster) return;

					localStore.setQuery(
						api.sessions.listAttendanceRoster,
						queryArgs,
						currentRoster.map((entry) =>
							entry.profileId === profileId ? { ...entry, status: mutationArgs.status } : entry
						)
					);
				}
			});
			reportMutationSuccess();
		} catch (error) {
			reportMutationFailure(error);
			errorMessage = error instanceof Error ? error.message : t('sessionAttendance.updateFailure');
		}
	};

	const setRsvpStatus = async (status: 'going' | 'not_going') => {
		if (!sessionIdTyped || !canRsvpToSession) return;
		if (!ensureOnlineForMutation((message) => (errorMessage = message))) return;
		rsvpPending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.sessions.setRsvp, { sessionId: sessionIdTyped, status });
			reportMutationSuccess();
		} catch (error) {
			reportMutationFailure(error);
			errorMessage = error instanceof Error ? error.message : t('sessionRsvp.updateFailure');
		} finally {
			rsvpPending = false;
		}
	};

	// Only actions that can ever apply to this session appear; permanently impossible ones
	// (cancelled/past session) are dropped rather than disabled (CEO decision 2026-07-11).
	// `disabled` is reserved for the transient offline state.
	let sessionActionItems = $derived(
		[
			canUpdateSession
				? {
						id: 'edit-session',
						label: 'Edit details',
						Icon: PencilIcon,
						disabled: !canUpdateSessionOnline,
						onSelect: openSessionEditor
					}
				: null,
			canCancelSession
				? {
						id: 'cancel-session',
						label: t('sessionCancel.actionLabel'),
						Icon: BanIcon,
						tone: 'destructive' as const,
						separatorBefore: canUpdateSession,
						disabled: !canCancelSessionOnline,
						onSelect: () => (cancelSessionDialogOpen = true)
					}
				: null
		].filter((item): item is NonNullable<typeof item> => item !== null)
	);
</script>

<PageHeaderBackButton {fallbackHref} />
{#if headerTitle}
	<PageHeaderTitle title={headerTitle} />
{/if}
<PageHeaderActions none={sessionActionItems.length === 0}>
	<ActionMenu items={sessionActionItems} ariaLabel="Open session actions" />
</PageHeaderActions>

{#if session?.cancelled}
	<Alert variant="destructive">
		<AlertTitle>{t('sessionCancel.cancelledTitle')}</AlertTitle>
		<AlertDescription>{t('sessionCancel.cancelledDescription')}</AlertDescription>
	</Alert>
{/if}

{#if !sessionIdTyped}
	<Alert variant="destructive">
		<AlertTitle>Invalid session</AlertTitle>
		<AlertDescription>This session ID is not valid.</AlertDescription>
	</Alert>
{:else if sessionResponse.isLoading}
	<LoadingState label="Loading session" />
{:else if !session}
	<Alert variant="destructive">
		<AlertTitle>Session not found</AlertTitle>
		<AlertDescription>The requested session could not be loaded.</AlertDescription>
	</Alert>
{:else}
	<div class="flex flex-col gap-4 pb-2 lg:pb-6">
		{#if errorMessage}
			<Alert variant="destructive">
				<AlertTitle>Action failed</AlertTitle>
				<AlertDescription>{errorMessage}</AlertDescription>
			</Alert>
		{/if}
		{#if activityError}
			<Alert variant="destructive">
				<AlertTitle>Activity error</AlertTitle>
				<AlertDescription>{activityError}</AlertDescription>
			</Alert>
		{/if}

		{#if view === 'activities'}
			<!-- Overview: location + description live here (only), not repeated on every tab. -->
			{#if session.location || session.description}
				<div class="flex flex-col gap-2">
					{#if session.location}
						<SessionLocation location={session.location} />
					{/if}
					{#if session.description}
						<p class="type-lead text-muted-foreground">{session.description}</p>
					{/if}
				</div>
			{/if}
			{#if (activitiesResponse.data?.length ?? 0) === 0}
				<div
					class="flex flex-col items-center gap-4 rounded-xl border border-border bg-card p-8 text-center"
				>
					<p class="type-lead text-muted-foreground">No activities yet.</p>
					<p class="text-sm text-muted-foreground">Start building your session plan.</p>
					{#if canCreateActivity}
						<div class="flex flex-wrap justify-center gap-3">
							<Button
								variant="outline"
								onclick={openCreateActivity}
								disabled={!canCreateActivityOnline}
							>
								<PlusIcon class="size-4" />
								New activity
							</Button>
							<Button
								onclick={() =>
									void goto(routes.activityBooklet + '?session=' + sessionIdParam, {
										replaceState: true
									})}
								disabled={!canCreateActivityOnline}
							>
								<BookOpenIcon class="size-4" />
								Choose from booklet
							</Button>
						</div>
					{/if}
				</div>
			{:else}
				<div
					use:dragHandleZone={{
						items: dndItems,
						flipDurationMs: 200,
						dropTargetStyle: {},
						transformDraggedElement: (el?: HTMLElement) => {
							if (!el) return;
							el.style.outline = 'none';
							el.style.boxShadow =
								'0 10px 25px -5px rgba(0,0,0,0.2), 0 4px 10px -5px rgba(0,0,0,0.1)';
						}
					}}
					onconsider={handleDndConsider}
					onfinalize={handleDndFinalize}
					class="flex flex-col gap-4"
				>
					{#each dndItems as activity (activity.id)}
						<SessionActivityCard
							activity={{
								id: activity.id,
								name: activity.name,
								content: activity.content,
								minutes: activity.minutes,
								buildingBlocks: activity.buildingBlocks.map((blockId) => String(blockId))
							}}
							isDndShadowItem={activity[SHADOW_ITEM_MARKER_PROPERTY_NAME] === true}
							{buildingBlockOptions}
							canInlineEdit={canUpdateActivity}
							canEdit={canUpdateActivityOnline}
							canDelete={canDeleteActivityOnline}
							editingDisabled={canUpdateActivity && !canMutateOnline}
							showDragHandle={canUpdateActivityOnline}
							onEdit={() =>
								openEditActivity({ ...activity, id: activity.id as Id<'sessionActivities'> })}
							onDelete={() => void deleteActivity(activity.id as Id<'sessionActivities'>)}
							onNameSave={(name) =>
								saveInlineActivity(
									{
										id: activity.id,
										name: activity.name,
										content: activity.content,
										minutes: activity.minutes,
										buildingBlocks: activity.buildingBlocks
									},
									{ name }
								)}
							onContentSave={(content) =>
								saveInlineActivity(
									{
										id: activity.id,
										name: activity.name,
										content: activity.content,
										minutes: activity.minutes,
										buildingBlocks: activity.buildingBlocks
									},
									{ content }
								)}
							onMinutesSave={(minutes) =>
								saveInlineActivity(
									{
										id: activity.id,
										name: activity.name,
										content: activity.content,
										minutes: activity.minutes,
										buildingBlocks: activity.buildingBlocks
									},
									{ minutes }
								)}
							onBuildingBlocksSave={(buildingBlockIds) =>
								saveInlineActivity(
									{
										id: activity.id,
										name: activity.name,
										content: activity.content,
										minutes: activity.minutes,
										buildingBlocks: activity.buildingBlocks
									},
									{
										buildingBlockIds: buildingBlockIds as Array<Id<'buildingBlocks'>>
									}
								)}
						/>
					{/each}
				</div>
			{/if}

			{#if canCreateActivity && (activitiesResponse.data?.length ?? 0) > 0}
				<!-- Sticky offset derives from --bottom-nav-h (set in app-shell) to clear the mobile nav -->
				<div
					class="pointer-events-none sticky bottom-[calc(var(--bottom-nav-h,0rem)+1rem)] flex justify-center lg:bottom-8"
				>
					<div class="pointer-events-auto flex gap-2">
						<Button
							variant="outline"
							class="rounded-full px-6 py-3 shadow-md"
							onclick={openCreateActivity}
							disabled={!canCreateActivityOnline}
						>
							<PlusIcon class="size-5" />
							New activity
						</Button>
						<Button
							class="type-h6-bold rounded-full px-6 py-3 shadow-md"
							onclick={() =>
								void goto(routes.activityBooklet + '?session=' + sessionIdParam, {
									replaceState: true
								})}
							disabled={!canCreateActivityOnline}
						>
							<BookOpenIcon class="size-5" />
							From booklet
						</Button>
					</div>
				</div>
			{/if}
		{:else if view === 'attendees'}
			<div class="flex flex-col gap-3">
				{#if !sessionHasStarted}
					<!-- Before the session starts this tab is the RSVP roster: every member with their
					     going/not-going status (default going, CL-712), viewer's own row sorted to the
					     top (see sessions.listRsvpRoster). Every row uses the same SessionRsvp control;
					     only the viewer's own row is interactive, and only while actionable. -->
					{#if rsvpRosterResponse.isLoading}
						<LoadingState label="Loading attendees" />
					{:else if (rsvpRosterResponse.data?.length ?? 0) === 0}
						<p class="type-sm text-muted-foreground">{t('sessionAttendance.emptyState')}</p>
					{:else}
						{#each rsvpRosterResponse.data ?? [] as member (member.profileId)}
							<div
								class="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
							>
								<p class="type-body-medium">{formatDisplayName(member)}</p>
								<SessionRsvp
									status={member.status}
									interactive={member.isSelf && canRsvpToSession}
									pending={rsvpPending}
									disabled={!canMutateOnline}
									onSetStatus={(status) => void setRsvpStatus(status)}
								/>
							</div>
						{/each}
					{/if}
				{:else if !canReadAttendance}
					<p class="type-sm text-muted-foreground">You do not have access to attendees.</p>
				{:else if attendanceRosterResponse.isLoading}
					<LoadingState label="Loading attendees" />
				{:else if (attendanceRosterResponse.data?.length ?? 0) === 0}
					<p class="type-sm text-muted-foreground">{t('sessionAttendance.emptyState')}</p>
				{:else}
					{#each attendanceRosterResponse.data ?? [] as member (member.profileId)}
						<div
							class="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
						>
							<div class="flex flex-col gap-1">
								<p class="type-body-medium">
									{member.isPastMember ? 'Past member' : formatDisplayName(member)}
								</p>
								{#if rsvpStatusByProfileId.has(member.profileId)}
									<p class="type-sm text-muted-foreground">
										{rsvpStatusByProfileId.get(member.profileId) === 'going'
											? t('sessionRsvp.indicatorGoing')
											: t('sessionRsvp.indicatorNotGoing')}
									</p>
								{/if}
								{#if member.status === null}
									<p class="type-sm text-muted-foreground">
										{t('sessionAttendance.notRecorded')}
									</p>
								{/if}
							</div>
							<div class="relative z-10 flex items-center">
								<!-- Controls render only while attendance can still change (permission + open
								     window); permanently-locked states show plain status instead of dead
								     buttons. Transient offline keeps the convention of disabling. -->
								{#if canManageAttendance && attendanceWindowOpen && !member.isPastMember}
									<ToggleGroup.Root
										type="single"
										variant="outline"
										size="sm"
										value={member.status ?? undefined}
										disabled={!canMutateOnline}
										onValueChange={(value) => {
											if (!canManageAttendanceOnline) return;
											if (value !== 'present' && value !== 'absent') return;
											void setAttendance(member.profileId, value);
										}}
									>
										<ToggleGroup.Item value="present" aria-label={`Mark ${formatDisplayName(member)} present`}>
											{t('sessionAttendance.present')}
										</ToggleGroup.Item>
										<ToggleGroup.Item value="absent" aria-label={`Mark ${formatDisplayName(member)} absent`}>
											{t('sessionAttendance.absent')}
										</ToggleGroup.Item>
									</ToggleGroup.Root>
								{:else if member.status !== null}
									<!-- Read-only (locked window / no permission): plain status, no dead controls.
									     The lock itself is conveyed by the icon on this tab. -->
									<p class="type-sm-bold text-muted-foreground">
										{member.status === 'present'
											? t('sessionAttendance.present')
											: t('sessionAttendance.absent')}
									</p>
								{/if}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		{:else}
			<div class="flex flex-col gap-4">
				{#if isCancelled}
					<p class="type-sm text-muted-foreground">{t('sessionPhotos.cancelledNotice')}</p>
				{/if}
				{#if photoError}
					<Alert variant="destructive">
						<AlertTitle>Photo error</AlertTitle>
						<AlertDescription>{photoError}</AlertDescription>
					</Alert>
				{/if}

				{#if hasSessionPhotoPermission && !isCancelled}
					{#if canUploadPhotoOnline && !sessionPhotoLimitReached}
						<FileDropZone.Root
							accept={sessionPhotoField.accept}
							maxFiles={1}
							fileCount={0}
							maxFileSize={sessionPhotoField.maxBytes}
							disabled={photoUploadPending || sessionPhotoField.isBusy}
							onUpload={uploadSessionPhoto}
						>
							<FileDropZone.Trigger>
								<div
									class="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
								>
									{photoUploadPending || sessionPhotoField.isBusy
										? t('sessionPhotos.uploading')
										: t('sessionPhotos.uploadLabel')}
								</div>
							</FileDropZone.Trigger>
						</FileDropZone.Root>
					{:else if sessionPhotoLimitReached}
						<p class="type-sm text-muted-foreground">{t('sessionPhotos.limitReached')}</p>
					{:else if !sessionHasStarted}
						<p class="type-sm text-muted-foreground">
							{t('sessionPhotos.windowClosedBeforeStart')}
						</p>
					{:else if !canUploadPhotoNow}
						<p class="type-sm text-muted-foreground">{t('sessionPhotos.windowClosedAfterLock')}</p>
					{/if}
				{/if}

				{#if photosResponse.isLoading}
					<LoadingState label="Loading photos" />
				{:else if photos.length === 0}
					<p class="type-sm text-muted-foreground">{t('sessionPhotos.emptyState')}</p>
				{:else}
					<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
						{#each photos as photo (photo.sessionPhotoId)}
							{@const photoUrl = photoUrlFor(photo.mediaAssetId)}
							<div
								class="group relative aspect-square overflow-hidden rounded-xl border border-border bg-muted/20"
							>
								{#if photoUrl}
									<img
										src={photoUrl}
										alt="Session"
										class="h-full w-full object-cover"
									/>
								{:else}
									<div class="flex h-full w-full items-center justify-center p-4">
										<p class="text-xs text-muted-foreground">Preparing photo...</p>
									</div>
								{/if}
								{#if photo.canDelete && canMutateOnline}
									<button
										type="button"
										class="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
										aria-label="Remove photo"
										onclick={() => openDeletePhotoDialog(photo.sessionPhotoId)}
									>
										<TrashIcon class="size-3.5" />
									</button>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<Dialog.Root bind:open={sessionDialogOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Edit session</Dialog.Title>
				<Dialog.Description>Update local date and time values for this session.</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-3">
				<SessionDateTimeForm
					bind:startTime={sessionForm.startTime}
					bind:endTime={sessionForm.endTime}
				/>
				<div class="flex flex-col gap-2">
					<FieldLabel for="sessionLocation" required>{t('sessionEditor.locationLabel')}</FieldLabel>
					<Input
						id="sessionLocation"
						bind:value={sessionForm.location}
						placeholder={t('sessionEditor.locationPlaceholder')}
						required
					/>
				</div>
				<div class="flex flex-col gap-2">
					<FieldLabel for="sessionDescription">Description</FieldLabel>
					<Textarea id="sessionDescription" bind:value={sessionForm.description} rows={3} />
				</div>
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (sessionDialogOpen = false)}>Cancel</Button>
				<Button
					disabled={pending || !canUpdateSessionOnline || !sessionForm.location.trim()}
					onclick={() => void saveSession()}>{pending ? 'Saving...' : 'Save session'}</Button
				>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	{#if view === 'activities'}
		<Dialog.Root bind:open={activityDialogOpen}>
			<Dialog.Content>
				<Dialog.Header>
					<Dialog.Title>{activityEditId ? 'Edit activity' : 'Add activity'}</Dialog.Title>
					<Dialog.Description>Customize activity details for this session plan.</Dialog.Description>
				</Dialog.Header>
				<div class="flex flex-col gap-3">
					<div class="flex flex-col gap-2">
						<FieldLabel for="activityName" required>Name</FieldLabel>
						<Input
							id="activityName"
							bind:value={activityName}
							placeholder="The Envelope Please"
							required
						/>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="activityContent">Description</Label>
						<Textarea id="activityContent" bind:value={activityContent} rows={4} />
					</div>
					<div class="flex flex-col gap-2">
						<Label for="activityMinutes">Minutes</Label>
						<Input id="activityMinutes" bind:value={activityMinutes} type="number" min={1} />
					</div>
					<div class="flex flex-col gap-2">
						<Label>Building blocks</Label>
						<ToggleGroup.Root
							type="multiple"
							bind:value={activityBlockIds}
							variant="outline"
							size="sm"
						>
							{#each blocksResponse.data ?? [] as block (block._id)}
								<ToggleGroup.Item value={block._id}>
									{block.name}
								</ToggleGroup.Item>
							{/each}
						</ToggleGroup.Root>
					</div>
				</div>
				<Dialog.Footer>
					<Button variant="outline" onclick={() => (activityDialogOpen = false)}>Cancel</Button>
					<Button
						disabled={pending ||
							!activityName.trim() ||
							!(activityEditId ? canUpdateActivityOnline : canCreateActivityOnline)}
						onclick={() => void saveActivity()}
					>
						{pending ? 'Saving...' : activityEditId ? 'Update activity' : 'Add activity'}
					</Button>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog.Root>
	{/if}
{/if}

<ConfirmDialog
	bind:open={cancelSessionDialogOpen}
	title={t('sessionCancel.actionLabel')}
	description={t('sessionCancel.confirm')}
	confirmLabel={t('sessionCancel.actionLabel')}
	variant="destructive"
	onConfirm={cancelSession}
/>

<ConfirmDialog
	bind:open={deletePhotoDialogOpen}
	title={t('sessionPhotos.deleteConfirm')}
	confirmLabel={t('sessionPhotos.deleteAction')}
	variant="destructive"
	onConfirm={deleteSessionPhoto}
/>
