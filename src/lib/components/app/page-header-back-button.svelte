<script lang="ts">
	import { getContext } from 'svelte';
	import {
		PAGE_HEADER_CTX,
		type HeaderBackConfig,
		type PageHeaderController
	} from '$lib/app/page-header';

	type Props = {
		enabled?: boolean;
		fallbackHref?: string;
		ariaLabel?: string;
		preferFallback?: boolean;
	};

	let { enabled = true, fallbackHref, ariaLabel, preferFallback = false }: Props = $props();

	const controller = getContext<PageHeaderController | undefined>(PAGE_HEADER_CTX);
	$effect(() => {
		if (!controller) return;
		const value: HeaderBackConfig = enabled ? { fallbackHref, ariaLabel, preferFallback } : null;
		controller.setBackConfig(value);
		return () => controller.clearBackConfig();
	});
</script>
