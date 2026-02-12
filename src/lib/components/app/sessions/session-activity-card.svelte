<script lang="ts">
	import Clock3Icon from '@lucide/svelte/icons/clock-3';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import PencilLineIcon from '@lucide/svelte/icons/pencil-line';
	import ActionMenu from '$lib/components/app/action-menu.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent } from '$lib/components/ui/card';

	type Activity = {
		id: string;
		name: string;
		content: string | null;
		minutes: number | null;
		buildingBlocks: string[];
	};

	type Props = {
		activity: Activity;
		blockNameById: Map<string, string>;
		canEdit: boolean;
		canDelete: boolean;
		onEdit?: () => void;
		onDelete?: () => void;
	};

	let { activity, blockNameById, canEdit, canDelete, onEdit, onDelete }: Props = $props();

	let blockNames = $derived(
		activity.buildingBlocks
			.map((id) => blockNameById.get(id) ?? id)
			.filter((value, index, values) => values.indexOf(value) === index)
	);

	let prepLabel = $derived(
		(activity.content ?? '').trim().length > 140 ? 'Prep needed' : 'Little prep'
	);
	let actionItems = $derived([
		{
			id: 'edit',
			label: 'Edit activity',
			Icon: PencilLineIcon,
			disabled: !canEdit,
			onSelect: onEdit
		},
		{
			id: 'delete',
			label: 'Delete activity',
			Icon: Trash2Icon,
			tone: 'destructive' as const,
			separatorBefore: canEdit,
			disabled: !canDelete,
			onSelect: onDelete
		}
	]);
</script>

<Card class="gap-0 py-0">
	<CardContent class="flex flex-col gap-3 p-4">
		<div class="flex items-start justify-between gap-3">
			<h3 class="type-h5-medium">{activity.name}</h3>
			<ActionMenu items={actionItems} ariaLabel={`Open actions for ${activity.name}`} />
		</div>
		<p class="text-muted-foreground">
			{activity.content ??
				'No activity notes yet. Add details to include prep steps, prompts, or handouts.'}
		</p>
		<div class="flex flex-wrap gap-2">
			{#if activity.minutes}
				<Badge variant="secondary" class="bg-secondary text-primary">
					<Clock3Icon class="size-3.5" />
					Short ({activity.minutes} mins)
				</Badge>
			{/if}
			<Badge variant="secondary" class="bg-secondary text-primary">
				<PencilLineIcon class="size-3.5" />
				{prepLabel}
			</Badge>
			{#each blockNames as blockName (blockName)}
				<Badge variant="secondary" class="bg-accent/70 text-primary">
					{blockName}
				</Badge>
			{/each}
		</div>
	</CardContent>
</Card>
