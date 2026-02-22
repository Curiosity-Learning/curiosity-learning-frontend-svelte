<script lang="ts">
	import { api } from '$convex/_generated/api';
	import { UpdateCard } from '$lib/components/app';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { routes } from '$lib/routes';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';

	const updates = useStableQuery(api.updates.listForViewer, { limit: 50 });
</script>

<Card>
	<CardHeader>
		<CardTitle>My clubs</CardTitle>
		<CardDescription>Recent project updates from your clubs.</CardDescription>
	</CardHeader>
	<CardContent>
		{#if updates.isLoading}
			<p>Loading updates...</p>
		{:else if updates.error}
			<Alert variant="destructive">
				<AlertTitle>Could not load updates</AlertTitle>
				<AlertDescription>{updates.error.message}</AlertDescription>
			</Alert>
		{:else if (updates.data?.length ?? 0) === 0}
			<p>No updates yet.</p>
		{:else}
			<div class="flex flex-col gap-4">
				{#each updates.data ?? [] as item (item.updateId)}
					<UpdateCard
						authorName={item.authorName}
						authorImageUrl={item.authorImageUrl}
						createdAt={item.createdAt}
						content={item.content}
						relatedQuestion={item.questionContent ? { label: item.questionContent } : null}
						relatedProject={item.projectName
							? {
									label: item.projectName,
									href: item.projectId ? routes.projectDetail(item.projectId) : undefined
								}
							: null}
					/>
				{/each}
			</div>
		{/if}
	</CardContent>
</Card>
