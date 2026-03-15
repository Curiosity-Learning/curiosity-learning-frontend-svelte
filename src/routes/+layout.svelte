<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import LauncherScreen from '$lib/components/app/LauncherScreen.svelte';
	import CookieConsentBanner from '$lib/components/app/cookie-consent-banner.svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import { _, initI18n, locale } from '$lib/i18n';
	import { createSvelteAuthClient } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth-client';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	initI18n();

	createSvelteAuthClient({
		authClient,
		getServerState: () => data.authState
	});

	let showLauncher = $state(true);
	let localeCleanup: (() => void) | null = null;

	onMount(() => {
		localeCleanup = locale.subscribe((value) => {
			if (typeof document !== 'undefined') {
				document.documentElement.lang = value || 'en';
			}
		});

		const timer = setTimeout(() => {
			showLauncher = false;
		}, 1200);

		return () => {
			clearTimeout(timer);
			localeCleanup?.();
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{$_('app.title')}</title>
</svelte:head>

<a class="skip-link" href="#main-content">{$_('a11y.skipToMainContent')}</a>

{#if showLauncher}
	<LauncherScreen />
{:else}
	<main id="main-content" tabindex="-1">
		{@render children()}
	</main>
	<CookieConsentBanner />
{/if}
<Toaster richColors={true} closeButton={true} />
