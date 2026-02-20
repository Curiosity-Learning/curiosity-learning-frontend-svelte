<script lang="ts">
	import UsersIcon from '@lucide/svelte/icons/users';
	import AvatarStack from '$lib/components/app/home/avatar-stack.svelte';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Badge } from '$lib/components/ui/badge';
	import { buttonVariants } from '$lib/components/ui/button';
	import {
		Item,
		ItemActions,
		ItemContent,
		ItemDescription,
		ItemGroup,
		ItemMedia,
		ItemTitle
	} from '$lib/components/ui/item';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import * as Sheet from '$lib/components/ui/sheet';
	import { cn } from '$lib/utils.js';

	type MemberSummary = {
		id: string;
		name: string;
		imageUrl: string | null;
		email: string | null;
		username: string | null;
		roleName: string | null;
	};

	type Props = {
		members: MemberSummary[];
		isLoading?: boolean;
		summaryMax?: number;
	};

	let { members, isLoading = false, summaryMax = 5 }: Props = $props();

	let memberSheetOpen = $state(false);

	let summaryPeople = $derived(members.map((member) => ({ name: member.name, imageUrl: member.imageUrl })));

	const initialsFor = (name: string) => {
		const cleaned = name.trim();
		if (!cleaned) return '?';
		const parts = cleaned.split(/\s+/g).filter(Boolean);
		const letters = [parts[0]?.[0] ?? '', parts.at(-1)?.[0] ?? '']
			.join('')
			.toUpperCase();
		return letters || cleaned.slice(0, 2).toUpperCase();
	};

	const subtitleFor = (member: MemberSummary) => {
		if (member.username) return `@${member.username}`;
		if (member.email) return member.email;
		return null;
	};
</script>

<div class="flex flex-col gap-3">
	<p class="type-body-medium">Members</p>
	{#if isLoading}
		<p class="type-sm text-muted-foreground">Loading members...</p>
	{:else if members.length === 0}
		<p class="type-sm text-muted-foreground">No members yet.</p>
	{:else}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<AvatarStack people={summaryPeople} max={summaryMax} sizeClass="size-9" />
			<Sheet.Root bind:open={memberSheetOpen}>
				<Sheet.Trigger
					class={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0')}
					aria-label="View all project members"
				>
					<UsersIcon class="size-4" />
					<span>View all members</span>
				</Sheet.Trigger>
				<Sheet.Content side="right" class="gap-0 p-0">
					<Sheet.Header>
						<Sheet.Title>Project members</Sheet.Title>
						<Sheet.Description>Everyone currently involved in this project.</Sheet.Description>
					</Sheet.Header>
					<ScrollArea class="h-96">
						<ItemGroup class="gap-2 px-4 pb-4">
							{#each members as member (member.id)}
								<Item variant="outline" size="sm">
									<ItemMedia>
										<Avatar class="size-8">
											{#if member.imageUrl}
												<AvatarImage src={member.imageUrl} alt={member.name} />
											{/if}
											<AvatarFallback class="type-caption-bold">{initialsFor(member.name)}</AvatarFallback>
										</Avatar>
									</ItemMedia>
										<ItemContent>
											<ItemTitle class="w-full truncate">{member.name}</ItemTitle>
											{#if subtitleFor(member)}
												<ItemDescription class="line-clamp-1 w-full">
													{subtitleFor(member)}
												</ItemDescription>
											{/if}
										</ItemContent>
									{#if member.roleName}
										<ItemActions>
											<Badge variant="outline">{member.roleName}</Badge>
										</ItemActions>
									{/if}
								</Item>
							{/each}
						</ItemGroup>
					</ScrollArea>
				</Sheet.Content>
			</Sheet.Root>
		</div>
	{/if}
</div>
