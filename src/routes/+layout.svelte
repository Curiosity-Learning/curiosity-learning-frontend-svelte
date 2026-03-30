<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '$lib/assets/svg/favicon.svg';
	import LauncherScreen from '$lib/components/app/LauncherScreen.svelte';
	import CookieConsentBanner from '$lib/components/app/cookie-consent-banner.svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import { createSvelteAuthClient } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth-client';
	import { initI18n } from '$lib/i18n';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	createSvelteAuthClient({
		authClient,
		getServerState: () => data.authState
	});

	let isAuthenticatedFromServer = $derived(Boolean(data.authState?.isAuthenticated));
	let launcherFinished = $state(false);
	let showLauncher = $derived(!isAuthenticatedFromServer && !launcherFinished);
	let localeCleanup: (() => void) | null = null;

	onMount(() => {
		localeCleanup = initI18n();

		if (isAuthenticatedFromServer) {
			launcherFinished = true;
			return () => {
				localeCleanup?.();
			};
		}

		const timer = setTimeout(() => {
			launcherFinished = true;
		}, 1200);

		return () => {
			clearTimeout(timer);
			localeCleanup?.();
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Curiosity Learning</title>
</svelte:head>

<a class="skip-link" href="#main-content">Skip to main content</a>

{#if showLauncher}
	<LauncherScreen />
{:else}
	<main id="main-content" tabindex="-1">
		{@render children()}
	</main>
	<CookieConsentBanner />
{/if}
<Toaster richColors={true} closeButton={true} />
