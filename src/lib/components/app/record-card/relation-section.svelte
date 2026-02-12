<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		title: string;
		children: Snippet;
		titleClass?: string;
	};

	let {
		title,
		children,
		titleClass = 'type-h6-bold text-slate-600'
	}: Props = $props();
</script>

<section class="flex flex-col gap-3">
	<p class={titleClass}>{title}</p>
	{@render children()}
</section>
