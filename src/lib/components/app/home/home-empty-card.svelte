<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils.js';

	type Props = {
		label: string;
		href: string;
		minHeightClass?: string;
	};

	let { label, href, minHeightClass = 'min-h-40' }: Props = $props();
</script>

<Card class="gap-0 py-0">
	<CardContent class={cn('px-0', minHeightClass)}>
		<Button
			href={href}
			variant="ghost"
			class="h-full w-full justify-center rounded-xl text-base font-medium text-foreground hover:bg-accent/60"
			data-sveltekit-preload-code="hover"
			data-sveltekit-preload-data="hover"
		>
			{label}
		</Button>
	</CardContent>
</Card>
