	<script lang="ts">
		import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
		import { Badge } from '$lib/components/ui/badge';
		import {
			Card,
			CardContent,
			CardDescription,
			CardHeader,
			CardTitle
		} from '$lib/components/ui/card';
		import { api } from '$convex/_generated/api';
		import { useQuery } from 'convex-svelte';
		import { formatDateTime } from '$lib/domain/date';
		import { authClient } from '$lib/auth-client';

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
			<CardHeader class="flex flex-col gap-2">
				<CardTitle>Feed</CardTitle>
				<CardDescription>Recent project updates from your clubs.</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-3">
				{#if updates.isLoading}
					<p class="text-sm text-muted-foreground">Loading updates...</p>
				{:else if (updates.data?.length ?? 0) === 0}
					<p class="text-sm text-muted-foreground">No updates yet.</p>
				{:else}
					{#each updates.data ?? [] as item (item.updateId)}
						<div class="flex flex-col gap-2 rounded-md border border-border p-3">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<div class="flex flex-wrap items-center gap-2">
									{#if item.clubName}
										<Badge variant="secondary">{item.clubName}</Badge>
									{/if}
									{#if item.projectName}
										<Badge variant="outline">{item.projectName}</Badge>
									{/if}
									<span class="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</span>
								</div>
							</div>
							<p class="text-sm whitespace-pre-wrap">{item.content}</p>
						</div>
					{/each}
				{/if}
			</CardContent>
		</Card>
	{/if}
