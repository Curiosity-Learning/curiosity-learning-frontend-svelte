<script lang="ts">
	import { cn } from '$lib/utils.js';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import type { HTMLAttributes } from 'svelte/elements';

	type Props = {
		class?: string | null;
		role?: HTMLAttributes<HTMLElement>['role'];
		color?: string | null;
		stroke?: string | null;
		ariaLabel?: string;
	};

	let {
		class: className,
		role = 'status',
		color,
		stroke,
		ariaLabel = 'Loading'
	}: Props = $props();
</script>

<Loader2Icon
	{role}
	color={color ?? undefined}
	stroke={stroke ?? undefined}
	aria-label={ariaLabel}
	class={cn('size-4 animate-spin', className)}
/>
