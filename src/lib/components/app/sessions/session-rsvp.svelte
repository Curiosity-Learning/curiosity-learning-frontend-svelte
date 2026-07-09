<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button';
	import { formatT, t } from '$lib/i18n';

	type RsvpStatus = 'going' | 'not_going';

	type Props = {
		myStatus: RsvpStatus | null;
		goingCount: number;
		notGoingCount: number;
		canRsvp?: boolean;
		locked?: boolean;
		pending?: boolean;
		onSetStatus?: (status: RsvpStatus) => void;
		class?: string;
	};

	let {
		myStatus,
		goingCount,
		notGoingCount,
		canRsvp = true,
		locked = false,
		pending = false,
		onSetStatus,
		class: className
	}: Props = $props();

	let goingCountLabel = $derived(
		formatT(goingCount === 1 ? 'sessionRsvp.goingCountOne' : 'sessionRsvp.goingCountOther', {
			count: goingCount
		})
	);

	const select = (status: RsvpStatus) => {
		if (!canRsvp || locked || pending) return;
		onSetStatus?.(status);
	};
</script>

<div class={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
	{#if canRsvp}
		<Button
			variant={myStatus === 'going' ? 'default' : 'outline'}
			size="sm"
			disabled={locked || pending}
			aria-pressed={myStatus === 'going'}
			onclick={() => select('going')}
		>
			<CheckIcon class="size-4" />
			{t('sessionRsvp.going')}
		</Button>
		<Button
			variant={myStatus === 'not_going' ? 'destructive' : 'outline'}
			size="sm"
			disabled={locked || pending}
			aria-pressed={myStatus === 'not_going'}
			onclick={() => select('not_going')}
		>
			<XIcon class="size-4" />
			{t('sessionRsvp.notGoing')}
		</Button>
	{/if}
	<span class="type-sm text-muted-foreground">
		{goingCountLabel}
		{#if notGoingCount > 0}
			{formatT('sessionRsvp.notGoingCountSuffix', { count: notGoingCount })}
		{/if}
	</span>
</div>
