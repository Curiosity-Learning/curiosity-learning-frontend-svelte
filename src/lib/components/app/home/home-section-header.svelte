<script lang="ts">
	type Props = {
		title: string;
		action?: import('svelte').Snippet;
	};

	let { title, action }: Props = $props();
</script>

<div class="flex items-center justify-between gap-4">
	<h2 class="text-xl font-semibold tracking-tight text-foreground/80">{title}</h2>
	{#if action}
		<div class="flex items-center gap-2">
			{@render action()}
		</div>
	{/if}
</div>

