<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { api } from '$convex/_generated/api';
	import type { Doc } from '$convex/_generated/dataModel';
	import { useQuery } from 'convex-svelte';
	import ActionMenu from '$lib/components/app/action-menu.svelte';
	import AvatarStack from '$lib/components/app/home/avatar-stack.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
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

<Card>
	<CardHeader>
		<div class="flex items-center justify-between gap-3">
			<a
				href={sessionHref}
				class="flex min-w-0 items-center gap-3"
				data-sveltekit-preload-code="hover"
				data-sveltekit-preload-data="hover"
			>
				<div class="flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
					<CalendarIcon class="size-4" />
				</div>
				<CardTitle class="truncate text-m">{formatSessionLine(session.startTime)}</CardTitle>
			</a>
			<ActionMenu items={actionItems} ariaLabel="Open session actions" />
		</div>
		{#if tagNames.length}
			<div class="flex flex-wrap gap-2">
				{#each tagNames as tag (tag)}
					<Badge variant="secondary" class="bg-accent/60 px-3 py-1 text-sm font-semibold text-primary">
						{tag}
					</Badge>
				{/each}
			</div>
		{/if}
	</CardHeader>

	<Separator class="opacity-70" />

	<CardContent class="flex flex-col gap-3">
		<div class="flex flex-col gap-3">
			<p class="text-xl font-semibold tracking-tight text-muted-foreground">Activities</p>
			{#if activitiesResponse.isLoading}
				<p class="text-sm text-muted-foreground">Loading activities...</p>
			{:else if activities.length === 0}
				<p class="text-sm text-muted-foreground">No activities yet.</p>
			{:else}
				<div class="flex flex-col gap-3">
					{#each activities as activity (activity.id)}
						<a
							href={sessionHref}
							class="flex flex-col gap-2 rounded-xl bg-muted/50 p-4"
							data-sveltekit-preload-code="hover"
							data-sveltekit-preload-data="hover"
						>
							<p class="text-xl font-semibold tracking-tight">{activity.name}</p>
							<p class="line-clamp-2 text-sm text-muted-foreground">
								{activity.content ?? session.description}
							</p>
						</a>
					{/each}
				</div>
			{/if}
			</div>

		<Separator class="opacity-70" />

		<section class="flex flex-col gap-3">
			<p class="text-xl font-semibold tracking-tight text-muted-foreground">Attendees</p>
			{#if !canReadMembers}
				<p class="text-sm text-muted-foreground">You do not have access to attendees.</p>
			{:else if cardData.isLoading}
				<p class="text-sm text-muted-foreground">Loading attendees...</p>
			{:else if attendees.length === 0}
				<p class="text-sm text-muted-foreground">No attendees yet.</p>
			{:else}
				<AvatarStack people={attendees} max={6} sizeClass="size-11" />
			{/if}
		</section>
	</CardContent>
</Card>
