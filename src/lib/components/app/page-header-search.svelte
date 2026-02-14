<script lang="ts">
	import { getContext } from 'svelte';
	import {
		PAGE_HEADER_CTX,
		type HeaderSearchMode,
		type HeaderSearchOverride,
		type PageHeaderController
	} from '$lib/app/page-header';

	type Props = {
		value?: string;
		placeholder?: string;
		ariaLabel?: string;
		mode?: HeaderSearchMode;
		enabled?: boolean;
	};

	let {
		value = $bindable(''),
		placeholder = 'Search',
		ariaLabel = 'Search',
		mode = 'auto',
		enabled = true
	}: Props = $props();

	const controller = getContext<PageHeaderController | undefined>(PAGE_HEADER_CTX);
	$effect(() => {
		if (!controller) return;
		const nextValue: HeaderSearchOverride = enabled
			? {
					value,
					placeholder,
					ariaLabel,
					mode,
					onValueChange: (next) => {
						value = next;
					}
				}
			: null;
		controller.setSearch(nextValue);
		return () => controller.clearSearch();
	});
</script>
