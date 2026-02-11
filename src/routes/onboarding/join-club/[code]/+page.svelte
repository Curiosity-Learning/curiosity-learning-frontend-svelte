<script lang="ts">
	import { goto } from '$app/navigation';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import type { PageProps } from './$types';
	import { api } from '$convex/_generated/api';
	import { authClient } from '$lib/auth-client';

	let { data }: PageProps = $props();

	const session = authClient.useSession();
	const convexClient = useConvexClient();
	const preview = useQuery(api.clubs.getClubPreviewByCode, () => ({ code: data.code }));

	let pending = $state(false);
	let errorMessage = $state('');

	const joinClub = async () => {
		if (!$session.data) {
			await goto(`/auth/sign-in?next=${encodeURIComponent(`/onboarding/join-club/${data.code}`)}`);
			return;
		}

		pending = true;
		errorMessage = '';
		try {
			const result = await convexClient.mutation(api.clubs.joinClubWithCode, { code: data.code });
			await goto(result?.clubId ? `/${result.clubId}` : '/');
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unable to join this club.';
		} finally {
			pending = false;
		}
	};
</script>

<div class="flex flex-1 flex-col items-center justify-center gap-6">
	<Card class="w-full max-w-xl">
		<CardHeader class="flex flex-col gap-2">
			<CardTitle>Club preview</CardTitle>
			<CardDescription>Invite code <Badge variant="secondary">{data.code}</Badge></CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			{#if preview.isLoading}
				<p class="text-sm text-muted-foreground">Loading club details...</p>
			{:else if !preview.data}
				<Alert variant="destructive">
					<AlertTitle>Invalid code</AlertTitle>
					<AlertDescription>This invite code is not valid anymore.</AlertDescription>
				</Alert>
			{:else}
				<div class="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
					<p class="text-lg font-semibold">{preview.data.name}</p>
					{#if preview.data.description}
						<p class="text-sm text-muted-foreground">{preview.data.description}</p>
					{/if}
					<div class="flex flex-wrap gap-2">
						<Badge variant="outline">{preview.data.memberCount} members</Badge>
						{#if preview.data.location}
							<Badge variant="outline">{preview.data.location}</Badge>
						{/if}
						{#if preview.data.meetingDay || preview.data.meetingTime}
							<Badge variant="outline"
								>{preview.data.meetingDay ?? 'Day TBD'} {preview.data.meetingTime ?? ''}</Badge
							>
						{/if}
					</div>
				</div>
			{/if}

			{#if errorMessage}
				<Alert variant="destructive">
					<AlertTitle>Could not join</AlertTitle>
					<AlertDescription>{errorMessage}</AlertDescription>
				</Alert>
			{/if}

			<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
				<Button
					disabled={pending || preview.isLoading || !preview.data}
					onclick={() => void joinClub()}>{pending ? 'Joining...' : 'Join as learner'}</Button
				>
				<Button href="/onboarding/join-club" variant="outline">Enter another code</Button>
			</div>
		</CardContent>
	</Card>
</div>
