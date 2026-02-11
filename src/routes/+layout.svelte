<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { Toaster } from '$lib/components/ui/sonner';
	import { createSvelteAuthClient } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth-client';

	let { children } = $props();

	createSvelteAuthClient({
		authClient
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Curiosity Learning</title>
</svelte:head>

{@render children()}
<Toaster richColors={true} closeButton={true} />
