<script lang="ts">
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';

	let { children } = $props();
</script>

<div
	class="flex min-h-screen flex-col items-center justify-center gap-6 bg-[radial-gradient(circle_at_top,_var(--color-primary)/12,_transparent_45%),linear-gradient(to_bottom,_var(--color-secondary)/35,_var(--color-background))] px-4 py-8"
>
	<div class="flex w-full max-w-md flex-col gap-4">
		<Card>
			<CardHeader class="flex flex-col gap-2">
				<CardTitle class="text-2xl">Curiosity Learning</CardTitle>
				<CardDescription>Sign in to continue your club experience.</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-4">
				{@render children()}
			</CardContent>
		</Card>
	</div>
</div>
