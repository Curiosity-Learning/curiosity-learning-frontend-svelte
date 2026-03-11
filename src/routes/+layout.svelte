<script lang="ts">
	import { onMount } from 'svelte';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import LauncherScreen from '$lib/components/app/LauncherScreen.svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import { createSvelteAuthClient } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth-client';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	createSvelteAuthClient({
		authClient,
		getServerState: () => data.authState
	});

	let showLauncher = $state(true);

	onMount(() => {
		const timer = setTimeout(() => {
			showLauncher = false;
		}, 1200);

		return () => clearTimeout(timer);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Curiosity Learning</title>
</svelte:head>

{#if showLauncher}
	<LauncherScreen />
{:else}
	{@render children()}
{/if}
<Toaster richColors={true} closeButton={true} />
