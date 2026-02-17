<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import { useQuery } from 'convex-svelte';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';

	let { children } = $props();

	const clubsResponse = useQuery(api.clubs.getMyClubs, {});

	let clubId = $derived((page.params as Record<string, string | undefined>).clubId ?? null);
	let clubs = $derived(clubsResponse.data ?? []);
	let isMember = $derived(clubId ? clubs.some((c) => c.clubId === clubId) : false);
	let isLoading = $derived(clubsResponse.isLoading);
</script>

{#if isLoading}
	<p class="p-4 text-sm text-muted-foreground">Loading...</p>
{:else if !isMember}
	<div class="flex flex-col items-center gap-4 p-8 text-center">
		<Alert variant="destructive" class="max-w-md">
			<AlertTitle>Club not found</AlertTitle>
			<AlertDescription>
				This club doesn't exist or you don't have access to it.
			</AlertDescription>
		</Alert>
		<Button variant="outline" onclick={() => void goto('/')}>Go home</Button>
	</div>
{:else}
	{@render children()}
{/if}
