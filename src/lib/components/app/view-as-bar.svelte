<script lang="ts">
	import { goto } from '$app/navigation';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { showGlobalSnackbar } from '$lib/components/app/snackbar';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Button } from '$lib/components/ui/button';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuLabel,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import { formatT, t } from '$lib/i18n';
	import { cn } from '$lib/utils';

	// CL-734 "View as Child": the bar a parent account always sees above the whole app. Outside a
	// view it offers to switch into one; inside a view it names the child, switches between
	// children, and goes back to the parent's own account. Switching only flips the session's
	// `parentViewSessions` row — every Convex query then answers as the child by itself (see
	// permissions.ts), so the app below re-renders as the child's own interface.

	type ChildSummary = {
		childProfileId: Id<'profiles'>;
		displayName: string;
		username: string | null;
		coverPhotoUrl: string | null;
	};

	type Props = {
		linkedChildren: ChildSummary[];
		viewingAsChildProfileId: Id<'profiles'> | null;
	};

	let { linkedChildren, viewingAsChildProfileId }: Props = $props();

	const convexClient = useConvexClient();
	let pending = $state(false);

	let viewingChild = $derived(
		linkedChildren.find((child) => child.childProfileId === viewingAsChildProfileId) ?? null
	);
	let hasManyChildren = $derived(linkedChildren.length > 1);

	const initials = (name: string) =>
		name
			.split(' ')
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('') || '?';

	const startViewing = async (child: ChildSummary) => {
		if (pending || child.childProfileId === viewingAsChildProfileId) return;
		pending = true;
		try {
			await convexClient.mutation(api.viewAs.startViewing, {
				childProfileId: child.childProfileId
			});
			// Land on the child's home: the page the parent was on may belong to a club or project
			// the child is not part of. invalidateAll re-runs server loads (club gate) as the child.
			await goto('/', { invalidateAll: true });
		} catch {
			showGlobalSnackbar({ title: formatT('viewAs.startFailure', { name: child.displayName }) });
		} finally {
			pending = false;
		}
	};

	const stopViewing = async () => {
		if (pending) return;
		pending = true;
		try {
			await convexClient.mutation(api.viewAs.stopViewing, {});
			await goto('/', { invalidateAll: true });
		} catch {
			showGlobalSnackbar({ title: t('viewAs.exitFailure') });
		} finally {
			pending = false;
		}
	};
</script>

{#snippet childAvatar(child: ChildSummary, size: string)}
	<Avatar class={cn('shrink-0 bg-white/80', size)}>
		{#if child.coverPhotoUrl}
			<AvatarImage src={child.coverPhotoUrl} alt={child.displayName} />
		{/if}
		<AvatarFallback class="type-xs font-semibold">{initials(child.displayName)}</AvatarFallback>
	</Avatar>
{/snippet}

{#snippet childMenu(label: string, align: 'start' | 'end')}
	<DropdownMenuContent {align} class="w-64">
		<DropdownMenuLabel>{label}</DropdownMenuLabel>
		{#each linkedChildren as child (child.childProfileId)}
			<DropdownMenuItem
				class="justify-between gap-3 py-2"
				disabled={pending}
				onSelect={() => void startViewing(child)}
			>
				<span class="flex min-w-0 flex-1 items-center gap-2">
					{@render childAvatar(child, 'size-6')}
					<span class="truncate">{child.displayName}</span>
				</span>
				{#if child.childProfileId === viewingAsChildProfileId}
					<CheckIcon class="size-4 shrink-0 text-orange-500" />
				{/if}
			</DropdownMenuItem>
		{/each}
	</DropdownMenuContent>
{/snippet}

{#if viewingChild}
	<div
		class="flex w-full items-center justify-center border-b border-orange-300 bg-orange-100"
		role="status"
		data-testid="view-as-bar"
	>
		<div class="flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-2 sm:px-6 lg:px-8">
			<div class="flex min-w-0 items-center gap-2">
				{#if hasManyChildren}
					<DropdownMenu>
						<DropdownMenuTrigger
							class="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-orange-200/60"
							aria-label={t('viewAs.switchChildLabel')}
						>
							{@render childAvatar(viewingChild, 'size-7')}
							<span class="type-sm-bold truncate text-orange-950">
								{formatT('viewAs.viewingLabel', { name: viewingChild.displayName })}
							</span>
							<ChevronDownIcon class="size-4 shrink-0 text-orange-900" />
						</DropdownMenuTrigger>
						{@render childMenu(t('viewAs.switchChildLabel'), 'start')}
					</DropdownMenu>
				{:else}
					{@render childAvatar(viewingChild, 'size-7')}
					<span class="type-sm-bold truncate text-orange-950">
						{formatT('viewAs.viewingLabel', { name: viewingChild.displayName })}
					</span>
				{/if}
				<span
					class="type-xs hidden shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-orange-900 sm:inline"
				>
					{t('viewAs.readOnlyHint')}
				</span>
			</div>
			<Button
				size="sm"
				variant="outline"
				class="shrink-0 border-orange-300 bg-white"
				disabled={pending}
				onclick={() => void stopViewing()}
			>
				{t('viewAs.exitAction')}
			</Button>
		</div>
	</div>
{:else if linkedChildren.length > 0}
	<div
		class="flex w-full items-center justify-center border-b border-border bg-gray-50"
		data-testid="view-as-bar"
	>
		<div
			class="flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-1.5 sm:px-6 lg:px-8"
		>
			<p class="type-sm flex min-w-0 items-center gap-2 text-muted-foreground">
				<EyeIcon class="size-4 shrink-0" />
				<span class="truncate">
					{hasManyChildren
						? t('viewAs.promptMultiple')
						: formatT('viewAs.promptSingle', { name: linkedChildren[0].displayName })}
				</span>
			</p>
			{#if hasManyChildren}
				<DropdownMenu>
					<DropdownMenuTrigger disabled={pending}>
						{#snippet child({ props })}
							<Button {...props} size="sm" class="shrink-0 gap-1">
								{t('viewAs.chooseChildAction')}
								<ChevronDownIcon class="size-4" />
							</Button>
						{/snippet}
					</DropdownMenuTrigger>
					{@render childMenu(t('viewAs.chooseChildLabel'), 'end')}
				</DropdownMenu>
			{:else}
				<Button
					size="sm"
					class="shrink-0 gap-1"
					disabled={pending}
					onclick={() => void startViewing(linkedChildren[0])}
				>
					{formatT('viewAs.startAction', { name: linkedChildren[0].displayName })}
					<ArrowRightIcon class="size-4" />
				</Button>
			{/if}
		</div>
	</div>
{/if}
