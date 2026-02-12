<script lang="ts">
	import { api } from '$convex/_generated/api';
	import { authClient } from '$lib/auth-client';
	import { formatDateTime } from '$lib/domain/date';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { useQuery } from 'convex-svelte';

	const session = authClient.useSession();
	const updates = useQuery(api.updates.listForViewer, () =>
		$session.data ? { limit: 50 } : 'skip'
	);
</script>

{#if !$session.data}
	<Alert>
		<AlertTitle>Sign in required</AlertTitle>
		<AlertDescription>Sign in to view your feed.</AlertDescription>
	</Alert>
{:else}
	<Card>
		<CardHeader>
			<CardTitle>My clubs</CardTitle>
			<CardDescription>Recent project updates from your clubs.</CardDescription>
		</CardHeader>
		<CardContent>
			{#if updates.isLoading}
				<p>Loading updates...</p>
			{:else if (updates.data?.length ?? 0) === 0}
				<p>No updates yet.</p>
			{:else}
				{#each updates.data ?? [] as item (item.updateId)}
					<Card>
						<CardHeader>
							<CardDescription>{formatDateTime(item.createdAt)}</CardDescription>
						</CardHeader>
						<CardContent>
							{#if item.clubName}
								<Badge variant="secondary">{item.clubName}</Badge>
							{/if}
							{#if item.projectName}
								<Badge variant="outline">{item.projectName}</Badge>
							{/if}
							<p>{item.content}</p>
						</CardContent>
					</Card>
				{/each}
			{/if}
		</CardContent>
	</Card>
{/if}
