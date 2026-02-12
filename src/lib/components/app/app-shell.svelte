<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import logoIconAndText from '$lib/assets/Icon and Text.svg';
	import type { HeaderBackConfig } from '$lib/app/page-header';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils.js';
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
	import { Separator } from '$lib/components/ui/separator';
	import AppNavItem from './app-nav-item.svelte';
	import type { AppNavItem as AppNavItemType, AppNavKey } from './navigation';

	type Props = {
		title: string;
		activeNav: AppNavKey;
		activePath: string;
		navigation: AppNavItemType[];
		headerBack?: HeaderBackConfig;
		headerActions?: import('svelte').Snippet;
		banner?: import('svelte').Snippet;
		children: import('svelte').Snippet;
	};

	let { title, activeNav, activePath, navigation, headerBack, headerActions, banner, children }: Props =
		$props();

	const topNavItems = $derived(navigation.filter((n) => (n.placement ?? 'top') === 'top'));
	const bottomNavItems = $derived(navigation.filter((n) => (n.placement ?? 'top') === 'bottom'));

	let clubOpen = $state(false);
	let clubNavOpen = $derived(activeNav === 'club' ? true : clubOpen);

	const isActivePath = (href: string) => activePath === href || activePath.startsWith(`${href}/`);

	const canUseHistoryBack = () => {
		if (!browser) return false;
		if (window.history.length <= 1) return false;
		if (!document.referrer) return false;
		try {
			const referrer = new URL(document.referrer);
			return referrer.origin === window.location.origin;
		} catch {
			return false;
		}
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
</script>

<div class="relative flex min-h-screen flex-col pb-28 lg:pb-0">
	<div class="flex min-h-screen flex-1 flex-col lg:flex-row">
		<aside
			class="hidden w-72 flex-col border-r border-border/70 bg-background/70 backdrop-blur lg:flex lg:sticky lg:top-0 lg:h-screen lg:self-start"
		>
			<div class="px-5 py-5">
				<img src={logoIconAndText} alt="Curiosity Learning" class="h-8 w-auto" />
			</div>

			<div class="flex flex-1 flex-col gap-3 px-3 py-3">
				<nav class="flex flex-col gap-1">
					{#each topNavItems as nav (nav.key)}
						{#if nav.children?.length}
							<Collapsible open={clubNavOpen} onOpenChange={(open) => (clubOpen = open)}>
								<div
									class={cn(
										'flex w-full items-center gap-1 rounded-md',
										activeNav === nav.key
											? 'bg-primary/10 text-primary'
											: 'text-muted-foreground hover:bg-accent hover:text-foreground'
									)}
								>
									<a
										href={nav.href}
										class="flex flex-1 items-center gap-3 rounded-md px-3 py-2 text-left type-lead-medium"
										data-sveltekit-preload-code="hover"
										data-sveltekit-preload-data="hover"
									>
										<nav.icon class="size-4 shrink-0" />
										<span>{nav.label}</span>
									</a>
									<CollapsibleTrigger
										class="flex size-9 items-center justify-center rounded-md hover:bg-accent"
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

		<div class="flex min-h-screen flex-1 flex-col">
			<header
				class="sticky top-0 z-20 flex justify-center border-b border-border/70 bg-background/80 backdrop-blur"
			>
				<div
					class={cn(
						'flex w-full max-w-6xl flex-col gap-3 px-4 sm:px-6 lg:px-8',
						banner ? 'pt-4 pb-0' : 'py-4'
					)}
				>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="flex min-w-0 flex-1 items-center gap-2">
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
							<h1 class="type-h4-bold min-w-0 truncate">
								{title}
							</h1>
						</div>
						{#if headerActions}
							<div class="flex flex-wrap items-center gap-2">
								{@render headerActions()}
							</div>
						{/if}
					</div>
					{#if banner}
						{@render banner()}
					{/if}
				</div>
			</header>

			<main class="flex w-full flex-1 justify-center">
				<div class="flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
					{@render children()}
				</div>
			</main>

			<footer
				class="fixed inset-x-0 bottom-0 z-10 flex justify-center border-t border-border bg-background/95 backdrop-blur lg:hidden"
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
