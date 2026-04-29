<script lang="ts">
	import { browser } from '$app/environment';
	import { onDestroy, tick } from 'svelte';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import LoadingState from '$lib/components/app/loading-state.svelte';
	import { Field, FieldDescription, FieldLabel } from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { cn } from '$lib/utils';
	import type { HTMLInputAttributes } from 'svelte/elements';

	export type DropdownOption = {
		label: string;
		value: string;
		disabled?: boolean;
	};

	type Props = {
		id: string;
		value?: string;
		options: DropdownOption[];
		placeholder?: string;
		label?: string;
		required?: boolean;
		hint?: string;
		class?: string;
		labelClass?: string;
		hintClass?: string;
		inputClass?: string;
		autocomplete?: HTMLInputAttributes['autocomplete'];
		searchable?: boolean;
		allowCustomValue?: boolean;
		filterOptions?: boolean;
		loading?: boolean;
		showInputLoading?: boolean;
		showLoadingMenu?: boolean;
		emptyMessage?: string;
		maxMenuHeightClass?: string;
		onSelectOption?: (option: DropdownOption) => void;
	};

	let {
		id,
		value = $bindable(''),
		options,
		placeholder = 'Select an option',
		label,
		required = false,
		hint,
		class: className,
		labelClass,
		hintClass,
		inputClass,
		autocomplete = 'off',
		searchable = true,
		allowCustomValue = true,
		filterOptions = true,
		loading = false,
		showInputLoading = true,
		showLoadingMenu = true,
		emptyMessage = 'No options found.',
		maxMenuHeightClass = 'max-h-56',
		onSelectOption
	}: Props = $props();

	let root = $state<HTMLDivElement | null>(null);
	let menu = $state<HTMLDivElement | null>(null);
	let isOpen = $state(false);
	let dropdownSide = $state<'top' | 'bottom'>('bottom');
	let menuMaxHeightPx = $state<number | null>(null);
	let activeIndex = $state(-1);

	const MENU_GAP_PX = 8;
	const VIEWPORT_PADDING_PX = 12;

	const normalize = (input: string) => input.trim().toLowerCase();
	const safeId = $derived(id.replace(/[^a-zA-Z0-9_-]/g, '-'));
	const listboxId = $derived(`${safeId}-listbox`);

	let selectedOption = $derived(
		options.find(
			(option) =>
				normalize(option.value) === normalize(value) || normalize(option.label) === normalize(value)
		) ?? null
	);

	let renderedOptions = $derived.by(() => {
		const enabledOptions = options.filter((option) => !option.disabled);
		if (!searchable || !filterOptions) return enabledOptions;
		const query = normalize(value);
		if (!query) return enabledOptions;
		return enabledOptions.filter(
			(option) => normalize(option.label).includes(query) || normalize(option.value).includes(query)
		);
	});

	let hasDropdownContent = $derived(
		(loading && showLoadingMenu) || renderedOptions.length > 0 || Boolean(emptyMessage)
	);
	let displayedValue = $derived(searchable ? value : (selectedOption?.label ?? ''));
	let normalizedActiveIndex = $derived.by(() => {
		if (renderedOptions.length === 0) return -1;
		if (activeIndex < 0) return -1;
		if (activeIndex >= renderedOptions.length) return renderedOptions.length - 1;
		return activeIndex;
	});
	let activeOptionId = $derived(
		normalizedActiveIndex >= 0 && normalizedActiveIndex < renderedOptions.length
			? `${listboxId}-option-${normalizedActiveIndex}`
			: undefined
	);

	const getSelectedOptionIndex = () => {
		if (!selectedOption) return -1;
		return renderedOptions.findIndex((option) => option.value === selectedOption?.value);
	};

	const getInitialActiveIndex = () => {
		if (renderedOptions.length === 0) return -1;
		const selectedIndex = getSelectedOptionIndex();
		return selectedIndex >= 0 ? selectedIndex : 0;
	};

	const openDropdown = () => {
		if (!hasDropdownContent) return;
		isOpen = true;
		if (activeIndex < 0) {
			activeIndex = getInitialActiveIndex();
		}
	};

	const closeDropdown = () => {
		isOpen = false;
		dropdownSide = 'bottom';
		menuMaxHeightPx = null;
		activeIndex = -1;
		if (allowCustomValue || searchable) return;
		if (selectedOption) return;
		value = '';
	};

	const selectOption = (option: DropdownOption) => {
		value = option.value;
		isOpen = false;
		onSelectOption?.(option);
	};

	const handleInput = (event: Event) => {
		if (!searchable) return;
		value = (event.currentTarget as HTMLInputElement).value;
		activeIndex = 0;
		openDropdown();
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (!isOpen) openDropdown();
			if (renderedOptions.length === 0) return;
			activeIndex =
				normalizedActiveIndex < 0 || normalizedActiveIndex >= renderedOptions.length - 1
					? 0
					: normalizedActiveIndex + 1;
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (!isOpen) openDropdown();
			if (renderedOptions.length === 0) return;
			activeIndex =
				normalizedActiveIndex <= 0
					? renderedOptions.length - 1
					: normalizedActiveIndex - 1;
			return;
		}
		if (event.key === 'Enter') {
			if (!isOpen && renderedOptions.length === 0) return;
			event.preventDefault();
			if (!isOpen) {
				openDropdown();
			}
			const indexToSelect = normalizedActiveIndex >= 0 ? normalizedActiveIndex : 0;
			const option = renderedOptions[indexToSelect];
			if (option) {
				selectOption(option);
			}
			return;
		}
		if ((event.key === ' ' || event.key === 'Spacebar') && !searchable) {
			event.preventDefault();
			if (!isOpen) {
				openDropdown();
				return;
			}
			const indexToSelect = normalizedActiveIndex >= 0 ? normalizedActiveIndex : 0;
			const option = renderedOptions[indexToSelect];
			if (option) {
				selectOption(option);
			}
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			closeDropdown();
		}
	};

	const updateDropdownPosition = () => {
		if (!browser || !root || !isOpen) return;

		const rect = root.getBoundingClientRect();
		const availableBelow = Math.max(
			window.innerHeight - rect.bottom - MENU_GAP_PX - VIEWPORT_PADDING_PX,
			0
		);
		const availableAbove = Math.max(rect.top - MENU_GAP_PX - VIEWPORT_PADDING_PX, 0);
		const preferredMenuHeight =
			menu?.scrollHeight ?? menu?.getBoundingClientRect().height ?? 0;
		const shouldOpenTop =
			availableBelow < preferredMenuHeight && availableAbove > availableBelow;

		dropdownSide = shouldOpenTop ? 'top' : 'bottom';
		menuMaxHeightPx = Math.floor(shouldOpenTop ? availableAbove : availableBelow) || null;
	};

	onDestroy(() => {
		isOpen = false;
	});

	$effect(() => {
		if (!browser) return;
		const handleDocumentPointerDown = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (root?.contains(target)) return;
			closeDropdown();
		};
		document.addEventListener('mousedown', handleDocumentPointerDown);
		return () => {
			document.removeEventListener('mousedown', handleDocumentPointerDown);
		};
	});

	$effect(() => {
		if (!browser || !isOpen) return;

		void renderedOptions.length;
		void loading;
		void value;

		const handleViewportChange = () => {
			updateDropdownPosition();
		};

		void tick().then(() => {
			updateDropdownPosition();
		});

		window.addEventListener('resize', handleViewportChange);
		window.addEventListener('scroll', handleViewportChange, true);
		window.visualViewport?.addEventListener('resize', handleViewportChange);

		return () => {
			window.removeEventListener('resize', handleViewportChange);
			window.removeEventListener('scroll', handleViewportChange, true);
			window.visualViewport?.removeEventListener('resize', handleViewportChange);
		};
	});

	$effect(() => {
		if (!isOpen) {
			activeIndex = -1;
			return;
		}
		if (renderedOptions.length === 0) {
			activeIndex = -1;
			return;
		}
		if (activeIndex < 0 || activeIndex >= renderedOptions.length) {
			activeIndex = getInitialActiveIndex();
		}
	});

	$effect(() => {
		if (!browser || !isOpen || !activeOptionId) return;
		document.getElementById(activeOptionId)?.scrollIntoView({
			block: 'nearest'
		});
	});
</script>

<Field class={cn('flex flex-col gap-2', className)}>
	{#if label}
		<FieldLabel for={id} required={required} class={cn('type-field-label text-base leading-6 font-bold text-gray-900', labelClass)}>
			{label}
		</FieldLabel>
	{/if}

	{#if hint}
		<FieldDescription class={cn('type-body text-sm leading-6 font-normal text-gray-600', hintClass)}>
			{hint}
		</FieldDescription>
	{/if}

	<div class="relative" bind:this={root}>
		<Input
			{id}
			value={displayedValue}
			{autocomplete}
			{placeholder}
			readonly={!searchable}
			class={cn(
				'h-12 rounded-md border-gray-300 px-4 pr-11 text-base',
				searchable ? '' : 'cursor-pointer',
				inputClass
			)}
			oninput={handleInput}
			onfocus={openDropdown}
			onclick={openDropdown}
			onkeydown={handleKeydown}
			role="combobox"
			aria-autocomplete={searchable ? 'list' : 'none'}
			aria-expanded={isOpen}
			aria-controls={listboxId}
			aria-activedescendant={activeOptionId}
		/>

		{#if loading && showInputLoading}
			<LoaderCircleIcon
				class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-gray-400"
			/>
		{:else}
			<ChevronDownIcon
				class={cn(
					'pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-gray-500 transition-transform duration-200',
					isOpen ? 'rotate-180' : ''
				)}
			/>
		{/if}

		{#if isOpen && hasDropdownContent}
			<div
				bind:this={menu}
				class={cn(
					'absolute z-30 w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg',
					dropdownSide === 'top'
						? 'bottom-[calc(100%+0.5rem)]'
						: 'top-[calc(100%+0.5rem)]'
				)}
			>
				{#if loading && showLoadingMenu}
					<LoadingState variant="inline" size="sm" label="Loading options" />
				{:else if renderedOptions.length > 0}
					<ul
						id={listboxId}
						role="listbox"
						class={cn('overflow-y-auto py-1', maxMenuHeightClass)}
						style:max-height={menuMaxHeightPx ? `${menuMaxHeightPx}px` : undefined}
					>
						{#each renderedOptions as option, index (option.value)}
							<li>
								<button
									type="button"
									id={`${listboxId}-option-${index}`}
									role="option"
									tabindex="-1"
									aria-selected={index === normalizedActiveIndex}
									class={cn(
										'w-full px-3 py-2 text-left text-sm leading-6 transition-colors',
										index === normalizedActiveIndex
											? 'bg-orange-50 text-gray-900'
											: 'text-gray-700 hover:bg-orange-50 hover:text-gray-900'
									)}
									onmousedown={(event) => event.preventDefault()}
									onmousemove={() => {
										activeIndex = index;
									}}
									onclick={() => selectOption(option)}
								>
									{option.label}
								</button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="px-3 py-2 text-sm leading-6 text-gray-500">{emptyMessage}</p>
				{/if}
			</div>
		{/if}
	</div>
</Field>
