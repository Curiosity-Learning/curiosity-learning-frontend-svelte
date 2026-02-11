<script lang="ts">
	import { getContext } from 'svelte';
	import { PAGE_HEADER_CTX, type PageHeaderController } from '$lib/app/page-header';

	type Props = {
		children?: import('svelte').Snippet;
	};

	let { children }: Props = $props();

	const controller = getContext<PageHeaderController | undefined>(PAGE_HEADER_CTX);
	$effect(() => {
		if (!controller) return;
		controller.setBanner(children ?? null);
		return () => controller.clearBanner();
	});
</script>
