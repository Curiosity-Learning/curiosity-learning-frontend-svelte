<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Card, CardContent, CardHeader } from '$lib/components/ui/card';
	import { cn } from '$lib/utils.js';

	type Props = {
		class?: string;
		href?: string;
		disabled?: boolean;
		header: Snippet;
		children: Snippet;
	};

	let { class: className, href, disabled = false, header, children }: Props = $props();
</script>

<Card class={cn('gap-0 py-0', className)} {href} {disabled}>
	<CardHeader class="flex flex-col items-stretch gap-2 p-5 pb-4">
		{@render header()}
	</CardHeader>
	<CardContent class="flex flex-col gap-4 p-5 pt-0">
		{@render children()}
	</CardContent>
</Card>
