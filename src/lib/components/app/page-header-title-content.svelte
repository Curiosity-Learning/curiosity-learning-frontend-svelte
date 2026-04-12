<script lang="ts">
	import { getContext } from 'svelte';
	import {
		PAGE_HEADER_CTX,
		type HeaderTitleContentOverride,
		type PageHeaderController
	} from '$lib/app/page-header';

	type Props = {
		enabled?: boolean;
		children?: import('svelte').Snippet;
	};

	let { enabled = true, children }: Props = $props();

	const controller = getContext<PageHeaderController | undefined>(PAGE_HEADER_CTX);
	$effect(() => {
		if (!controller) return;
		const value: HeaderTitleContentOverride = enabled ? (children ?? null) : null;
		controller.setTitleContent(value);
		return () => controller.clearTitleContent();
	});
</script>
