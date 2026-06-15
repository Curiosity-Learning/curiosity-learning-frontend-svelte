<script lang="ts">
	import { getContext } from 'svelte';
	import {
		PAGE_HEADER_CTX,
		type PageContentMode,
		type PageHeaderController
	} from '$lib/app/page-header';

	type Props = {
		mode?: PageContentMode;
	};

	let { mode = 'scroll' }: Props = $props();

	const controller = getContext<PageHeaderController | undefined>(PAGE_HEADER_CTX);
	$effect(() => {
		if (!controller) return;
		controller.setContentMode(mode);
		return () => controller.clearContentMode();
	});
</script>
