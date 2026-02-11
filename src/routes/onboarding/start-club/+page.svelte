<script lang="ts">
	import { goto } from '$app/navigation';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { authClient } from '$lib/auth-client';
	import { api } from '$convex/_generated/api';
	import { useConvexClient } from 'convex-svelte';

	const session = authClient.useSession();
	const convexClient = useConvexClient();

	let name = $state('');
	let description = $state('');
	let location = $state('');
	let meetingDay = $state('');
	let meetingTime = $state('');
	let pending = $state(false);
	let errorMessage = $state('');

	const createClub = async () => {
		if (!$session.data) {
			await goto('/auth/sign-up?next=/onboarding/start-club');
			return;
		}

		pending = true;
		errorMessage = '';
		try {
			const result = await convexClient.mutation(api.clubs.createClub, {
				name: name.trim(),
				description: description.trim() || undefined,
				location: location.trim() || undefined,
				meetingDay: meetingDay.trim() || undefined,
				meetingTime: meetingTime.trim() || undefined
			});
			await goto(result?.clubId ? `/${result.clubId}` : '/');
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to create club.';
		} finally {
			pending = false;
		}
	};
</script>

<div class="flex flex-1 flex-col items-center justify-center gap-6">
	<Card class="w-full max-w-2xl">
		<CardHeader class="flex flex-col gap-2">
			<CardTitle>Start a club</CardTitle>
			<CardDescription
				>Create your club workspace and invite learners with a generated code.</CardDescription
			>
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2 sm:col-span-2">
					<Label for="clubName">Club name</Label>
					<Input id="clubName" bind:value={name} maxlength={100} />
				</div>
				<div class="flex flex-col gap-2 sm:col-span-2">
					<Label for="clubDescription">Description</Label>
					<Textarea id="clubDescription" bind:value={description} rows={4} />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="clubLocation">Location</Label>
					<Input id="clubLocation" bind:value={location} />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="meetingDay">Meeting day</Label>
					<Input id="meetingDay" bind:value={meetingDay} placeholder="Tuesday" />
				</div>
				<div class="flex flex-col gap-2 sm:col-span-2">
					<Label for="meetingTime">Meeting time</Label>
					<Input id="meetingTime" bind:value={meetingTime} placeholder="4:00 PM" />
				</div>
			</div>

			{#if errorMessage}
				<Alert variant="destructive">
					<AlertTitle>Unable to create club</AlertTitle>
					<AlertDescription>{errorMessage}</AlertDescription>
				</Alert>
			{/if}

			<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
				<Button disabled={pending || !name.trim()} onclick={() => void createClub()}
					>{pending ? 'Creating...' : 'Create club'}</Button
				>
				<Button href="/onboarding/get-started" variant="outline">Cancel</Button>
			</div>
		</CardContent>
	</Card>
</div>
