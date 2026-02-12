<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import { api } from '$convex/_generated/api';
	import type { Doc } from '$convex/_generated/dataModel';
	import { useQuery } from 'convex-svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Separator } from '$lib/components/ui/separator';
	import AvatarStack from './avatar-stack.svelte';

	type Props = {
		session: Doc<'sessions'>;
		canReadMembers: boolean;
		href?: string;
	};

	let { session, canReadMembers, href }: Props = $props();

	const cardData = useQuery(api.sessions.getSessionCardData, () => ({
		sessionId: session._id,
		includeAttendees: canReadMembers
	}));

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
</script>

<Card class="gap-0 py-0" {href}>
	<CardContent class="flex flex-col gap-4 p-5">
		<div class="flex items-center gap-3">
			<div class="flex size-10 items-center justify-center rounded-xl bg-accent text-primary">
				<CalendarIcon class="size-5" />
			</div>
			<p class="type-h6-bold">{formatSessionLine(session.startTime)}</p>
		</div>

		{#if tagNames.length}
			<div class="flex flex-wrap gap-2">
				{#each tagNames as tag (tag)}
					<Badge variant="secondary" class="bg-accent text-primary">
						{tag}
					</Badge>
				{/each}
			</div>
		{/if}

		<Separator class="opacity-60" />

		{#if canReadMembers}
			<div class="flex flex-col gap-2">
				<p class="type-sm-bold text-muted-foreground">Attendees</p>
				{#if cardData.isLoading}
					<p class="type-sm text-muted-foreground">Loading attendees...</p>
				{:else if attendees.length === 0}
					<p class="type-sm text-muted-foreground">No attendees yet.</p>
				{:else}
					<AvatarStack people={attendees} max={4} />
				{/if}
			</div>
		{/if}
	</CardContent>
</Card>
