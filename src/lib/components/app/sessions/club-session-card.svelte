<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { api } from '$convex/_generated/api';
	import type { Doc } from '$convex/_generated/dataModel';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import {
		ActionMenu,
		DataRecordCard,
		DataRecordHeader,
		RelationAvatarStack,
		RelationChipSet,
		RelationListCards,
		RelationSection
	} from '$lib/components/app';
	import { TagChip } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';

	type Props = {
		session: Doc<'sessions'>;
		sessionHref: string;
		prefetchedCardData?: {
			tagNames: string[];
			attendees: Array<{ name: string; imageUrl: string | null }>;
			activityItems: Array<{ id: string; title: string; description: string | null }>;
			hiddenActivitiesCount: number;
		} | null;
		canReadMembers?: boolean;
		canDelete?: boolean;
		showAttendeesSection?: boolean;
		showActions?: boolean;
		onDelete?: () => void;
	};

	let {
		session,
		sessionHref,
		prefetchedCardData = null,
		canReadMembers = false,
		canDelete = false,
		showAttendeesSection = true,
		showActions = true,
		onDelete
	}: Props = $props();

	// When parent routes provide full card payload, skip nested reads to avoid UI pop-in.
	const cardData = useStableQuery(api.sessions.getSessionCardData, () =>
		prefetchedCardData
			? 'skip'
			: {
					sessionId: session._id,
					includeAttendees: showAttendeesSection && canReadMembers
				}
	);

	const activitiesResponse = useStableQuery(api.sessions.listActivities, () =>
		prefetchedCardData ? 'skip' : { sessionId: session._id }
	);

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

	let tagNames = $derived(prefetchedCardData?.tagNames ?? cardData.data?.tagNames ?? []);
	let attendees = $derived(prefetchedCardData?.attendees ?? cardData.data?.attendees ?? []);
	let visibleActivityLimit = 3;
	let totalActivitiesCount = $derived(
		prefetchedCardData
			? prefetchedCardData.activityItems.length + prefetchedCardData.hiddenActivitiesCount
			: (activitiesResponse.data?.length ?? 0)
	);
	let activities = $derived((activitiesResponse.data ?? []).slice(0, visibleActivityLimit));
	let activityItems = $derived(
		prefetchedCardData
			? prefetchedCardData.activityItems
			: activities.map((activity) => ({
					id: String(activity.id),
					title: activity.name,
					description: activity.content
				}))
	);
	let hiddenActivitiesCount = $derived(
		prefetchedCardData
			? prefetchedCardData.hiddenActivitiesCount
			: Math.max(totalActivitiesCount - activities.length, 0)
	);
	let actionItems = $derived([
		{
			id: 'delete',
			label: 'Delete session',
			Icon: Trash2Icon,
			tone: 'destructive' as const,
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
					<CalendarIcon class="size-5 shrink-0 text-primary" strokeWidth={2.75} />
				{/snippet}

				{#snippet actions()}
					{#if showActions}
						<ActionMenu items={actionItems} ariaLabel="Open session actions" />
					{/if}
				{/snippet}

				{#snippet meta()}
					<RelationChipSet chips={tagNames} tone="accent" />
				{/snippet}
			</DataRecordHeader>
		{:else}
			<DataRecordHeader title={formatSessionLine(session.startTime)}>
				{#snippet leading()}
					<CalendarIcon class="size-5 shrink-0 text-primary" strokeWidth={2.75} />
				{/snippet}

				{#snippet actions()}
					{#if showActions}
						<ActionMenu items={actionItems} ariaLabel="Open session actions" />
					{/if}
				{/snippet}
			</DataRecordHeader>
		{/if}
	{/snippet}

	<Separator class="opacity-70" />

	<RelationSection title="Activities">
		{#if !prefetchedCardData && activitiesResponse.isLoading}
			<p class="type-lead text-slate-500">Loading activities...</p>
		{:else if activityItems.length === 0}
			<p class="type-lead text-slate-500">No activities yet.</p>
		{:else}
			<RelationListCards items={activityItems} fallbackDescription="No activity notes yet." />
			{#if hiddenActivitiesCount > 0}
				<div class="flex justify-start">
					<TagChip
						tone="muted"
						label={`+${hiddenActivitiesCount} more`}
						class="type-sm-bold text-muted-foreground"
					/>
				</div>
			{/if}
		{/if}
	</RelationSection>

	{#if showAttendeesSection}
		<Separator class="opacity-70" />

		<RelationSection title="Attendees">
			{#if !canReadMembers}
				<p class="type-lead text-slate-500">You do not have access to attendees.</p>
			{:else if !prefetchedCardData && cardData.isLoading}
				<p class="type-lead text-slate-500">Loading attendees...</p>
			{:else}
				<RelationAvatarStack people={attendees} max={6} sizeClass="size-11" />
			{/if}
		</RelationSection>
	{/if}
</DataRecordCard>
