<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '$lib/assets/svg/favicon.svg';
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

	let localeCleanup: (() => void) | null = null;

	onMount(() => {
		localeCleanup = initI18n();

		return () => {
			localeCleanup?.();
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Curiosity Learning</title>
</svelte:head>

<a class="skip-link" href="#main-content">Skip to main content</a>

<main id="main-content" tabindex="-1">
	{@render children()}
</main>
<Toaster richColors={true} closeButton={true} />
