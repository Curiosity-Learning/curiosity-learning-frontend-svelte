<script lang="ts">
	import { goto, preloadCode } from '$app/navigation';
	import { page } from '$app/state';
	import { Tabs, TabsList, TabsTrigger } from '$lib/components/ui/tabs';

	export type HeaderTabItem = {
		label: string;
		href: string;
		aliases?: string[];
	};

	type Props = {
		tabs: HeaderTabItem[];
		ariaLabel?: string;
	};

	let { tabs, ariaLabel = 'Section tabs' }: Props = $props();

	const normalizePath = (value: string) =>
		value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value;

	const matchesTab = (tab: HeaderTabItem, pathname: string) => {
		const currentPath = normalizePath(pathname);
		const primaryPath = normalizePath(tab.href);
		if (currentPath === primaryPath || currentPath.startsWith(`${primaryPath}/`)) {
			return true;
		}

		// Aliases are exact route mappings (for example canonical redirect roots),
		// not parent-prefix matches.
		const aliases = (tab.aliases ?? []).map(normalizePath);
		return aliases.some((alias) => currentPath === alias);
	};

	let activeTabHref = $derived.by(() => {
		const currentPath = page.url.pathname;
		const active = tabs.find((tab) => matchesTab(tab, currentPath));
		return active?.href ?? tabs[0]?.href ?? '';
	});

	$effect(() => {
		for (const tab of tabs) {
			void preloadCode(tab.href).catch(() => {
				// Best-effort preloading only.
			});
		}
	});

	const handleValueChange = (value: string) => {
		if (!value) return;
		if (normalizePath(value) === normalizePath(page.url.pathname)) return;
		void goto(value, { replaceState: true, keepFocus: true, noScroll: true }).catch((error) => {
			// Navigation can be cancelled by global offline guard; avoid unhandled rejection noise.
			if (typeof navigator !== 'undefined' && !navigator.onLine) return;
			console.error('Header tab navigation failed:', error);
		});
	};
</script>

<nav aria-label={ariaLabel} class="flex w-full justify-center lg:justify-start">
	<Tabs value={activeTabHref} onValueChange={handleValueChange}>
		<TabsList>
			{#each tabs as tab (tab.href)}
				<TabsTrigger value={tab.href}>{tab.label}</TabsTrigger>
			{/each}
		</TabsList>
	</Tabs>
</nav>
