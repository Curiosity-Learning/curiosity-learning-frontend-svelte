<script lang="ts">
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { LoadingState } from '$lib/components/app';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { formatDateTime } from '$lib/domain/date';
	import { authClient } from '$lib/auth-client';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';

	const convexClient = useConvexClient();
	const session = authClient.useSession();
	const notifications = useStableQuery(api.notifications.list, () => ($session.data ? {} : 'skip'));

	let pending = $state(false);
	let errorMessage = $state('');

	const markRead = async (notificationId: Id<'notifications'>) => {
		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.notifications.markRead, { notificationId });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to update notification.';
		} finally {
			pending = false;
		}
	};

	const markAllRead = async () => {
		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.notifications.markAllRead, {});
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to mark all as read.';
		} finally {
			pending = false;
		}
	};
</script>

<Card>
	<CardHeader class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex flex-col gap-1">
			<CardTitle>Notifications</CardTitle>
			<CardDescription>Keep track of system and club events.</CardDescription>
		</div>
		<Button variant="outline" disabled={pending} onclick={() => void markAllRead()}
			>Mark all read</Button
		>
	</CardHeader>
	<CardContent class="flex flex-col gap-3">
		{#if errorMessage}
			<Alert variant="destructive">
				<AlertTitle>Update failed</AlertTitle>
				<AlertDescription>{errorMessage}</AlertDescription>
			</Alert>
		{/if}

		{#if notifications.isLoading}
			<LoadingState label="Loading notifications" />
		{:else if (notifications.data?.length ?? 0) === 0}
			<p class="text-sm text-muted-foreground">No notifications available.</p>
		{:else}
			{#each notifications.data ?? [] as notification (notification._id)}
				<div class="flex flex-col gap-2 rounded-md border border-border p-3">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div class="flex items-center gap-2">
							<p class="font-medium">{notification.title}</p>
							{#if !notification.isRead}
								<Badge>New</Badge>
							{/if}
						</div>
						<Button
							size="sm"
							variant="outline"
							disabled={pending || notification.isRead}
							onclick={() => void markRead(notification._id)}
						>
							Mark read
						</Button>
					</div>
					<p class="text-sm text-muted-foreground">{notification.message}</p>
					<div class="flex flex-wrap gap-2 text-xs text-muted-foreground">
						<span>{formatDateTime(notification.createdAt)}</span>
						{#if notification.url}
							{#if notification.url.startsWith('/')}
								<Button href={notification.url} variant="link" class="text-sm">
									Open link
								</Button>
							{:else}
								<Button
									variant="link"
									class="text-sm"
									onclick={() => {
										window.open(notification.url, '_blank', 'noopener,noreferrer');
									}}
								>
									Open link
								</Button>
							{/if}
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	</CardContent>
</Card>
