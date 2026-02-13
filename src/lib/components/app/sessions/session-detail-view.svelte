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
	import { dndzone } from 'svelte-dnd-action';

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
	type DndActivity = Omit<ActivityData, 'id'> & { id: string };
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
		if (!sessionIdTyped || !canUpdateActivity) {
			isDragging = false;
			return;
		}
		const activityIds = dndItems.map((item) => item.id as Id<'sessionActivities'>);
		try {
			await convexClient.mutation(api.sessions.reorderActivities, {
				sessionId: sessionIdTyped,
				activityIds
			});
		} catch (error) {
			activityError = error instanceof Error ? error.message : 'Failed to reorder activities.';
		} finally {
			isDragging = false;
		}
	};

	let attendanceSet = $derived(new Set((attendanceResponse.data ?? []).map((entry) => entry.userId)));
	let blockNameById = $derived(
		new Map((blocksResponse.data ?? []).map((block) => [String(block._id), block.name] as const))
	);

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
		session ? `/${session.clubId}/sessions` : '/onboarding/get-started'
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
			sessionDialogOpen = false;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to update session.';
		} finally {
			pending = false;
		}
	};

	const removeSession = async () => {
		if (!session) return;
		if (!window.confirm('Delete this session and all related activities?')) return;
		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.sessions.remove, { sessionId: session._id });
			await goto(`/${session.clubId}/sessions`);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to delete session.';
		} finally {
			pending = false;
		}
	};

	const openCreateActivity = () => {
		activityEditId = null;
		activityName = '';
		activityContent = '';
		activityMinutes = '';
		activityBlockIds = [];
		activityError = '';
		activityDialogOpen = true;
	};

	const openEditActivity = (activity: NonNullable<typeof activitiesResponse.data>[number]) => {
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
			activityDialogOpen = false;
		} catch (error) {
			activityError = error instanceof Error ? error.message : 'Failed to save activity.';
		} finally {
			pending = false;
		}
	};

	const deleteActivity = async (activityId: Id<'sessionActivities'>) => {
		pending = true;
		activityError = '';
		try {
			await convexClient.mutation(api.sessions.deleteActivity, { activityId });
		} catch (error) {
			activityError = error instanceof Error ? error.message : 'Failed to delete activity.';
		} finally {
			pending = false;
		}
	};

	const setAttendance = async (userId: string, attending: boolean) => {
		if (!sessionIdTyped) return;
		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.sessions.setAttendance, {
				sessionId: sessionIdTyped,
				userId,
				attending
			});
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to update attendance.';
		} finally {
			pending = false;
		}
	};

	let sessionActionItems = $derived([
		{
			id: 'edit-session',
			label: 'Edit details',
			Icon: PencilIcon,
			disabled: !canUpdateSession,
			onSelect: openSessionEditor
		},
		{
			id: 'delete-session',
			label: 'Delete session',
			Icon: Trash2Icon,
			tone: 'destructive' as const,
			separatorBefore: canUpdateSession,
			disabled: !canDeleteSession,
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
								<Button variant="outline" onclick={openCreateActivity}>
									<PlusIcon class="size-4" />
									New activity
								</Button>
								<Button onclick={() => void goto(routes.activityBooklet + '?session=' + sessionIdParam)}>
									<BookOpenIcon class="size-4" />
									Choose from booklet
								</Button>
							</div>
						{/if}
					</div>
				{:else}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						use:dndzone={{ items: dndItems, flipDurationMs: 200, dropTargetStyle: {} }}
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
								{blockNameById}
								canEdit={canUpdateActivity}
								canDelete={canDeleteActivity}
								onEdit={() => openEditActivity({ ...activity, id: activity.id as Id<'sessionActivities'> })}
								onDelete={() => void deleteActivity(activity.id as Id<'sessionActivities'>)}
							/>
						{/each}
					</div>
				{/if}

				{#if canCreateActivity && (activitiesResponse.data?.length ?? 0) > 0}
					<!-- Sticky offset derives from --bottom-nav-h (set in app-shell) to clear the mobile nav -->
					<div class="pointer-events-none sticky bottom-[calc(var(--bottom-nav-h,0rem)+1rem)] flex justify-center lg:bottom-8">
						<div class="pointer-events-auto flex gap-2">
							<Button variant="outline" class="rounded-full px-6 py-3 shadow-md" onclick={openCreateActivity}>
								<PlusIcon class="size-5" />
								New activity
							</Button>
							<Button class="rounded-full px-6 py-3 type-h6-bold shadow-md" onclick={() => void goto(routes.activityBooklet + '?session=' + sessionIdParam)}>
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
						<div class="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
							<div class="flex flex-col gap-1">
								<p class="type-body-medium">
									{[member.firstName ?? '', member.lastName ?? ''].join(' ').trim() || 'Member'}
								</p>
								<p class="type-sm text-muted-foreground">{member.email ?? member.userId}</p>
							</div>
							<div class="flex items-center gap-2">
								<Label for={`attendance-${member.clubMemberId}`}>Attending</Label>
								<Checkbox
									id={`attendance-${member.clubMemberId}`}
									checked={attendanceSet.has(member.userId)}
									disabled={!canManageAttendance || pending}
									onCheckedChange={(checked) => {
										if (!canManageAttendance) return;
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
					disabled={pending || !canUpdateSession}
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
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
				</div>
				<Dialog.Footer>
					<Button variant="outline" onclick={() => (activityDialogOpen = false)}>Cancel</Button>
					<Button
						disabled={
							pending ||
							!activityName.trim() ||
							!(activityEditId ? canUpdateActivity : canCreateActivity)
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
