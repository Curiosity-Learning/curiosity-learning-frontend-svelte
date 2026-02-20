<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { pushState } from '$app/navigation';
	import { page } from '$app/state';

	let {
		open = $bindable(false),
		closeOnBack = true,
		...restProps
	}: DialogPrimitive.RootProps & { closeOnBack?: boolean } = $props();

	let hasBackEntry = false;
	let suppressCloseBack = false;

	$effect(() => {
		if (!closeOnBack || typeof window === 'undefined') return;

		const handlePopState = () => {
			if (!hasBackEntry) return;
			hasBackEntry = false;
			suppressCloseBack = true;
			open = false;
		};

		window.addEventListener('popstate', handlePopState);
		return () => window.removeEventListener('popstate', handlePopState);
	});

	$effect(() => {
		if (!closeOnBack || typeof window === 'undefined') return;

		if (open && !hasBackEntry) {
			pushState('', page.state);
			hasBackEntry = true;
			return;
		}

		if (!open && hasBackEntry) {
			if (suppressCloseBack) {
				suppressCloseBack = false;
				return;
			}
			hasBackEntry = false;
			history.back();
		}
	});
</script>

<DialogPrimitive.Root bind:open {...restProps} />
