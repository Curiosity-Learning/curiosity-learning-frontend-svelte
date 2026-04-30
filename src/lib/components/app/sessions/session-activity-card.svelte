<script lang="ts">
	/**
	 * SessionActivityCard — displays a single session activity with optional
	 * inline editing of title, description, minutes, and building blocks.
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
	 * ### Initial content rendering (important for drag-and-drop)
	 * The contentEditable <p> renders `{activity.content ?? ''}` as its inline
	 * text child rather than starting empty and populating via `$effect`.
	 * This is critical because svelte-dnd-action clones DOM elements
	 * synchronously on drag start — if the <p> were empty at clone time
	 * (waiting for the $effect to run), the cloned card would have the wrong
	 * height, causing a visible shrink-then-grow flash. The $effect still
	 * handles subsequent remote updates from Convex.
	 *
	 * ### Line breaks
	 * `innerText` (not `textContent`) is used to read/write the element so that
	 * Enter-key line breaks are preserved as `\n` characters. The element and
	 * the read-only fallback both use `whitespace-pre-wrap` to render them.
	 *
	 * ### Error handling
	 * If `onContentSave` rejects, the local edit surface re-syncs to the last
	 * known Convex value and a small "Save failed" message is shown. Focusing
	 * the field again clears the error for retry.
	 *
	 * The title (`activity.name`) uses an inline text input with blur-save so
	 * typing remains stable while still looking like inline text.
	 *
	 * ## Drag-and-drop reordering
	 *
	 * When `showDragHandle` is true, a grip icon appears on the left edge of the
	 * card. It uses svelte-dnd-action's `dragHandle` action so only the grip
	 * initiates drag — taps on content, buttons, and the contentEditable field
	 * work normally. The handle has `touch-none` to prevent the browser from
	 * intercepting touch events for scrolling.
	 */
	import Clock3Icon from '@lucide/svelte/icons/clock-3';
	import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import PencilLineIcon from '@lucide/svelte/icons/pencil-line';
	import ActionMenu from '$lib/components/app/action-menu.svelte';
	import { InlineMultiSelect } from '$lib/components/ui/multi-select';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { dragHandle } from 'svelte-dnd-action';

	type Activity = {
		id: string;
		name: string;
		content: string | null;
		minutes: number | null;
		buildingBlocks: string[];
	};

	type BuildingBlockOption = {
		id: string;
		name: string;
	};

	type Props = {
		activity: Activity;
		buildingBlockOptions: BuildingBlockOption[];
		/** Enables inline field rendering (title/content/minutes/blocks) for edit-capable users. */
		canInlineEdit?: boolean;
		/** Enables mutating actions (action menu, drag handle interactions). */
		canEdit: boolean;
		canDelete: boolean;
		/** Disables inline editors while still rendering them. */
		editingDisabled?: boolean;
		/** True when this row is the temporary dnd shadow placeholder item. */
		isDndShadowItem?: boolean;
		/** Show a drag handle on the left of the card for reordering. */
		showDragHandle?: boolean;
		onEdit?: () => void;
		onDelete?: () => void;
		/** Async callback fired on blur when name changes. */
		onNameSave?: (name: string) => Promise<void>;
		/** Async callback fired on blur when content changes. Should persist to Convex. */
		onContentSave?: (content: string) => Promise<void>;
		/** Async callback fired on blur when minutes changes. */
		onMinutesSave?: (minutes: number | null) => Promise<void>;
		/** Async callback fired when building block selection is committed. */
		onBuildingBlocksSave?: (buildingBlockIds: string[]) => Promise<void>;
	};

	let {
		activity,
		buildingBlockOptions,
		canInlineEdit,
		canEdit,
		canDelete,
		editingDisabled = false,
		isDndShadowItem = false,
		showDragHandle = false,
		onEdit,
		onDelete,
		onNameSave,
		onContentSave,
		onMinutesSave,
		onBuildingBlocksSave
	}: Props = $props();

	let inlineEditingEnabled = $derived(canInlineEdit ?? canEdit);

	let cardClass = $derived(isDndShadowItem ? 'gap-0 py-0 invisible' : 'gap-0 py-0');

	let draftName = $state('');
	let isEditingName = $state(false);
	let nameSaveError = $state(false);

	let contentValue = $state('');
	let isEditing = $state(false);
	let saveError = $state(false);
	let minutesValue = $state('');
	let isEditingMinutes = $state(false);
	let minutesSaveError = $state(false);

	const normalizeSingleLine = (value: string) =>
		value
			.replace(/\r\n/g, '\n')
			.replace(/\n+/g, ' ')
			.trim();

	const normalizeIds = (ids: string[]) => Array.from(new Set(ids));
	const idsMatch = (left: string[], right: string[]) => {
		const sortedLeft = normalizeIds(left).sort();
		const sortedRight = normalizeIds(right).sort();
		if (sortedLeft.length !== sortedRight.length) return false;
		for (let i = 0; i < sortedLeft.length; i += 1) {
			if (sortedLeft[i] !== sortedRight[i]) return false;
		}
		return true;
	};

	const handleNameBlur = async () => {
		if (!onNameSave || editingDisabled) return;
		isEditingName = false;
		nameSaveError = false;
		const newName = normalizeSingleLine(draftName);
		const oldName = normalizeSingleLine(activity.name);
		if (!newName) {
			draftName = oldName;
			return;
		}
		if (newName !== oldName) {
			draftName = newName;
			try {
				await onNameSave(newName);
			} catch {
				nameSaveError = true;
			}
		}
	};

	const handleNameFocus = () => {
		if (editingDisabled) return;
		isEditingName = true;
		nameSaveError = false;
	};

	const handleNameInput = (event: Event) => {
		const target = event.currentTarget as HTMLInputElement;
		draftName = target.value ?? '';
	};

	const handleNameKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			(event.currentTarget as HTMLInputElement | null)?.blur();
		}
	};

	/** On blur: persist changed content via onContentSave. */
	const handleBlur = async () => {
		if (!onContentSave || editingDisabled) return;
		isEditing = false;
		saveError = false;
		const newContent = contentValue.trim();
		const oldContent = activity.content?.trim() ?? '';
		if (newContent !== oldContent) {
			try {
				await onContentSave(newContent);
			} catch {
				saveError = true;
			}
		}
	};

	const handleFocus = () => {
		if (editingDisabled) return;
		isEditing = true;
		saveError = false;
	};

	const handleMinutesInput = (event: Event) => {
		const target = event.currentTarget as HTMLInputElement;
		minutesValue = target.value;
	};

	const handleMinutesFocus = () => {
		isEditingMinutes = true;
		minutesSaveError = false;
	};

	const handleMinutesBlur = async () => {
		if (!onMinutesSave || editingDisabled) return;
		isEditingMinutes = false;
		minutesSaveError = false;
		const oldMinutes = activity.minutes ?? null;
		const oldValue = oldMinutes === null ? '' : String(oldMinutes);
		const trimmed = minutesValue.trim();
		if (!trimmed) {
			minutesValue = '';
			if (oldMinutes !== null) {
				try {
					await onMinutesSave(null);
				} catch {
					minutesSaveError = true;
					minutesValue = oldValue;
				}
			}
			return;
		}
		const parsed = Number(trimmed);
		if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
			minutesValue = oldValue;
			return;
		}
		if (parsed !== oldMinutes) {
			try {
				await onMinutesSave(parsed);
			} catch {
				minutesSaveError = true;
				minutesValue = oldValue;
			}
		}
	};

	const handleBuildingBlocksSave = async (buildingBlockIds: string[]) => {
		if (!onBuildingBlocksSave || editingDisabled) return;
		const currentIds = activity.buildingBlocks;
		if (idsMatch(currentIds, buildingBlockIds)) return;
		await onBuildingBlocksSave(buildingBlockIds);
	};

	$effect(() => {
		const remoteName = normalizeSingleLine(activity.name);
		if (isEditingName) return;
		if (draftName !== remoteName) {
			draftName = remoteName;
		}
	});

	// Sync remote Convex changes into the contentEditable value when not actively editing.
	$effect(() => {
		const remoteContent = activity.content;
		if (isEditing) return;
		const display = remoteContent ?? '';
		if (contentValue !== display) {
			contentValue = display;
		}
	});

	$effect(() => {
		const remoteMinutes = activity.minutes === null ? '' : String(activity.minutes);
		if (isEditingMinutes) return;
		if (minutesValue !== remoteMinutes) {
			minutesValue = remoteMinutes;
		}
	});

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

<Card class={cardClass}>
	<div class="flex">
		{#if showDragHandle}
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
				<div class="flex min-w-0 flex-1 flex-col gap-1.5">
					{#if inlineEditingEnabled && onNameSave}
						<Input
							type="text"
							value={draftName}
							disabled={editingDisabled}
							oninput={handleNameInput}
							onfocus={handleNameFocus}
							onkeydown={handleNameKeydown}
							onblur={() => void handleNameBlur()}
							placeholder="Activity name"
							class="type-body-bold text-foreground h-auto border-0 bg-transparent px-0 py-0 shadow-none focus-visible:border-transparent focus-visible:ring-0"
						/>
					{:else}
						<h3 class="type-body-bold text-foreground">{activity.name}</h3>
					{/if}
					{#if inlineEditingEnabled && onContentSave}
						{#if editingDisabled}
							<p
								data-placeholder="No activity notes yet. Tap to add details."
								class="type-sm text-slate-500 whitespace-pre-wrap rounded-md px-2 py-1 -mx-2 -my-1 cursor-not-allowed opacity-70 empty:before:content-[attr(data-placeholder)] empty:before:italic empty:before:opacity-60"
							>
								{contentValue}
							</p>
						{:else}
							<!-- Inline text child is intentional. svelte-dnd-action clones the DOM
							     synchronously on drag start; an empty <p> produces a shorter clone
							     and a height flash. -->
							<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
							<p
								bind:innerText={contentValue}
								contenteditable="true"
								role="textbox"
								tabindex="0"
								data-placeholder="No activity notes yet. Tap to add details."
								onblur={handleBlur}
								onfocus={handleFocus}
								class="type-sm text-slate-500 whitespace-pre-wrap rounded-md px-2 py-1 -mx-2 -my-1 transition-colors outline-none focus:bg-muted/50 hover:bg-muted/30 cursor-text empty:before:content-[attr(data-placeholder)] empty:before:italic empty:before:opacity-60"
							>{activity.content ?? ''}</p>
						{/if}
					{:else}
						<p class="type-sm text-slate-500 whitespace-pre-wrap">
							{activity.content ??
								'No activity notes yet. Add details to include prep steps, prompts, or handouts.'}
						</p>
					{/if}
				</div>
				<ActionMenu items={actionItems} ariaLabel={`Open actions for ${activity.name}`} />
			</div>
			{#if nameSaveError}
				<p class="text-xs text-destructive">Save failed — tap title to retry.</p>
			{/if}
			{#if saveError}
				<p class="text-xs text-destructive">Save failed — tap description to retry.</p>
			{/if}
			<div class="flex flex-wrap items-start gap-2">
				{#if onMinutesSave}
					<div class="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2 py-1">
						<Clock3Icon class="size-3.5 text-muted-foreground" />
						<div class="relative">
							<Input
								type="number"
								min={1}
								inputmode="numeric"
								value={minutesValue}
								disabled={!inlineEditingEnabled || editingDisabled}
								oninput={handleMinutesInput}
								onfocus={handleMinutesFocus}
								onblur={() => void handleMinutesBlur()}
								class="h-7 w-20 pr-9 bg-input-background [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
							/>
							<span
								class="pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-xs text-muted-foreground"
							>
								mins
							</span>
						</div>
					</div>
				{/if}
				<InlineMultiSelect
					id={`activity-blocks-${activity.id}`}
					options={buildingBlockOptions.map((block) => ({ id: block.id, label: block.name }))}
					selectedIds={activity.buildingBlocks}
					editable={inlineEditingEnabled}
					disabled={editingDisabled}
					class="min-w-64 flex-1"
					emptyLabel="No building blocks selected"
					placeholder="Search building blocks..."
					onSave={handleBuildingBlocksSave}
				/>
			</div>
			{#if minutesSaveError}
				<p class="text-xs text-destructive">Save failed — update minutes again.</p>
			{/if}
		</CardContent>
	</div>
</Card>
