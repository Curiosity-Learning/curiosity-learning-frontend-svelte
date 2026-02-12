<script lang="ts">
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';

	type Props = {
		title: string;
		description?: string;
		children: import('svelte').Snippet;
		compact?: boolean;
	};

	let { title, description, children, compact = false }: Props = $props();
</script>

<Card>
	<CardHeader class={compact ? 'gap-1 py-4' : 'gap-2'}>
		<CardTitle class={compact ? 'type-h6-medium' : 'type-h5-medium'}>
			{title}
		</CardTitle>
		{#if description}
			<CardDescription>{description}</CardDescription>
		{/if}
	</CardHeader>
	<CardContent class={compact ? 'flex flex-col gap-3 py-0 pb-4' : 'flex flex-col gap-4'}>
		{@render children()}
	</CardContent>
</Card>
