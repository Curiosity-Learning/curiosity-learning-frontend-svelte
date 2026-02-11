<script lang="ts">
	import { getContext } from 'svelte';
	import {
		PAGE_HEADER_CTX,
		type HeaderActionsOverride,
		type PageHeaderController
	} from '$lib/app/page-header';

	type Props = {
		none?: boolean;
		children?: import('svelte').Snippet;
	};

	let { none = false, children }: Props = $props();

	const controller = getContext<PageHeaderController | undefined>(PAGE_HEADER_CTX);
	$effect(() => {
		if (!controller) return;
		const value: HeaderActionsOverride = none ? false : (children ?? null);
		controller.setActions(value);
		return () => controller.clearActions();
	});
</script>
