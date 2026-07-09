<script lang="ts">
	import { goto } from '$app/navigation';
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
		const href = normalizePath(tab.href);
		if (currentPath === href || currentPath.startsWith(`${href}/`)) return true;
		// Aliases are bare parent paths that default to this tab (e.g. /session/X
		// for the Activities tab). They must match exactly — prefix matching would
		// make the aliased tab swallow every sibling tab's path.
		return (tab.aliases ?? []).some((alias) => currentPath === normalizePath(alias));
	};

	let activeTabHref = $derived.by(() => {
		const currentPath = page.url.pathname;
		const active = tabs.find((tab) => matchesTab(tab, currentPath));
		return active?.href ?? tabs[0]?.href ?? '';
	});

	const handleValueChange = (value: string) => {
		if (!value) return;
		if (normalizePath(value) === normalizePath(page.url.pathname)) return;
		void goto(value, { replaceState: true, keepFocus: true, noScroll: true });
	};
</script>

<nav aria-label={ariaLabel} class="flex w-full justify-center lg:justify-start">
	<Tabs value={activeTabHref} onValueChange={handleValueChange} class="w-full">
		<TabsList class="-mb-px justify-center lg:justify-start">
			{#each tabs as tab (tab.href)}
				<TabsTrigger value={tab.href}>{tab.label}</TabsTrigger>
			{/each}
		</TabsList>
	</Tabs>
</nav>
