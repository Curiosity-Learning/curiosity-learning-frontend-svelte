<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import {
		ActionMenu,
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
	import { routes } from '$lib/routes';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { SessionDateTimeForm } from '$lib/components/ui/date-picker';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import { Input } from '$lib/components/ui/input';
	import { FieldLabel } from '$lib/components/ui/field';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { dragHandleZone, SHADOW_ITEM_MARKER_PROPERTY_NAME } from 'svelte-dnd-action';
	import { fromStore } from 'svelte/store';

	type Props = {
		view: 'activities' | 'attendees';
	};

	let { view }: Props = $props();

	const convexClient = useConvexClient();

	let sessionIdParam = $derived((page.params as Record<string, string | undefined>).sessionId ?? null);
	let sessionIdTyped = $derived(sessionIdParam ? (sessionIdParam as Id<'sessions'>) : null);

	const sessionResponse = useQuery(api.sessions.getById, () =>
		sessionIdTyped ? { sessionId: sessionIdTyped } : 'skip'
	);
	let session = $derived(sessionResponse.data ?? null);

	const clubsResponse = useQuery(api.clubs.getMyClubs, {});
	let clubItem = $derived(
		session ? (clubsResponse.data ?? []).find((club) => club.clubId === session.clubId) ?? null : null
	);
	let clubPermissions = $derived(clubItem?.rolePermissions ?? []);
	let canUpdateSession = $derived(clubPermissions.includes('session:update'));
	let canDeleteSession = $derived(clubPermissions.includes('session:delete'));
	let canCreateActivity = $derived(clubPermissions.includes('session_activity:create'));
	let canUpdateActivity = $derived(clubPermissions.includes('session_activity:update'));
	let canDeleteActivity = $derived(clubPermissions.includes('session_activity:delete'));
	let canReadMembers = $derived(clubPermissions.includes('club_member:read_active'));
	let canReadAttendance = $derived(clubPermissions.includes('attendance:read'));
	let canManageAttendance = $derived(clubPermissions.includes('attendance:create'));

	const canMutateOnlineState = fromStore(canMutateOnlineStore);
	const connectivityMessageState = fromStore(connectivityMessageStore);
	let canMutateOnline = $derived(canMutateOnlineState.current);
	let connectivityMessage = $derived(connectivityMessageState.current);

	let canUpdateSessionOnline = $derived(canUpdateSession && canMutateOnline);
	let canDeleteSessionOnline = $derived(canDeleteSession && canMutateOnline);
	let canCreateActivityOnline = $derived(canCreateActivity && canMutateOnline);
	let canUpdateActivityOnline = $derived(canUpdateActivity && canMutateOnline);
	let canDeleteActivityOnline = $derived(canDeleteActivity && canMutateOnline);
	let canManageAttendanceOnline = $derived(canManageAttendance && canMutateOnline);

	const activitiesResponse = useQuery(api.sessions.listActivities, () =>
		sessionIdTyped && view === 'activities' ? { sessionId: sessionIdTyped } : 'skip'
	);
	const blocksResponse = useQuery(api.sessions.listBuildingBlocks, () =>
		view === 'activities' ? {} : 'skip'
	);
	const attendanceResponse = useQuery(api.sessions.listAttendance, () =>
		sessionIdTyped && canReadAttendance && view === 'attendees'
			? { sessionId: sessionIdTyped }
			: 'skip'
	);
	const membersResponse = useQuery(api.clubs.getMembers, () =>
		session && canReadMembers && view === 'attendees' ? { clubId: session.clubId } : 'skip'
	);

	const sessionCardDataResponse = useQuery(api.sessions.getSessionCardData, () =>
		sessionIdTyped ? { sessionId: sessionIdTyped } : 'skip'
	);

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
		description: ''
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

	let serverAttendanceSet = $derived(new Set((attendanceResponse.data ?? []).map((entry) => entry.userId)));
	let optimisticAttendanceByUser = $state<Record<string, boolean>>({});
	let attendancePendingUserIds = $state<Set<string>>(new Set());
	let buildingBlockOptions = $derived(
		(blocksResponse.data ?? []).map((block) => ({ id: String(block._id), name: block.name }))
	);

	const isUserAttending = (userId: string) => {
		const optimisticValue = optimisticAttendanceByUser[userId];
		return optimisticValue === undefined ? serverAttendanceSet.has(userId) : optimisticValue;
	};

	const isAttendancePending = (userId: string) => attendancePendingUserIds.has(userId);

	const clearOptimisticAttendance = (userId: string) => {
		const nextOptimistic = { ...optimisticAttendanceByUser };
		delete nextOptimistic[userId];
		optimisticAttendanceByUser = nextOptimistic;
	};

	$effect(() => {
		const nextOptimistic: Record<string, boolean> = {};
		let removedMatchedEntries = false;
		for (const [userId, optimisticValue] of Object.entries(optimisticAttendanceByUser)) {
			if (serverAttendanceSet.has(userId) === optimisticValue) {
				removedMatchedEntries = true;
				continue;
			}
			nextOptimistic[userId] = optimisticValue;
		}
		if (removedMatchedEntries) {
			optimisticAttendanceByUser = nextOptimistic;
		}
	});

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
		const nextBuildingBlockIds = updates.buildingBlockIds ?? activity.buildingBlocks;
		try {
			await convexClient.mutation(api.sessions.upsertActivity, {
				sessionId: sessionIdTyped,
				activityId: activity.id as Id<'sessionActivities'>,
				name: nextName,
				content: nextContent.trim() || undefined,
				minutes: nextMinutes ?? undefined,
				buildingBlockIds: nextBuildingBlockIds
			});
			reportMutationSuccess();
		} catch (error) {
			reportMutationFailure(error);
			throw error;
		}
	};

	const formatHeaderLine = (timestamp: number) => {
		const date = new Date(timestamp);
		const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
		const monthDay = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
		const time = date
			.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
			.replace('AM', 'am')
			.replace('PM', 'pm');
		return `${weekday}, ${monthDay}, ${time}`;
	};

	let headerTitle = $derived(session ? formatHeaderLine(session.startTime) : 'Session');
	let fallbackHref = $derived(
		session ? routes.clubSessions(session.clubId) : routes.onboardingGetStarted
	);

	const openSessionEditor = () => {
		if (!session) return;
		sessionForm = {
			startTime: session.startTime,
			endTime: session.endTime,
			description: session.description ?? ''
		};
		sessionDialogOpen = true;
	};

	const saveSession = async () => {
		if (!session || sessionForm.startTime === null || sessionForm.endTime === null) return;
		if (!ensureOnlineForMutation((message) => (errorMessage = message))) return;

		pending = true;
		errorMessage = '';
		try {
			const desc = sessionForm.description.trim();
			await convexClient.mutation(api.sessions.update, {
				sessionId: session._id,
				startTime: sessionForm.startTime,
				endTime: sessionForm.endTime,
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

	const removeSession = async () => {
		if (!session) return;
		if (!window.confirm('Delete this session and all related activities?')) return;
		if (!ensureOnlineForMutation((message) => (errorMessage = message))) return;
		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.sessions.remove, { sessionId: session._id });
			reportMutationSuccess();
			await goto(routes.clubSessions(session.clubId));
		} catch (error) {
			reportMutationFailure(error);
			errorMessage = error instanceof Error ? error.message : 'Failed to delete session.';
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

	const flushAttendanceUpdate = async (userId: string) => {
		if (!sessionIdTyped) return;
		if (isAttendancePending(userId)) return;
		const requestedAttending = optimisticAttendanceByUser[userId];
		if (requestedAttending === undefined) return;

		const nextPendingUsers = new Set(attendancePendingUserIds);
		nextPendingUsers.add(userId);
		attendancePendingUserIds = nextPendingUsers;
		try {
			await convexClient.mutation(api.sessions.setAttendance, {
				sessionId: sessionIdTyped,
				userId,
				attending: requestedAttending
			});
			reportMutationSuccess();
		} catch (error) {
			reportMutationFailure(error);
			if (optimisticAttendanceByUser[userId] === requestedAttending) {
				clearOptimisticAttendance(userId);
			}
			errorMessage = error instanceof Error ? error.message : 'Failed to update attendance.';
		} finally {
			const remainingPendingUsers = new Set(attendancePendingUserIds);
			remainingPendingUsers.delete(userId);
			attendancePendingUserIds = remainingPendingUsers;

			const latestAttending = optimisticAttendanceByUser[userId];
			if (latestAttending !== undefined && latestAttending !== requestedAttending) {
				void flushAttendanceUpdate(userId);
			}
		}
	};

	const setAttendance = (userId: string, attending: boolean) => {
		if (!sessionIdTyped) return;
		if (!ensureOnlineForMutation((message) => (errorMessage = message))) return;
		errorMessage = '';
		optimisticAttendanceByUser = { ...optimisticAttendanceByUser, [userId]: attending };
		void flushAttendanceUpdate(userId);
	};

	let sessionActionItems = $derived([
		{
			id: 'edit-session',
			label: 'Edit details',
			Icon: PencilIcon,
			disabled: !canUpdateSessionOnline,
			onSelect: openSessionEditor
		},
		{
			id: 'delete-session',
			label: 'Delete session',
			Icon: Trash2Icon,
			tone: 'destructive' as const,
			separatorBefore: canUpdateSessionOnline,
			disabled: !canDeleteSessionOnline,
			onSelect: () => void removeSession()
		}
	]);

</script>

<PageHeaderBackButton fallbackHref={fallbackHref} />
<PageHeaderTitle title={headerTitle} />
<PageHeaderActions>
	<ActionMenu items={sessionActionItems} ariaLabel="Open session actions" />
</PageHeaderActions>

{#if !sessionIdTyped}
	<Alert variant="destructive">
		<AlertTitle>Invalid session</AlertTitle>
		<AlertDescription>This session ID is not valid.</AlertDescription>
	</Alert>
{:else if sessionResponse.isLoading}
	<p class="type-sm text-muted-foreground">Loading session...</p>
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
			{#if session.description}
				<p class="type-lead text-muted-foreground">{session.description}</p>
			{/if}
				{#if (activitiesResponse.data?.length ?? 0) === 0}
					<div class="flex flex-col items-center gap-4 rounded-xl border border-border bg-card p-8 text-center">
						<p class="type-lead text-muted-foreground">No activities yet.</p>
						<p class="text-sm text-muted-foreground">Start building your session plan.</p>
						{#if canCreateActivity}
							<div class="flex flex-wrap justify-center gap-3">
								<Button variant="outline" onclick={openCreateActivity} disabled={!canCreateActivityOnline}>
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
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						use:dragHandleZone={{
						items: dndItems,
						flipDurationMs: 200,
						dropTargetStyle: {},
						transformDraggedElement: (el?: HTMLElement) => {
							if (!el) return;
							el.style.outline = 'none';
							el.style.boxShadow = '0 10px 25px -5px rgba(0,0,0,0.2), 0 4px 10px -5px rgba(0,0,0,0.1)';
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
								onEdit={() => openEditActivity({ ...activity, id: activity.id as Id<'sessionActivities'> })}
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
					<div class="pointer-events-none sticky bottom-[calc(var(--bottom-nav-h,0rem)+1rem)] flex justify-center lg:bottom-8">
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
								class="rounded-full px-6 py-3 type-h6-bold shadow-md"
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
		{:else}
			<div class="flex flex-col gap-3">
				{#if !canReadMembers}
					<p class="type-sm text-muted-foreground">You do not have access to club members.</p>
				{:else if membersResponse.isLoading}
					<p class="type-sm text-muted-foreground">Loading attendees...</p>
				{:else if (membersResponse.data?.length ?? 0) === 0}
					<p class="type-sm text-muted-foreground">No members found.</p>
				{:else}
					{#each membersResponse.data ?? [] as member (member.clubMemberId)}
						<div
							class={`relative flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 ${
								canManageAttendanceOnline
									? 'cursor-pointer transition-colors hover:bg-accent/40'
									: 'cursor-not-allowed'
							}`}
						>
							<label
								class={`absolute inset-0 rounded-xl ${
									canManageAttendanceOnline
										? 'cursor-pointer'
										: 'cursor-not-allowed'
								}`}
								for={`attendance-${member.clubMemberId}`}
							>
								<span class="sr-only">
									Toggle attendance for {[member.firstName ?? '', member.lastName ?? ''].join(' ').trim() ||
										member.username ||
										member.email ||
										'Member'}
								</span>
							</label>
							<div class="flex flex-col gap-1">
								<p class="type-body-medium">
									{[member.firstName ?? '', member.lastName ?? ''].join(' ').trim() || member.username || member.email || 'Member'}
								</p>
								{#if member.email}
									<p class="type-sm text-muted-foreground">{member.email}</p>
								{/if}
							</div>
							<div class="relative z-10 flex items-center">
								<Checkbox
									id={`attendance-${member.clubMemberId}`}
									class="size-6 rounded-md [&>[data-slot=checkbox-indicator]>svg]:size-4"
									checked={isUserAttending(member.userId)}
									aria-label={`Mark ${
										[member.firstName ?? '', member.lastName ?? ''].join(' ').trim() ||
										member.username ||
										member.email ||
										'Member'
									} as attending`}
									disabled={!canManageAttendanceOnline}
									onCheckedChange={(checked) => {
										if (!canManageAttendanceOnline) return;
										void setAttendance(member.userId, checked === true);
									}}
								/>
							</div>
						</div>
					{/each}
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
					<FieldLabel for="sessionDescription">Description</FieldLabel>
					<Textarea id="sessionDescription" bind:value={sessionForm.description} rows={3} />
				</div>
			</div>
			<Dialog.Footer>
					<Button variant="outline" onclick={() => (sessionDialogOpen = false)}>Cancel</Button>
					<Button
						disabled={pending || !canUpdateSessionOnline}
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
						<Input id="activityName" bind:value={activityName} placeholder="The Envelope Please" required />
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
							disabled={
								pending ||
								!activityName.trim() ||
								!(activityEditId ? canUpdateActivityOnline : canCreateActivityOnline)
							}
							onclick={() => void saveActivity()}
						>
						{pending ? 'Saving...' : activityEditId ? 'Update activity' : 'Add activity'}
					</Button>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog.Root>
	{/if}
{/if}
