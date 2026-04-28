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
		emptyMessage?: string;
		maxMenuHeightClass?: string;
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
		emptyMessage = 'No options found.',
		maxMenuHeightClass = 'max-h-56'
	}: Props = $props();

	let root = $state<HTMLDivElement | null>(null);
	let menu = $state<HTMLDivElement | null>(null);
	let isOpen = $state(false);
	let dropdownSide = $state<'top' | 'bottom'>('bottom');
	let menuMaxHeightPx = $state<number | null>(null);

	const MENU_GAP_PX = 8;
	const VIEWPORT_PADDING_PX = 12;

	const normalize = (input: string) => input.trim().toLowerCase();

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

	let hasDropdownContent = $derived(loading || renderedOptions.length > 0 || Boolean(emptyMessage));
	let displayedValue = $derived(searchable ? value : (selectedOption?.label ?? ''));

	const openDropdown = () => {
		if (!hasDropdownContent) return;
		isOpen = true;
	};

	const closeDropdown = () => {
		isOpen = false;
		dropdownSide = 'bottom';
		menuMaxHeightPx = null;
		if (allowCustomValue || searchable) return;
		if (selectedOption) return;
		value = '';
	};

	const selectOption = (option: DropdownOption) => {
		value = option.value;
		isOpen = false;
	};

	const handleInput = (event: Event) => {
		if (!searchable) return;
		value = (event.currentTarget as HTMLInputElement).value;
		openDropdown();
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
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
		/>

		{#if loading}
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
				{#if loading}
					<LoadingState variant="inline" size="sm" label="Loading options" />
				{:else if renderedOptions.length > 0}
					<ul
						class={cn('overflow-y-auto py-1', maxMenuHeightClass)}
						style:max-height={menuMaxHeightPx ? `${menuMaxHeightPx}px` : undefined}
					>
						{#each renderedOptions as option (option.value)}
							<li>
								<button
									type="button"
									class={cn(
										'w-full px-3 py-2 text-left text-sm leading-6 transition-colors',
										selectedOption?.value === option.value
											? 'bg-orange-50 text-gray-900'
											: 'text-gray-700 hover:bg-orange-50 hover:text-gray-900'
									)}
									onmousedown={(event) => event.preventDefault()}
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
