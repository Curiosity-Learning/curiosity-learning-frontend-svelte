<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import BanIcon from '@lucide/svelte/icons/ban';
	import { api } from '$convex/_generated/api';
	import type { Doc } from '$convex/_generated/dataModel';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { formatSessionHeaderLine } from '$lib/domain/session';
	import {
		ActionMenu,
		DataRecordCard,
		DataRecordHeader,
		LoadingState,
		RelationAvatarStack,
		RelationChipSet,
		RelationListCards,
		RelationSection
	} from '$lib/components/app';
	import SessionLocation from './session-location.svelte';
	import SessionRsvp from './session-rsvp.svelte';
	import { Badge, TagChip } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { t } from '$lib/i18n';

	type RsvpStatus = 'going' | 'not_going';

	type Props = {
		session: Doc<'sessions'>;
		sessionHref: string;
		prefetchedCardData?: {
			tagNames: string[];
			attendees: Array<{ name: string; imageUrl: string | null }>;
			activityItems: Array<{ id: string; title: string; description: string | null }>;
			hiddenActivitiesCount: number;
			myRsvpStatus?: RsvpStatus | null;
		} | null;
		canReadMembers?: boolean;
		canDelete?: boolean;
		showActivitiesSection?: boolean;
		showAttendeesSection?: boolean;
		showRsvpSection?: boolean;
		canRsvp?: boolean;
		rsvpPending?: boolean;
		attendeesAvatarSizeClass?: string;
		showActions?: boolean;
		navigationState?: App.PageState;
		onDelete?: () => void;
		onSetRsvp?: (status: RsvpStatus) => void;
		class?: string;
	};

	let {
		session,
		sessionHref,
		prefetchedCardData = null,
		canReadMembers = false,
		canDelete = false,
		showActivitiesSection = true,
		showAttendeesSection = true,
		showRsvpSection = true,
		canRsvp = false,
		rsvpPending = false,
		attendeesAvatarSizeClass = 'size-11',
		showActions = true,
		navigationState,
		onDelete,
		onSetRsvp,
		class: className
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

	let navigationStateResolved = $derived(
		navigationState ?? {
			headerTitleHint: formatSessionHeaderLine(session.startTime),
			headerTitleHintPath: `/session/${session._id}`
		}
	);

	let tagNames = $derived(prefetchedCardData?.tagNames ?? cardData.data?.tagNames ?? []);
	let attendees = $derived(prefetchedCardData?.attendees ?? cardData.data?.attendees ?? []);
	let myRsvpStatus = $derived(
		(prefetchedCardData?.myRsvpStatus ?? cardData.data?.myRsvpStatus ?? null) as
			| 'going'
			| 'not_going'
			| null
	);
	let isCancelled = $derived(Boolean(session.cancelled));
	let sessionHasStarted = $derived(session.startTime <= Date.now());
	// Upcoming sessions preview who is going; past sessions preview who attended.
	let attendeesSectionTitle = $derived(
		!isCancelled && !sessionHasStarted ? t('sessionRsvp.goingSectionTitle') : 'Attendees'
	);
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
	// A session that is cancelled or already started can never be cancelled (again) — the
	// action is dropped entirely rather than shown disabled (CEO decision 2026-07-11).
	let canCancelThisSession = $derived(canDelete && !isCancelled && !sessionHasStarted);
	let actionItems = $derived(
		canCancelThisSession
			? [
					{
						id: 'cancel',
						label: t('sessionCancel.actionLabel'),
						Icon: BanIcon,
						tone: 'destructive' as const,
						onSelect: onDelete
					}
				]
			: []
	);
	let showRsvpControl = $derived(showRsvpSection && canRsvp && !isCancelled && !sessionHasStarted);
</script>

<DataRecordCard href={sessionHref} navigationState={navigationStateResolved} class={className}>
	{#snippet header()}
		<DataRecordHeader
			title={formatSessionHeaderLine(session.startTime)}
			showMeta={isCancelled || tagNames.length > 0}
		>
			{#snippet leading()}
				<CalendarIcon
					class={`size-5 shrink-0 ${isCancelled ? 'text-muted-foreground' : 'text-orange-500'}`}
					strokeWidth={2.75}
				/>
			{/snippet}

			{#snippet actions()}
				{#if showActions}
					<ActionMenu items={actionItems} ariaLabel="Open session actions" />
				{/if}
			{/snippet}

			{#snippet meta()}
				{#if isCancelled}
					<Badge variant="destructive" size="sm">{t('sessionCancel.badge')}</Badge>
				{/if}
				{#if tagNames.length > 0}
					<RelationChipSet chips={tagNames} tone="accent" />
				{/if}
			{/snippet}
		</DataRecordHeader>
	{/snippet}

	<div class={isCancelled ? 'flex flex-col gap-4 opacity-60' : 'contents'}>
		{#if session.location}
			<SessionLocation location={session.location} class="px-1" />
		{/if}

		{#if showActivitiesSection}
			<Separator class="opacity-70" />

			<RelationSection title="Activities">
				{#if !prefetchedCardData && activitiesResponse.isLoading}
					<LoadingState variant="inline" size="sm" label="Loading activities" />
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
		{/if}

		{#if showAttendeesSection}
			<Separator class="opacity-70" />

			<RelationSection title={attendeesSectionTitle}>
				{#if !canReadMembers}
					<p class="type-lead text-slate-500">You do not have access to attendees.</p>
				{:else if !prefetchedCardData && cardData.isLoading}
					<LoadingState variant="inline" size="sm" label="Loading attendees" />
				{:else}
					<RelationAvatarStack people={attendees} max={6} sizeClass={attendeesAvatarSizeClass} />
				{/if}
			</RelationSection>
		{/if}
	</div>

	{#if showRsvpControl}
		<Separator class="opacity-70" />

		<SessionRsvp
			status={myRsvpStatus}
			interactive
			pending={rsvpPending}
			onSetStatus={onSetRsvp}
			class="mx-1 w-fit"
		/>
	{/if}
</DataRecordCard>
