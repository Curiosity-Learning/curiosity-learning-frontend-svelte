<script lang="ts">
	import { getContext } from 'svelte';
	import {
		PAGE_HEADER_CTX,
		type BottomNavHiddenOverride,
		type PageHeaderController
	} from '$lib/app/page-header';

	type Props = {
		hidden?: boolean;
	};

	let { hidden = false }: Props = $props();

	const controller = getContext<PageHeaderController | undefined>(PAGE_HEADER_CTX);
	$effect(() => {
		if (!controller) return;
		const value: BottomNavHiddenOverride = hidden;
		controller.setBottomNavHidden(value);
		return () => controller.clearBottomNavHidden();
	});
</script>
