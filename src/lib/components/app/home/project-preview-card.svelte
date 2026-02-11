<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import { api } from '$convex/_generated/api';
	import type { Doc } from '$convex/_generated/dataModel';
	import { useQuery } from 'convex-svelte';
	import { Card, CardContent } from '$lib/components/ui/card';
	import AvatarStack from './avatar-stack.svelte';

	type MemberPreview = { name: string; imageUrl: string | null };

	type Props = {
		project: Doc<'projects'>;
		memberPreview?: MemberPreview[];
	};

	let { project, memberPreview }: Props = $props();

	const membersResponse = useQuery(api.projects.listMembers, () =>
		memberPreview ? 'skip' : { projectId: project._id }
	);

	const formatDueDate = (timestamp: number) => {
		const date = new Date(timestamp);
		const day = date.toLocaleDateString(undefined, { day: 'numeric' });
		const month = date.toLocaleDateString(undefined, { month: 'long' });
		const year = date.toLocaleDateString(undefined, { year: 'numeric' });
		return `Due by ${day} ${month}, ${year}`;
	};

	let people = $derived(
		memberPreview ??
			(membersResponse.data ?? []).map((m) => ({
				name:
					[m.firstName ?? '', m.lastName ?? ''].join(' ').trim() ||
					m.username ||
					m.email ||
					m.profileId,
				imageUrl: m.coverPhotoUrl ?? null
			}))
	);
</script>

<Card class="w-[18.5rem] shrink-0 gap-0 py-0 sm:w-[20rem]">
	<CardContent class="flex h-full flex-col gap-4 p-5">
		<div class="flex flex-col gap-2">
			<p class="text-lg font-semibold tracking-tight">{project.name}</p>
			{#if project.description}
				<p class="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{project.description}</p>
			{:else}
				<p class="text-sm text-muted-foreground">No description yet.</p>
			{/if}
		</div>

		<div class="flex flex-col gap-3">
			<AvatarStack people={people} max={3} sizeClass="size-8" />
			{#if project.dueDate}
				<div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
					<CalendarIcon class="size-4 text-primary" />
					<p class="line-clamp-1">{formatDueDate(project.dueDate)}</p>
				</div>
			{/if}
		</div>
	</CardContent>
</Card>
