<script lang="ts">
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils.js';
	import { _ } from '$lib/i18n';

	type Props = {
		onclick: () => void;
		class?: string;
	};

	let { onclick, class: className }: Props = $props();
</script>

<!-- Shared back affordance for full-screen flows (auth, onboarding, legal, public pages)
     that render outside the app-shell header. One idiom: neutral ghost icon Button.
     The negative margin keeps the chevron optically flush with the content edge. -->
<Button
	variant="ghost"
	size="icon"
	class={cn('-ml-2 shrink-0 self-start', className)}
	aria-label={$_('common.goBack')}
	{onclick}
>
	<ChevronLeftIcon class="size-7" />
</Button>
