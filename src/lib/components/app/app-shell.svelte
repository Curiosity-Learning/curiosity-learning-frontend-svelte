<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import SearchIcon from '@lucide/svelte/icons/search';
	import favicon from '$lib/assets/svg/favicon.svg';
	import type { Attachment } from 'svelte/attachments';
	import type { HeaderBackConfig, HeaderSearchConfig, HeaderSearchMode } from '$lib/app/page-header';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { cn } from '$lib/utils.js';
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
	import { Separator } from '$lib/components/ui/separator';
	import ConnectivityOverlay from './connectivity-overlay.svelte';
	import AppNavItem from './app-nav-item.svelte';
	import type { AppNavItem as AppNavItemType, AppNavKey } from './navigation';

	type Props = {
		title: string;
		activeNav: AppNavKey;
		activePath: string;
		navigation: AppNavItemType[];
		headerBack?: HeaderBackConfig;
		headerTitleContent?: import('svelte').Snippet;
		headerActions?: import('svelte').Snippet;
		headerSearch?: HeaderSearchConfig;
		banner?: import('svelte').Snippet;
		children: import('svelte').Snippet;
	};

	let {
		title,
		activeNav,
		activePath,
		navigation,
		headerBack,
		headerTitleContent,
		headerActions,
		headerSearch,
		banner,
		children
	}: Props = $props();

	const topNavItems = $derived(navigation.filter((n) => (n.placement ?? 'top') === 'top'));
	const bottomNavItems = $derived(navigation.filter((n) => (n.placement ?? 'top') === 'bottom'));
	// Auto mode chooses the most stable layout for current header width.
	const SEARCH_INLINE_MIN_WIDTH = 920;
	const SEARCH_COLLAPSIBLE_MIN_WIDTH = 680;
	const HISTORY_INDEX_KEY = 'sveltekit:history';

	let clubOpen = $state(false);
	let clubNavOpen = $derived(clubOpen);
	let headerRowWidth = $state(0);
	let searchInputRef = $state<HTMLInputElement | null>(null);
	let collapsibleSearchContainerRef = $state<HTMLDivElement | null>(null);
	let searchFieldOpen = $state(false);
	let initialHistoryIndex = $state<number | null>(null);
	let headerSearchValue = $derived(headerSearch?.value ?? '');
	let headerSearchPlaceholder = $derived(headerSearch?.placeholder ?? 'Search');
	let headerSearchAriaLabel = $derived(headerSearch?.ariaLabel ?? 'Search');
	let searchHasValue = $derived(Boolean(headerSearchValue.trim()));
	let requestedSearchMode = $derived(headerSearch?.mode ?? 'auto');
	let resolvedSearchMode: HeaderSearchMode | null = $derived.by(() => {
		if (!headerSearch) return null;
		if (requestedSearchMode !== 'auto') return requestedSearchMode;
		if (headerRowWidth >= SEARCH_INLINE_MIN_WIDTH) return 'inline';
		if (headerRowWidth >= SEARCH_COLLAPSIBLE_MIN_WIDTH) return 'collapsible';
		return 'overlay';
	});
	let showCollapsibleSearchField = $derived(
		resolvedSearchMode === 'collapsible' && (searchFieldOpen || searchHasValue)
	);
	let showOverlaySearchField = $derived(
		resolvedSearchMode === 'overlay' && (searchFieldOpen || searchHasValue)
	);

	const getHistoryIndex = () => {
		if (!browser) return null;
		const value = window.history.state?.[HISTORY_INDEX_KEY];
		return typeof value === 'number' ? value : null;
	};

	if (browser) {
		initialHistoryIndex = getHistoryIndex();
	}

	const isActivePath = (href: string) => activePath === href || activePath.startsWith(`${href}/`);

	const canUseHistoryBack = () => {
		if (!browser) return false;
		if (window.history.length <= 1) return false;
		const currentHistoryIndex = getHistoryIndex();
		if (initialHistoryIndex !== null && currentHistoryIndex !== null) {
			return currentHistoryIndex > initialHistoryIndex;
		}
		return true;
	};

	const handleBack = async () => {
		if (!headerBack) return;
		if (canUseHistoryBack()) {
			window.history.back();
			return;
		}
		if (headerBack.fallbackHref) {
			await goto(headerBack.fallbackHref);
		}
	};

	const focusSearchInput = () => {
		if (!browser) return;
		requestAnimationFrame(() => {
			searchInputRef?.focus();
		});
	};

	const handleSearchInput = (event: Event) => {
		if (!headerSearch) return;
		const target = event.currentTarget;
		if (!(target instanceof HTMLInputElement)) return;
		headerSearch.onValueChange(target.value);
	};

	const openSearchField = () => {
		searchFieldOpen = true;
		focusSearchInput();
	};

	const handleSearchIconClick = () => {
		if (!headerSearch || resolvedSearchMode === 'inline') return;
		if (!searchFieldOpen) {
			openSearchField();
			return;
		}
		focusSearchInput();
	};

	const handleCollapsibleSearchFocusOut = (event: FocusEvent) => {
		if (!headerSearch || !showCollapsibleSearchField) return;
		const nextTarget = event.relatedTarget;
		if (nextTarget instanceof Node && collapsibleSearchContainerRef?.contains(nextTarget)) return;
		if (!headerSearchValue.trim()) {
			searchFieldOpen = false;
		}
	};

	const handleOverlaySearchBlur = (event: FocusEvent) => {
		if (!headerSearch || resolvedSearchMode !== 'overlay') return;
		const nextTarget = event.relatedTarget;
		if (
			nextTarget instanceof HTMLElement &&
			nextTarget.dataset.headerSearchToggle === 'true'
		) {
			return;
		}
		if (!headerSearchValue.trim()) {
			searchFieldOpen = false;
		}
	};

	const setCollapsibleSearchContainerRef: Attachment<HTMLDivElement> = (node) => {
		collapsibleSearchContainerRef = node;
		return () => {
			if (collapsibleSearchContainerRef === node) {
				collapsibleSearchContainerRef = null;
			}
		};
	};

</script>

<!-- --bottom-nav-h: height of the fixed mobile bottom nav. Used here for content
     clearance (pb) and by child components for sticky element offsets. On desktop
     (lg:) the sidebar replaces the bottom nav so the padding is removed. -->
<div class="relative flex min-h-screen flex-col bg-white pb-[var(--bottom-nav-h)] lg:pb-0" style="--bottom-nav-h: 4.5rem;">
	<ConnectivityOverlay />
	<div class="flex min-h-screen flex-1 flex-col lg:flex-row">
		<aside
			class="hidden w-60 flex-col border-r border-border bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:self-start"
		>
			<div class="border-b border-border px-5 py-6">
				<div class="flex items-center gap-3">
					<img src={favicon} alt="Curiosity Learning" class="h-10 w-10 shrink-0" />
					<div class="leading-tight">
						<p class="text-[1.05rem] font-bold text-foreground">Curiosity</p>
						<p class="text-[1.05rem] font-bold text-foreground">Learning</p>
					</div>
				</div>
			</div>

			<div class="flex flex-1 flex-col gap-3 px-0 py-3">
				<nav class="flex flex-col gap-1">
					{#each topNavItems as nav (nav.key)}
						{#if nav.children?.length}
							<Collapsible open={clubNavOpen} onOpenChange={(open) => (clubOpen = open)}>
								<div
									class={cn(
										'relative flex w-full items-center gap-1 overflow-hidden rounded-none',
										activeNav === nav.key
											? 'bg-orange-50 text-orange-500'
											: 'text-muted-foreground hover:bg-gray-50 hover:text-foreground'
									)}
								>
									{#if activeNav === nav.key}
										<span class="bg-orange-500 absolute inset-y-0 left-0 w-0.5 rounded-r-full" aria-hidden="true"></span>
									{/if}
									<a
										href={nav.href}
										class="flex flex-1 items-center gap-3 px-5 py-2 text-left type-lead-medium"
										data-sveltekit-preload-code="hover"
										data-sveltekit-preload-data="hover"
									>
										<nav.icon class="size-4 shrink-0" />
										<span>{nav.label}</span>
									</a>
									<CollapsibleTrigger
										class="flex size-9 items-center justify-center rounded-md hover:bg-gray-100"
										aria-label={clubNavOpen ? `Collapse ${nav.label}` : `Expand ${nav.label}`}
									>
										<ChevronDownIcon
											class={cn('size-4 transition-transform', clubNavOpen ? 'rotate-180' : '')}
										/>
									</CollapsibleTrigger>
								</div>

								<CollapsibleContent class="flex flex-col gap-1 pt-1">
									{#each nav.children as child (child.key)}
										<AppNavItem
											nav="side-sub"
											href={child.href}
											label={child.label}
											active={isActivePath(child.href)}
										/>
									{/each}
								</CollapsibleContent>
							</Collapsible>
						{:else}
							<AppNavItem
								nav="side"
								href={nav.href}
								label={nav.label}
								active={activeNav === nav.key}
								Icon={nav.icon}
							/>
						{/if}
					{/each}
				</nav>

				<div class="flex flex-1"></div>

				<nav class="flex flex-col gap-1">
					{#each bottomNavItems as nav (nav.key)}
						<AppNavItem
							nav="side"
							href={nav.href}
							label={nav.label}
							active={activeNav === nav.key}
							Icon={nav.icon}
						/>
						{/each}
					</nav>
				</div>
		</aside>

			<div class="flex min-h-screen min-w-0 flex-1 flex-col bg-white">
				<header
					class="sticky top-0 z-20 flex justify-center border-b border-border bg-white"
				>
				<div
					class={cn(
						'flex w-full max-w-6xl flex-col gap-3 px-4 sm:px-6 lg:px-8',
						banner ? 'pt-4 pb-0' : 'py-4'
					)}
				>
					<div class="relative flex flex-wrap items-center justify-between gap-3" bind:clientWidth={headerRowWidth}>
						<div class="relative flex min-w-0 flex-1 items-center gap-2">
							{#if headerBack}
								<Button
									variant="ghost"
									size="icon-sm"
									class="shrink-0"
									aria-label={headerBack.ariaLabel ?? 'Go back'}
									onclick={() => void handleBack()}
								>
									<ArrowLeftIcon class="size-5" />
								</Button>
							{/if}
								{#if headerTitleContent}
									<div
										class={cn(
											'min-w-0 flex-1 transition-opacity duration-200',
											showOverlaySearchField ? 'opacity-0' : 'opacity-100'
										)}
									>
										{@render headerTitleContent()}
									</div>
								{:else}
									<h1
										class={cn(
											'min-w-0 truncate text-[1.25rem] leading-6 font-bold transition-opacity duration-200 sm:text-[1.5rem] sm:leading-8',
											showOverlaySearchField ? 'opacity-0' : 'opacity-100'
										)}
									>
										{title}
									</h1>
								{/if}

							{#if showOverlaySearchField}
								<div class="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center">
									<div
										class={cn('pointer-events-auto min-w-0 flex-1', headerBack ? 'pl-10' : undefined)}
									>
										<Input
											bind:ref={searchInputRef}
											value={headerSearchValue}
											placeholder={headerSearchPlaceholder}
											aria-label={headerSearchAriaLabel}
											class="h-9"
											onblur={handleOverlaySearchBlur}
											oninput={handleSearchInput}
										/>
									</div>
								</div>
							{/if}
						</div>
						{#if headerActions || headerSearch}
							<div class="flex min-w-0 flex-wrap items-center justify-end gap-2">
								{#if headerSearch}
									{#if resolvedSearchMode === 'inline'}
										<div class="w-[min(22rem,45vw)] min-w-[13rem] max-w-full">
											<Input
												bind:ref={searchInputRef}
												value={headerSearchValue}
												placeholder={headerSearchPlaceholder}
												aria-label={headerSearchAriaLabel}
												class="h-9"
												oninput={handleSearchInput}
											/>
										</div>
									{:else if resolvedSearchMode === 'collapsible'}
										<div
											{@attach setCollapsibleSearchContainerRef}
											class="flex min-w-0 items-center gap-1"
											onfocusout={handleCollapsibleSearchFocusOut}
										>
											<div
												class={cn(
													// Padding gives the default input focus ring room;
													// matching negative margin keeps surrounding layout alignment unchanged.
													'overflow-x-hidden overflow-y-visible transition-[width,opacity,padding,margin] duration-200 ease-out',
													showCollapsibleSearchField
														? 'w-[min(20rem,42vw)] -m-2 px-2 py-2 opacity-100'
														: 'w-0 m-0 px-0 py-0 opacity-0'
												)}
											>
												<Input
													bind:ref={searchInputRef}
													value={headerSearchValue}
													placeholder={headerSearchPlaceholder}
													aria-label={headerSearchAriaLabel}
													class="h-9"
													oninput={handleSearchInput}
												/>
											</div>
											<Button
												variant="ghost"
												size="icon"
												aria-label={headerSearchAriaLabel}
												data-header-search-toggle="true"
												onclick={handleSearchIconClick}
											>
												<SearchIcon class="size-5 text-muted-foreground" />
											</Button>
										</div>
									{:else if resolvedSearchMode === 'overlay'}
										<Button
											variant="ghost"
											size="icon"
											aria-label={headerSearchAriaLabel}
											data-header-search-toggle="true"
											onclick={handleSearchIconClick}
										>
											<SearchIcon class="size-5 text-muted-foreground" />
										</Button>
									{/if}
								{/if}
								{#if headerActions}
									{@render headerActions()}
								{/if}
							</div>
						{/if}
					</div>
					{#if banner}
						{@render banner()}
					{/if}
				</div>
			</header>

				<main class="flex w-full flex-1 justify-center bg-white">
					<div class="flex w-full max-w-6xl flex-1 flex-col gap-4 bg-white px-4 py-4 sm:px-6 lg:px-8">
						{@render children()}
					</div>
				</main>

				<footer
					class="fixed inset-x-0 bottom-0 z-10 flex justify-center border-t border-border bg-white lg:hidden"
				>
				<div class="flex w-full max-w-6xl flex-col gap-2 px-2 py-2 sm:px-6 lg:px-8">
					<nav class="grid w-full grid-cols-4 gap-1">
						{#each topNavItems.concat(bottomNavItems) as nav (nav.key)}
							<AppNavItem
								nav="bottom"
								href={nav.href}
								label={nav.label}
								active={activeNav === nav.key}
								Icon={nav.icon}
							/>
						{/each}
					</nav>
					<Separator class="hidden sm:block" />
				</div>
			</footer>
		</div>
	</div>
</div>
