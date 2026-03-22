<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';

	let { children } = $props();

	const auth = useAuth();
	const clubsResponse = useStableQuery(api.clubs.getMyClubs, () => (auth.isAuthenticated ? {} : 'skip'));

	let clubId = $derived((page.params as Record<string, string | undefined>).clubId ?? null);
	let clubs = $derived(clubsResponse.data ?? []);
	let isMember = $derived(clubId ? clubs.some((c) => c.clubId === clubId) : false);
	let isLoading = $derived(auth.isLoading || (auth.isAuthenticated && clubsResponse.isLoading));
</script>

{#if isLoading}
	<p class="p-4 text-sm text-muted-foreground">Loading...</p>
{:else if clubsResponse.error}
	<div class="flex flex-col items-center gap-4 p-8 text-center">
		<Alert variant="destructive" class="max-w-md">
			<AlertTitle>Unable to load club access</AlertTitle>
			<AlertDescription>Please refresh the page. If this keeps happening, sign in again.</AlertDescription>
		</Alert>
	</div>
{:else if !isMember}
	<div class="flex flex-col items-center gap-4 p-8 text-center">
		<Alert variant="destructive" class="max-w-md">
			<AlertTitle>Club not found</AlertTitle>
			<AlertDescription>This club doesn't exist or you don't have access to it.</AlertDescription>
		</Alert>
		<Button variant="outline" onclick={() => void goto('/')}>Go home</Button>
	</div>
{:else}
	{@render children()}
{/if}
