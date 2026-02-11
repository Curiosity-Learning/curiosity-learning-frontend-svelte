<script lang="ts">
	import { goto } from '$app/navigation';
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

	let code = $state('');

	const preview = async () => {
		const normalized = code.trim().toUpperCase();
		if (!normalized) {
			return;
		}
		await goto(`/onboarding/join-club/${normalized}`);
	};
</script>

<div class="flex flex-1 flex-col items-center justify-center gap-6">
	<Card class="w-full max-w-xl">
		<CardHeader class="flex flex-col gap-2">
			<CardTitle>Join a club</CardTitle>
			<CardDescription>Enter your 6-character invite code to preview a club.</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			<div class="flex flex-col gap-2">
				<Label for="code">Invite code</Label>
				<Input id="code" bind:value={code} maxlength={6} placeholder="ABC123" />
			</div>
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
				<Button disabled={!code.trim()} onclick={() => void preview()}>Preview club</Button>
				<Button href="/onboarding/get-started" variant="outline">Back</Button>
			</div>
		</CardContent>
	</Card>
</div>
