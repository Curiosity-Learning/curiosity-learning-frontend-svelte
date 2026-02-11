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

<div class="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
	<Card>
		<CardHeader class="flex flex-col gap-2">
			<CardTitle>Terms and Conditions</CardTitle>
			<CardDescription>
				{#if data.policy}
					Based on active policy version {data.policy.version}
				{:else}
					No terms content is configured.
				{/if}
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if data.policy}
				<div class="prose prose-sm max-w-none text-foreground">
					<h2>{data.policy.title}</h2>
					<p class="text-xs text-muted-foreground">
						Last updated {new Date(data.policy.updatedAt).toLocaleDateString()}
					</p>
					<p class="whitespace-pre-wrap">{data.policy.content}</p>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">
					Please contact an administrator to publish terms and conditions.
				</p>
			{/if}
		</CardContent>
	</Card>

	<div class="flex flex-wrap gap-2">
		<Button href="/privacy" variant="outline">Privacy policy</Button>
		<Button href="/settings" variant="outline">Back to settings</Button>
	</div>
</div>
