<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { api } from '$convex/_generated/api';
	import type { Doc } from '$convex/_generated/dataModel';
	import { useQuery } from 'convex-svelte';
	import {
		ActionMenu,
		DataRecordCard,
		DataRecordHeader,
		RelationAvatarStack,
		RelationChipSet,
		RelationListCards,
		RelationSection
	} from '$lib/components/app';
	import { Separator } from '$lib/components/ui/separator';

	type Props = {
		session: Doc<'sessions'>;
		sessionHref: string;
		canReadMembers: boolean;
		canEdit: boolean;
		canDelete: boolean;
		onEdit?: () => void;
		onDelete?: () => void;
	};

	let {
		session,
		sessionHref,
		canReadMembers,
		canEdit,
		canDelete,
		onEdit,
		onDelete
	}: Props = $props();

	const cardData = useQuery(api.sessions.getSessionCardData, () => ({
		sessionId: session._id,
		includeAttendees: canReadMembers
	}));

	const activitiesResponse = useQuery(api.sessions.listActivities, () => ({ sessionId: session._id }));

	const formatSessionLine = (timestamp: number) => {
		const date = new Date(timestamp);
		const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
		const monthDay = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
		const time = date
			.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
			.replace('AM', 'am')
			.replace('PM', 'pm');
		return `${weekday}, ${monthDay}, ${time}`;
	};

	let tagNames = $derived(cardData.data?.tagNames ?? []);
	let attendees = $derived(cardData.data?.attendees ?? []);
	let activities = $derived((activitiesResponse.data ?? []).slice(0, 3));
	let activityItems = $derived(
		activities.map((activity) => ({
			id: String(activity.id),
			title: activity.name,
			description: activity.content ?? session.description
		}))
	);
	let actionItems = $derived([
		{
			id: 'edit',
			label: 'Edit session',
			Icon: PencilIcon,
			disabled: !canEdit,
			onSelect: onEdit
		},
		{
			id: 'delete',
			label: 'Delete session',
			Icon: Trash2Icon,
			tone: 'destructive' as const,
			separatorBefore: canEdit,
			disabled: !canDelete,
			onSelect: onDelete
		}
	]);
</script>

<DataRecordCard href={sessionHref}>
	{#snippet header()}
		{#if tagNames.length > 0}
			<DataRecordHeader title={formatSessionLine(session.startTime)}>
				{#snippet leading()}
					<div class="flex size-8 items-center justify-center rounded-xl bg-accent text-primary">
						<CalendarIcon class="size-4" />
					</div>
				{/snippet}

				{#snippet actions()}
					<ActionMenu items={actionItems} ariaLabel="Open session actions" />
				{/snippet}

				{#snippet meta()}
					<RelationChipSet chips={tagNames} tone="accent" />
				{/snippet}
			</DataRecordHeader>
		{:else}
			<DataRecordHeader title={formatSessionLine(session.startTime)}>
				{#snippet leading()}
					<div class="flex size-8 items-center justify-center rounded-xl bg-accent text-primary">
						<CalendarIcon class="size-4" />
					</div>
				{/snippet}

				{#snippet actions()}
					<ActionMenu items={actionItems} ariaLabel="Open session actions" />
				{/snippet}
			</DataRecordHeader>
		{/if}
	{/snippet}

	<Separator class="opacity-70" />

	<RelationSection title="Activities">
		{#if activitiesResponse.isLoading}
			<p class="type-lead text-slate-500">Loading activities...</p>
		{:else if activityItems.length === 0}
			<p class="type-lead text-slate-500">No activities yet.</p>
		{:else}
			<RelationListCards items={activityItems} fallbackDescription={session.description} />
		{/if}
	</RelationSection>

	<Separator class="opacity-70" />

	<RelationSection title="Attendees">
		{#if !canReadMembers}
			<p class="type-lead text-slate-500">You do not have access to attendees.</p>
		{:else if cardData.isLoading}
			<p class="type-lead text-slate-500">Loading attendees...</p>
		{:else}
			<RelationAvatarStack people={attendees} max={6} sizeClass="size-11" />
		{/if}
	</RelationSection>
</DataRecordCard>
