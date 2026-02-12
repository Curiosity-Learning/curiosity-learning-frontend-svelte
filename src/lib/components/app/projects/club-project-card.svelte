<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { api } from '$convex/_generated/api';
	import type { Doc } from '$convex/_generated/dataModel';
	import { useQuery } from 'convex-svelte';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { cn } from '$lib/utils.js';
	import AvatarStack from '$lib/components/app/home/avatar-stack.svelte';

	type MemberPreview = {
		name: string;
		imageUrl: string | null;
	};

	type Props = {
		project: Doc<'projects'>;
		status?: 'current' | 'completed';
		memberPreview?: MemberPreview[];
		class?: string;
	};

	let { project, status, memberPreview, class: className }: Props = $props();

	const membersResponse = useQuery(api.projects.listMembers, () =>
		memberPreview ? 'skip' : { projectId: project._id }
	);

	const toOrdinalDay = (day: number) => {
		const moduloTen = day % 10;
		const moduloHundred = day % 100;
		if (moduloTen === 1 && moduloHundred !== 11) return `${day}st`;
		if (moduloTen === 2 && moduloHundred !== 12) return `${day}nd`;
		if (moduloTen === 3 && moduloHundred !== 13) return `${day}rd`;
		return `${day}th`;
	};

	const formatDateLabel = (timestamp: number) => {
		const date = new Date(timestamp);
		const day = toOrdinalDay(date.getDate());
		const month = date.toLocaleDateString(undefined, { month: 'long' });
		const year = date.toLocaleDateString(undefined, { year: 'numeric' });
		return `${day} ${month}, ${year}`;
	};

	let people = $derived(
		memberPreview ??
			(membersResponse.data ?? []).map((member) => ({
				name:
					[member.firstName ?? '', member.lastName ?? ''].join(' ').trim() ||
					member.username ||
					member.email ||
					member.profileId,
				imageUrl: member.coverPhotoUrl ?? null
			}))
	);

	let isCompleted = $derived(status ? status === 'completed' : Boolean(project.doneDate));
	let statusLabel = $derived.by(() => {
		if (isCompleted) {
			if (project.doneDate) return `Completed on ${formatDateLabel(project.doneDate)}`;
			return 'Completed';
		}
		if (project.dueDate) return `Due by ${formatDateLabel(project.dueDate)}`;
		return 'No due date';
	});
</script>

<Card class={cn('w-full gap-0 py-0 shadow-none', className)}>
	<CardContent class="flex flex-col gap-5 p-5">
		<div class="flex flex-col gap-2">
			<p class="type-h5-bold">{project.name}</p>
			{#if project.description}
				<p class="line-clamp-3 type-lead text-muted-foreground">{project.description}</p>
			{:else}
				<p class="type-lead text-muted-foreground">No description yet.</p>
			{/if}
		</div>

		<div class="flex flex-col gap-4">
			<AvatarStack people={people} max={3} sizeClass="size-9" />
			<div class="flex items-center gap-2 type-lead text-muted-foreground">
				{#if isCompleted}
					<CheckIcon class="size-5 text-chart-2" />
				{:else}
					<CalendarIcon class="size-5 text-primary" />
				{/if}
				<p class="line-clamp-1">{statusLabel}</p>
			</div>
		</div>
	</CardContent>
</Card>
