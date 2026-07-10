<script lang="ts">
	import { page } from '$app/state';
	import { routes } from '$lib/routes';
	import { t } from '$lib/i18n';
	import { cn } from '$lib/utils.js';

	let { children } = $props();

	// CL-693: intentionally plain/utilitarian shell, visually distinct from the member app —
	// no bottom nav, no club switcher, no member styling. Nav links are placeholders for
	// CL-730 (moderation), CL-701 (seasons/booklet), CL-732 (users/full dashboard).
	const navItems = [
		{ href: routes.admin, label: t('admin.navOverview') },
		{ href: routes.adminModeration, label: t('admin.navModeration') },
		{ href: routes.adminSeasonsBooklet, label: t('admin.navSeasonsBooklet') },
		{ href: routes.adminUsers, label: t('admin.navUsers') }
	];

	const isActive = (href: string) =>
		href === routes.admin ? page.url.pathname === href : page.url.pathname.startsWith(href);
</script>

<div class="min-h-screen bg-neutral-100 text-neutral-900">
	<header class="border-b border-neutral-300 bg-white">
		<div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
			<p class="text-lg font-semibold">{t('admin.shellTitle')}</p>
			<nav class="flex gap-1">
				{#each navItems as item (item.href)}
					<a
						href={item.href}
						class={cn(
							'rounded px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
							isActive(item.href) && 'bg-neutral-200 text-neutral-900'
						)}
					>
						{item.label}
					</a>
				{/each}
			</nav>
		</div>
	</header>

	<main class="mx-auto max-w-5xl px-4 py-6">
		{@render children()}
	</main>
</div>
