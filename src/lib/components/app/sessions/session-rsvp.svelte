<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button';
	import { t } from '$lib/i18n';

	type RsvpStatus = 'going' | 'not_going';

	type Props = {
		myStatus: RsvpStatus | null;
		canRsvp?: boolean;
		locked?: boolean;
		pending?: boolean;
		onSetStatus?: (status: RsvpStatus) => void;
		class?: string;
	};

	let {
		myStatus,
		canRsvp = true,
		locked = false,
		pending = false,
		onSetStatus,
		class: className
	}: Props = $props();

	const select = (status: RsvpStatus) => {
		if (!canRsvp || locked || pending) return;
		onSetStatus?.(status);
	};
</script>

<!-- CEO decision 2026-07-11: when the RSVP control isn't actionable (no permission, or the
     session has started/was cancelled), it is hidden entirely — never disabled-with-explanation. -->
{#if canRsvp && !locked}
	<div class={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
		<Button
			variant={myStatus === 'going' ? 'default' : 'outline'}
			size="sm"
			disabled={pending}
			aria-pressed={myStatus === 'going'}
			onclick={() => select('going')}
		>
			<CheckIcon class="size-4" />
			{t('sessionRsvp.going')}
		</Button>
		<Button
			variant={myStatus === 'not_going' ? 'destructive' : 'outline'}
			size="sm"
			disabled={pending}
			aria-pressed={myStatus === 'not_going'}
			onclick={() => select('not_going')}
		>
			<XIcon class="size-4" />
			{t('sessionRsvp.notGoing')}
		</Button>
	</div>
{/if}
