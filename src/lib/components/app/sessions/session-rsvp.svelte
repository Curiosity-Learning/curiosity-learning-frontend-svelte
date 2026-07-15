<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import { t } from '$lib/i18n';

	export type RsvpStatus = 'going' | 'not_going';

	// Single implementation for every Going/Not-going surface (CEO review round 3): the card
	// preview, and both rows of the attendees roster. `interactive` renders the editable dropdown
	// (chevron + menu) — used for the viewer's own actionable row, or a card's RSVP control.
	// Non-interactive renders the exact same button visual for other members' status: no chevron,
	// not focusable/clickable.
	type Props = {
		status: RsvpStatus | null;
		interactive?: boolean;
		pending?: boolean;
		disabled?: boolean;
		onSetStatus?: (status: RsvpStatus) => void;
		class?: string;
	};

	let {
		status,
		interactive = false,
		pending = false,
		disabled = false,
		onSetStatus,
		class: className
	}: Props = $props();
</script>

{#snippet statusContent()}
	{#if status === 'not_going'}
		<XIcon class="size-4 text-destructive" />
		{t('sessionRsvp.notGoing')}
	{:else}
		<CheckIcon class="size-4 text-green-500" />
		{t('sessionRsvp.going')}
	{/if}
{/snippet}

{#if interactive}
	<DropdownMenu>
		<DropdownMenuTrigger>
			<Button
				variant="outline"
				size="sm"
				disabled={pending || disabled}
				aria-label={t('sessionRsvp.changeAria')}
				class={className}
			>
				{@render statusContent()}
				<ChevronDownIcon class="size-4 text-muted-foreground" />
			</Button>
		</DropdownMenuTrigger>
		<DropdownMenuContent align="end" class="w-44">
			<DropdownMenuItem onSelect={() => onSetStatus?.('going')}>
				<CheckIcon class="size-4" />
				<span>{t('sessionRsvp.going')}</span>
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => onSetStatus?.('not_going')}>
				<XIcon class="size-4" />
				<span>{t('sessionRsvp.notGoing')}</span>
			</DropdownMenuItem>
		</DropdownMenuContent>
	</DropdownMenu>
{:else}
	<Button variant="outline" size="sm" disabled class={className}>
		{@render statusContent()}
	</Button>
{/if}
