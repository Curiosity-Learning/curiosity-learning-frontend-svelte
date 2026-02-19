<script lang="ts">
	import { TagChip, type TagChipTone } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { cn } from '$lib/utils.js';

	type Option = {
		id: string;
		label: string;
	};

	type Props = {
		id?: string;
		options: Option[];
		selectedIds: string[];
		editable: boolean;
		disabled?: boolean;
		ariaLabel?: string;
		emptyLabel?: string;
		placeholder?: string;
		noResultsLabel?: string;
		chipTone?: TagChipTone;
		class?: string;
		onSave?: (selectedIds: string[]) => Promise<void>;
	};

	let {
		id = 'inline-multi-select',
		options,
		selectedIds,
		editable,
		disabled = false,
		ariaLabel = 'Selected options',
		emptyLabel = 'None selected',
		placeholder = 'Type to add...',
		noResultsLabel = 'No matches found.',
		chipTone = 'accent',
		class: className,
		onSave
	}: Props = $props();

	let open = $state(false);
	let query = $state('');
	let draftSelectedIds = $state<string[]>([]);
	let activeIndex = $state(-1);
	let pendingSave = $state(false);
	let saveError = $state(false);
	let optimisticSelectedIds: string[] | null = $state(null);
	let inputEl: HTMLInputElement | null = $state(null);

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

	const normalizeId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-');

	const getOption = (optionId: string) => options.find((option) => option.id === optionId);

	let safeId = $derived(normalizeId(id));
	let listboxId = $derived(`multi-select-listbox-${safeId}`);
	let canSave = $derived(editable && Boolean(onSave));
	let canInteract = $derived(canSave && !disabled);
	let committedSelectedIds = $derived(normalizeIds(optimisticSelectedIds ?? selectedIds));
	let displaySelectedIds = $derived(open ? normalizeIds(draftSelectedIds) : committedSelectedIds);
	let selectedOptions = $derived(
		displaySelectedIds
			.map((selectedId) => getOption(selectedId) ?? { id: selectedId, label: selectedId })
			.filter((value, index, values) => values.findIndex((entry) => entry.id === value.id) === index)
	);
	// Keep the input out of flow when closed so chips don't reserve an empty row.
	let showInlineInput = $derived(open || query.length > 0 || selectedOptions.length === 0);
	let filteredOptions = $derived.by(() => {
		const selectedSet = new Set(normalizeIds(draftSelectedIds));
		const normalizedQuery = query.trim().toLowerCase();
		return options.filter((option) => {
			if (selectedSet.has(option.id)) return false;
			if (!normalizedQuery) return true;
			return option.label.toLowerCase().includes(normalizedQuery);
		});
	});
	let normalizedActiveIndex = $derived.by(() => {
		if (filteredOptions.length === 0) return -1;
		if (activeIndex < 0) return -1;
		if (activeIndex >= filteredOptions.length) return filteredOptions.length - 1;
		return activeIndex;
	});
	let activeOptionId = $derived(
		normalizedActiveIndex >= 0 && normalizedActiveIndex < filteredOptions.length
			? `${listboxId}-option-${normalizedActiveIndex}`
			: undefined
	);

	const focusInputAtEnd = () => {
		if (!inputEl) return;
		inputEl.focus();
		requestAnimationFrame(() => {
			if (!inputEl) return;
			const end = inputEl.value.length;
			inputEl.setSelectionRange(end, end);
		});
	};

	const openPicker = () => {
		if (!canInteract) return;
		if (!open) {
			draftSelectedIds = [...committedSelectedIds];
			query = '';
			saveError = false;
		}
		open = true;
		activeIndex = -1;
	};

	const persistSelection = async (nextIds: string[]) => {
		if (!onSave) return;
		const normalizedNextIds = normalizeIds(nextIds);
		const currentIds = normalizeIds(optimisticSelectedIds ?? selectedIds);
		if (idsMatch(normalizedNextIds, currentIds)) return;
		// Keep selected chips stable immediately after blur while backend state catches up.
		optimisticSelectedIds = normalizedNextIds;
		pendingSave = true;
		saveError = false;
		try {
			await onSave(normalizedNextIds);
		} catch {
			saveError = true;
			optimisticSelectedIds = null;
		} finally {
			pendingSave = false;
		}
	};

	const persistDraft = async () => {
		if (!canSave) return;
		await persistSelection(draftSelectedIds);
	};

	const closePicker = () => {
		if (!open) return;
		open = false;
		query = '';
		activeIndex = -1;
		void persistDraft();
	};

	const toggleSelectedId = (selectedId: string) => {
		if (!open) return;
		if (draftSelectedIds.includes(selectedId)) {
			draftSelectedIds = draftSelectedIds.filter((id) => id !== selectedId);
		} else {
			draftSelectedIds = normalizeIds([...draftSelectedIds, selectedId]);
		}
		activeIndex = -1;
	};

	const handleRootFocusOut = (event: FocusEvent) => {
		const currentTarget = event.currentTarget as HTMLElement;
		requestAnimationFrame(() => {
			// Delay close until the next frame so intra-control focus moves don't trigger save/close.
			const activeElement = document.activeElement;
			if (activeElement && currentTarget.contains(activeElement)) return;
			closePicker();
		});
	};

	const handleRootPointerDown = (event: PointerEvent) => {
		if (!canInteract) return;
		const target = event.target as HTMLElement;
		if (target.closest('[data-chip-remove="true"]')) return;
		event.preventDefault();
		openPicker();
		focusInputAtEnd();
	};

	const handleInputKeydown = (event: KeyboardEvent) => {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (!open) openPicker();
			if (filteredOptions.length === 0) return;
			activeIndex =
				normalizedActiveIndex < 0 || normalizedActiveIndex >= filteredOptions.length - 1
					? 0
					: normalizedActiveIndex + 1;
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (!open) openPicker();
			if (filteredOptions.length === 0) return;
			activeIndex =
				normalizedActiveIndex <= 0
					? filteredOptions.length - 1
					: normalizedActiveIndex - 1;
			return;
		}
		if (event.key === 'Enter') {
			if (!open) return;
			event.preventDefault();
			if (normalizedActiveIndex >= 0 && normalizedActiveIndex < filteredOptions.length) {
				toggleSelectedId(filteredOptions[normalizedActiveIndex].id);
				focusInputAtEnd();
			}
			return;
		}
		if (event.key === ' ' || event.key === 'Spacebar') {
			if (!open) return;
			if (normalizedActiveIndex < 0 || normalizedActiveIndex >= filteredOptions.length) return;
			event.preventDefault();
			toggleSelectedId(filteredOptions[normalizedActiveIndex].id);
			focusInputAtEnd();
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			closePicker();
			(event.currentTarget as HTMLInputElement | null)?.blur();
			return;
		}
		if (event.key === 'Backspace' && query.length === 0 && draftSelectedIds.length > 0 && open) {
			draftSelectedIds = draftSelectedIds.slice(0, -1);
		}
	};

	const handleRemoveChip = async (selectedId: string) => {
		if (!canSave || disabled) return;
		if (open) {
			draftSelectedIds = draftSelectedIds.filter((id) => id !== selectedId);
			activeIndex = -1;
			focusInputAtEnd();
			return;
		}
		await persistSelection(committedSelectedIds.filter((id) => id !== selectedId));
	};

	$effect(() => {
		if (optimisticSelectedIds === null) return;
		if (idsMatch(selectedIds, optimisticSelectedIds)) {
			optimisticSelectedIds = null;
		}
	});

</script>

<div
	onfocusout={handleRootFocusOut}
	class={cn('relative min-w-56', className)}
>
	<div
		role="group"
		aria-label={ariaLabel}
		aria-busy={pendingSave}
		onpointerdown={handleRootPointerDown}
		class={cn(
			'relative flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-0.5',
			'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
			canInteract && 'cursor-pointer',
			disabled && 'opacity-60'
		)}
	>
		{#if selectedOptions.length === 0 && !editable}
			<p class="text-xs text-muted-foreground">{emptyLabel}</p>
		{:else}
			{#each selectedOptions as option (option.id)}
				<TagChip
					label={option.label}
					tone={chipTone}
					removable={canInteract}
					disabled={disabled}
					onRemove={() => void handleRemoveChip(option.id)}
				/>
			{/each}
		{/if}
		{#if canSave}
			<Input
				bind:ref={inputEl}
				type="text"
				value={query}
				disabled={disabled || pendingSave}
				placeholder={selectedOptions.length === 0 ? placeholder : ''}
				class={cn(
					'cursor-text border-0 bg-transparent px-0 py-0 text-base leading-6 font-medium shadow-none focus-visible:ring-0',
					showInlineInput
						? 'relative h-7 min-w-36 basis-full flex-1 opacity-100'
						: 'pointer-events-none absolute left-0 top-0 h-0 w-0 basis-0 min-w-0 overflow-hidden opacity-0'
				)}
				role="combobox"
				aria-invalid={saveError}
				aria-label={ariaLabel}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={listboxId}
				aria-activedescendant={activeOptionId}
				aria-autocomplete="list"
				onfocus={() => {
					openPicker();
				}}
				oninput={(event) => {
					query = (event.currentTarget as HTMLInputElement).value;
					activeIndex = -1;
				}}
				onkeydown={handleInputKeydown}
			/>
		{/if}
	</div>

	{#if open && canSave}
		<div class="absolute z-50 mt-1 max-h-64 w-full overflow-hidden rounded-md border bg-popover p-1 shadow-md">
			<div
				id={listboxId}
				role="listbox"
				aria-label={`${ariaLabel} options`}
				aria-multiselectable="true"
				class="max-h-60 overflow-y-auto"
			>
				{#if filteredOptions.length === 0}
					<p class="px-2 py-2 type-body-medium text-muted-foreground">{noResultsLabel}</p>
				{:else}
					{#each filteredOptions as option, index (option.id)}
						<button
							type="button"
							role="option"
							id={`${listboxId}-option-${index}`}
							aria-selected={false}
							class={cn(
								'flex w-full cursor-pointer items-center rounded-sm px-2 py-1 text-left text-base leading-6',
								index === normalizedActiveIndex
									? 'bg-accent text-accent-foreground'
									: 'hover:bg-accent/60'
							)}
							onmousedown={(event) => {
								event.preventDefault();
							}}
							onmousemove={() => {
								activeIndex = index;
							}}
							onclick={() => {
								toggleSelectedId(option.id);
								focusInputAtEnd();
							}}
						>
							{option.label}
						</button>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>

{#if saveError}
	<p class="text-xs text-destructive">Save failed. Try again.</p>
{/if}
