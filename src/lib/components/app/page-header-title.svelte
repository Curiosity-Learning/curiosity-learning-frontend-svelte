<script lang="ts">
	import { getContext } from 'svelte';
	import { PAGE_HEADER_CTX, type PageHeaderController } from '$lib/app/page-header';

	type Props = {
		title: string;
	};

	let { title }: Props = $props();

	const controller = getContext<PageHeaderController | undefined>(PAGE_HEADER_CTX);
	$effect(() => {
		if (!controller) return;
		controller.setTitle(title);
		return () => controller.clearTitle();
	});
</script>
