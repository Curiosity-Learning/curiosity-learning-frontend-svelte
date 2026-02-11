<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<div class="flex flex-1 flex-col items-center justify-center gap-6">
	<Card class="w-full max-w-3xl">
		<CardHeader class="flex flex-col gap-2">
			<CardTitle class="text-3xl">Welcome to Curiosity Learning</CardTitle>
			<CardDescription
				>Join an existing club or create your own to plan sessions, projects, and learner progress.</CardDescription
			>
		</CardHeader>
		<CardContent class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			{#if data.isAuthenticated}
				<Button href="/onboarding/join-club">Join a club</Button>
				<Button href="/onboarding/start-club" variant="outline">Start a club</Button>
			{:else}
				<Button href="/auth/sign-up?next=/onboarding/join-club">Join a club</Button>
				<Button href="/auth/sign-up?next=/onboarding/start-club" variant="outline"
					>Start a club</Button
				>
			{/if}
			<Button href="/auth/sign-in?next=/" variant="ghost" class="sm:col-span-2"
				>I already have an account</Button
			>
		</CardContent>
	</Card>
</div>
