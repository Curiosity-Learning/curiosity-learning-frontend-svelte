<script lang="ts">
	import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import { Button } from '$lib/components/ui/button';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuSeparator,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import type { Component } from 'svelte';

	export type ActionMenuItem = {
		id: string;
		label: string;
		Icon?: Component<{ class?: string }>;
		tone?: 'default' | 'destructive';
		disabled?: boolean;
		separatorBefore?: boolean;
		onSelect?: () => void;
	};

	type Props = {
		items: ActionMenuItem[];
		ariaLabel?: string;
		align?: 'start' | 'center' | 'end';
		contentClass?: string;
	};

	let { items, ariaLabel = 'Open actions', align = 'end', contentClass = 'w-48' }: Props = $props();
</script>

{#if items.length > 0}
	<DropdownMenu>
		<DropdownMenuTrigger>
			<Button variant="ghost" size="icon-sm" aria-label={ariaLabel}>
				<EllipsisVerticalIcon class="size-5" />
			</Button>
		</DropdownMenuTrigger>
		<DropdownMenuContent {align} class={contentClass}>
			{#each items as item, index (item.id)}
				{#if item.separatorBefore && index > 0}
					<DropdownMenuSeparator />
				{/if}
				<DropdownMenuItem
					variant={item.tone === 'destructive' ? 'destructive' : 'default'}
					disabled={item.disabled}
					onSelect={() => item.onSelect?.()}
					class="gap-3 py-2"
				>
					{#if item.Icon}
						<item.Icon class="size-4" />
					{/if}
					<span>{item.label}</span>
				</DropdownMenuItem>
			{/each}
		</DropdownMenuContent>
	</DropdownMenu>
{/if}
