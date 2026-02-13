<script lang="ts">
	/**
	 * SessionActivityCard — displays a single session activity with optional
	 * inline editing of the description via contentEditable.
	 *
	 * ## Inline editing & Convex realtime sync
	 *
	 * When `canEdit` and `onContentSave` are provided the description becomes a
	 * contentEditable <p>. Edits are persisted on blur through the async
	 * `onContentSave` callback (which should call the Convex `upsertActivity`
	 * mutation). Meanwhile, a reactive `$effect` syncs remote Convex updates
	 * into the element whenever the user is NOT focused, so two users viewing
	 * the same session see each other's changes in realtime.
	 *
	 * ### Optimistic guard (`lastSaved`)
	 * On blur the local text is saved optimistically — `lastSaved` prevents the
	 * sync effect from overwriting it with the stale Convex value while the
	 * mutation is in flight. Once Convex pushes the confirmed value matching
	 * `lastSaved`, the guard clears and normal sync resumes.
	 *
	 * ### Line breaks
	 * `innerText` (not `textContent`) is used to read/write the element so that
	 * Enter-key line breaks are preserved as `\n` characters. The element and
	 * the read-only fallback both use `whitespace-pre-wrap` to render them.
	 *
	 * ### Error handling
	 * If `onContentSave` rejects, `lastSaved` is cleared (letting the element
	 * revert to the last known Convex state) and a small "Save failed" message
	 * is shown. Focusing the field again clears the error for retry.
	 */
	import Clock3Icon from '@lucide/svelte/icons/clock-3';
	import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import PencilLineIcon from '@lucide/svelte/icons/pencil-line';
	import ActionMenu from '$lib/components/app/action-menu.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { dragHandle } from 'svelte-dnd-action';

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
		/** Show a drag handle on the left of the card for reordering. */
		showDragHandle?: boolean;
		onEdit?: () => void;
		onDelete?: () => void;
		/** Async callback fired on blur when content changes. Should persist to Convex. */
		onContentSave?: (content: string) => Promise<void>;
	};

	let {
		activity,
		blockNameById,
		canEdit,
		canDelete,
		showDragHandle = false,
		onEdit,
		onDelete,
		onContentSave
	}: Props = $props();

	let contentEl: HTMLParagraphElement | undefined = $state();
	let isEditing = $state(false);
	/** Optimistic guard — holds the value we just saved until Convex confirms it. */
	let lastSaved: string | null = $state(null);
	let saveError = $state(false);

	/** On blur: persist changed content via onContentSave, with optimistic guard. */
	const handleBlur = async () => {
		if (!contentEl || !onContentSave) return;
		isEditing = false;
		saveError = false;
		const newContent = contentEl.innerText?.trim() ?? '';
		const oldContent = activity.content?.trim() ?? '';
		if (newContent !== oldContent) {
			lastSaved = newContent;
			try {
				await onContentSave(newContent);
			} catch {
				// Save failed — clear optimistic guard so the element reverts
				// to the last known Convex state on the next sync.
				lastSaved = null;
				saveError = true;
			}
		}
	};

	const handleFocus = () => {
		isEditing = true;
		saveError = false;
	};

	// Sync remote Convex changes into the contentEditable element — but only
	// when the user is NOT actively editing (prevents clobbering local input).
	// Also skip if the remote value hasn't caught up with our last save yet
	// (optimistic guard) to avoid a flash of stale content after blur.
	$effect(() => {
		const remoteContent = activity.content;
		if (!contentEl || isEditing) return;
		const display = remoteContent ?? '';
		// Clear optimistic guard once Convex confirms our save
		if (lastSaved !== null && display === lastSaved) {
			lastSaved = null;
		}
		if (lastSaved !== null) return;
		if (contentEl.innerText !== display) {
			contentEl.innerText = display;
		}
	});

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
	<div class="flex">
		{#if showDragHandle}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				use:dragHandle
				aria-label="Drag to reorder"
				class="flex shrink-0 cursor-grab items-center justify-center px-1.5 text-muted-foreground/50 touch-none select-none active:cursor-grabbing"
			>
				<GripVerticalIcon class="size-5" />
			</div>
		{/if}
		<CardContent class="flex min-w-0 flex-1 flex-col gap-3 p-4">
			<div class="flex items-start justify-between gap-3">
				<h3 class="type-h5-medium">{activity.name}</h3>
				<ActionMenu items={actionItems} ariaLabel={`Open actions for ${activity.name}`} />
			</div>
		{#if canEdit && onContentSave}
			<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
			<p
				bind:this={contentEl}
				contenteditable="true"
				role="textbox"
				tabindex="0"
				data-placeholder="No activity notes yet. Tap to add details."
				onblur={handleBlur}
				onfocus={handleFocus}
				class="text-muted-foreground whitespace-pre-wrap rounded-md px-2 py-1 -mx-2 -my-1 transition-colors outline-none focus:bg-muted/50 hover:bg-muted/30 cursor-text empty:before:content-[attr(data-placeholder)] empty:before:italic empty:before:opacity-60"
			></p>
			{#if saveError}
				<p class="text-xs text-destructive">Save failed — tap to retry.</p>
			{/if}
		{:else}
			<p class="text-muted-foreground whitespace-pre-wrap">
				{activity.content ??
					'No activity notes yet. Add details to include prep steps, prompts, or handouts.'}
			</p>
		{/if}
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
	</div>
</Card>
