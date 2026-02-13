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
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { DateTimePicker } from '$lib/components/ui/date-picker';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { FieldLabel } from '$lib/components/ui/field';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { useConvexClient, useQuery } from 'convex-svelte';

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

	let attendanceSet = $derived(new Set((attendanceResponse.data ?? []).map((entry) => entry.userId)));
	let blockNameById = $derived(
		new Map((blocksResponse.data ?? []).map((block) => [String(block._id), block.name] as const))
	);
	let sessionTags = $derived(sessionCardDataResponse.data?.tagNames ?? []);

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
			description: session.description
		};
		sessionDialogOpen = true;
	};

	const saveSession = async () => {
		if (!session || sessionForm.startTime === null || sessionForm.endTime === null) return;

		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.sessions.update, {
				sessionId: session._id,
				startTime: sessionForm.startTime,
				endTime: sessionForm.endTime,
				description: sessionForm.description.trim()
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

	const toggleActivityBlock = (blockId: Id<'buildingBlocks'>) => {
		if (activityBlockIds.includes(blockId)) {
			activityBlockIds = activityBlockIds.filter((entry) => entry !== blockId);
			return;
		}
		activityBlockIds = [...activityBlockIds, blockId];
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
	<div class="flex flex-col gap-4 pb-24 lg:pb-8">
		{#if session.description}
			<p class="type-lead text-muted-foreground">{session.description}</p>
		{/if}

		{#if sessionTags.length}
			<div class="flex flex-wrap gap-2">
				{#each sessionTags as tag (tag)}
					<Badge variant="secondary" class="bg-accent/70 px-3 py-1 text-primary">{tag}</Badge>
				{/each}
			</div>
		{/if}

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
				{#if (activitiesResponse.data?.length ?? 0) === 0}
					<p class="type-sm text-muted-foreground">No activities yet.</p>
				{:else}
					{#each activitiesResponse.data ?? [] as activity (activity.id)}
						<SessionActivityCard
							activity={{
								id: String(activity.id),
								name: activity.name,
								content: activity.content,
								minutes: activity.minutes,
								buildingBlocks: activity.buildingBlocks.map((blockId) => String(blockId))
							}}
							{blockNameById}
							canEdit={canUpdateActivity}
							canDelete={canDeleteActivity}
							onEdit={() => openEditActivity(activity)}
							onDelete={() => void deleteActivity(activity.id)}
						/>
					{/each}
				{/if}

				{#if canCreateActivity}
					<div class="pointer-events-none sticky bottom-22 flex justify-center lg:bottom-8">
						<div class="pointer-events-auto">
							<Button class="rounded-full px-8 py-3 type-h6-bold shadow-md" onclick={openCreateActivity}>
								<PlusIcon class="size-5" />
								Add from booklet
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
				<div class="flex flex-col gap-3">
					<div class="flex flex-col gap-2">
						<FieldLabel for="sessionStart" required>Start</FieldLabel>
						<DateTimePicker id="sessionStart" bind:value={sessionForm.startTime} />
					</div>
					<div class="flex flex-col gap-2">
						<FieldLabel for="sessionEnd" required>End</FieldLabel>
						<DateTimePicker id="sessionEnd" bind:value={sessionForm.endTime} />
					</div>
				</div>
				<div class="flex flex-col gap-2">
					<FieldLabel for="sessionDescription" required>Description</FieldLabel>
					<Textarea id="sessionDescription" bind:value={sessionForm.description} rows={3} required />
				</div>
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (sessionDialogOpen = false)}>Cancel</Button>
				<Button
					disabled={pending || !sessionForm.description.trim() || !canUpdateSession}
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
							<div class="flex flex-wrap gap-2">
								{#each blocksResponse.data ?? [] as block (block._id)}
									<Button
										type="button"
										size="sm"
										variant={activityBlockIds.includes(block._id) ? 'default' : 'outline'}
										onclick={() => toggleActivityBlock(block._id)}
									>
										{block.name}
									</Button>
								{/each}
							</div>
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
