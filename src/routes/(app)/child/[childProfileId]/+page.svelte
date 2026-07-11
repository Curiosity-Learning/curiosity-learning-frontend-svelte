<script lang="ts">
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Avatar, AvatarFallback } from '$lib/components/ui/avatar';
	import { Badge } from '$lib/components/ui/badge';
	import * as Tabs from '$lib/components/ui/tabs';
	import { LoadingState, PageHeaderBackButton, PageHeaderTitle } from '$lib/components/app';
	import ReportIssueDialog from '$lib/components/app/report-issue-dialog.svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { routes } from '$lib/routes';
	import { t } from '$lib/i18n';
	import { linkifySegments } from '$lib/domain/linkify';
	import { formatClockTime } from '$lib/domain/date';

	// PRD 2.4/6.1.10 (CL-703): "View as Child" — a DEDICATED READ-ONLY SURFACE, not full app
	// impersonation (see parentAccounts.ts module header for the full design note). Every query
	// this page calls is server-verified against a `parentLinks` row between the caller and this
	// child, and computes visibility AS THE CHILD would see it. There is no composer, no mutation
	// affordance anywhere on this page — reporting uses the normal ReportIssueDialog, which
	// submits under the PARENT's own identity (not "as" the child).

	let childProfileId = $derived(
		(page.params as Record<string, string | undefined>).childProfileId as Id<'profiles'>
	);

	const overviewResponse = useStableQuery(api.parentAccounts.getChildOverview, () => ({
		childProfileId
	}));
	const roomsResponse = useStableQuery(api.parentAccounts.listChildRooms, () => ({
		childProfileId
	}));

	let overview = $derived(overviewResponse.data ?? null);
	let rooms = $derived(roomsResponse.data ?? []);

	let selectedRoomId = $state<Id<'rooms'> | null>(null);
	$effect(() => {
		if (selectedRoomId && rooms.some((room) => room.roomId === selectedRoomId)) return;
		selectedRoomId = rooms[0]?.roomId ?? null;
	});

	const messagesResponse = useStableQuery(api.parentAccounts.listChildMessages, () =>
		selectedRoomId ? { childProfileId, roomId: selectedRoomId } : 'skip'
	);
	let messages = $derived(messagesResponse.data?.messages ?? []);

	let displayName = $derived(
		overview
			? [overview.firstName, overview.lastName].filter(Boolean).join(' ').trim() ||
					overview.username ||
					t('profileDetail.fallbackName')
			: ''
	);
	let initials = $derived(
		(displayName || '?')
			.split(' ')
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);

	const isNotFoundError = (error: unknown) =>
		error instanceof Error && /access|not found|not accessible/i.test(error.message);
</script>

<PageHeaderBackButton fallbackHref={routes.settings} />
<PageHeaderTitle title={displayName || 'Child overview'} />

<div class="flex w-full flex-col gap-4 py-4">
	{#if overviewResponse.error}
		{#if isNotFoundError(overviewResponse.error)}
			<Alert variant="destructive">
				<AlertTitle>{t('parentAccounts.notFoundTitle')}</AlertTitle>
				<AlertDescription>{t('parentAccounts.notFoundDescription')}</AlertDescription>
			</Alert>
		{:else}
			<Alert variant="destructive">
				<AlertTitle>{t('parentAccounts.loadErrorTitle')}</AlertTitle>
				<AlertDescription>{overviewResponse.error.message}</AlertDescription>
			</Alert>
		{/if}
	{:else if overviewResponse.isLoading && !overview}
		<LoadingState class="min-h-48" label="Loading child overview" />
	{:else if overview}
		<Alert class="flex flex-wrap items-center justify-between gap-3 border-orange-200 bg-orange-50">
			<div class="flex items-center gap-3">
				<Avatar class="size-9 shrink-0 bg-[#d8dbe5]">
					<AvatarFallback class="text-xs font-bold text-slate-700">{initials}</AvatarFallback>
				</Avatar>
				<AlertTitle class="text-orange-900">
					{t('parentAccounts.bannerLabel').replace('{name}', displayName)}
				</AlertTitle>
			</div>
			<a href={routes.settings} class="text-sm font-medium text-orange-700 underline">
				{t('parentAccounts.exitAction')}
			</a>
		</Alert>

		<Tabs.Root value="overview" class="w-full">
			<Tabs.List>
				<Tabs.Trigger value="overview">{t('parentAccounts.overviewTab')}</Tabs.Trigger>
				<Tabs.Trigger value="chats">{t('parentAccounts.chatsTab')}</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content value="overview" class="flex flex-col gap-4">
				<section class="flex flex-col gap-3 rounded-2xl border border-border/70 bg-white p-4">
					<p class="type-body-bold text-foreground">{t('parentAccounts.clubsTitle')}</p>
					{#if overview.clubs.length === 0}
						<p class="type-sm text-muted-foreground">{t('parentAccounts.clubsEmpty')}</p>
					{:else}
						<div class="flex flex-wrap gap-2">
							{#each overview.clubs as club (club.clubId)}
								<div
									class="flex items-center gap-2 rounded-full border border-[#f0decc] bg-[#f8ecdf] px-3 py-1.5"
								>
									<span class="type-sm-bold text-orange-600">{club.clubName}</span>
									{#if club.roleName}
										<Badge
											class={club.roleKey === 'guide'
												? 'rounded-full bg-orange-500 px-2 py-0 text-xs text-white'
												: 'rounded-full bg-[#e4dccf] px-2 py-0 text-xs text-[#7a5c45]'}
										>
											{club.roleName}
										</Badge>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</section>

				<section class="flex flex-col gap-3">
					<p class="text-[1.25rem] leading-6 font-bold text-[#44495f]">
						{t('parentAccounts.currentProjectsTitle')}
					</p>
					{#if overview.projects.current.length === 0}
						<p class="type-sm text-muted-foreground">
							{t('parentAccounts.currentProjectsEmpty')}
						</p>
					{:else}
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
							{#each overview.projects.current as project (project.projectId)}
								<div class="flex flex-col gap-2 rounded-2xl border border-border/70 bg-white p-4">
									<p class="type-body-bold text-foreground">{project.name}</p>
									{#if project.description}
										<p class="type-sm line-clamp-2 text-muted-foreground">
											{project.description}
										</p>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</section>

				<section class="flex flex-col gap-3">
					<p class="text-[1.25rem] leading-6 font-bold text-[#44495f]">
						{t('parentAccounts.showcaseProjectsTitle')}
					</p>
					{#if overview.projects.showcase.length === 0}
						<p class="type-sm text-muted-foreground">
							{t('parentAccounts.showcaseProjectsEmpty')}
						</p>
					{:else}
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
							{#each overview.projects.showcase as project (project.projectId)}
								<div class="flex flex-col gap-2 rounded-2xl border border-border/70 bg-white p-4">
									<p class="type-body-bold text-foreground">{project.name}</p>
									{#if project.description}
										<p class="type-sm line-clamp-2 text-muted-foreground">
											{project.description}
										</p>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</section>

				<section class="flex flex-col gap-3">
					<p class="text-[1.25rem] leading-6 font-bold text-[#44495f]">
						{t('parentAccounts.updatesTitle')}
					</p>
					{#if overview.updates.length === 0}
						<p class="type-sm text-muted-foreground">{t('parentAccounts.updatesEmpty')}</p>
					{:else}
						<div class="flex flex-col gap-3">
							{#each overview.updates as update (update.updateId)}
								<div class="relative rounded-2xl border border-border/70 bg-white p-4">
									<div class="flex items-start justify-between gap-2">
										<div class="min-w-0">
											{#if update.projectName}
												<p class="type-sm-bold text-muted-foreground">{update.projectName}</p>
											{/if}
											<p class="type-sm mt-1 whitespace-pre-wrap text-foreground">
												{update.content}
											</p>
										</div>
										<ReportIssueDialog
											targetType="project_update"
											targetId={update.updateId}
											contextText={update.content}
										/>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</section>
			</Tabs.Content>

			<Tabs.Content value="chats">
				<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden lg:flex-row">
					<section
						class={`w-full flex-col gap-1 overflow-y-auto rounded-2xl border border-border/70 bg-white p-2 lg:flex lg:max-w-xs ${
							selectedRoomId ? 'hidden lg:flex' : 'flex'
						}`}
					>
						{#if roomsResponse.isLoading}
							<LoadingState variant="inline" size="sm" label="Loading chats" />
						{:else if rooms.length === 0}
							<p class="p-3 type-sm text-muted-foreground">{t('parentAccounts.roomsEmpty')}</p>
						{:else}
							{#each rooms as room (room.roomId)}
								<button
									type="button"
									class={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
										selectedRoomId === room.roomId ? 'bg-[#f5e2d2]' : 'hover:bg-[#f7f3ee]'
									}`}
									onclick={() => (selectedRoomId = room.roomId)}
								>
									<div class="min-w-0 flex-1">
										<p class="truncate text-sm font-bold text-[#242424]">{room.roomName}</p>
										{#if room.lastMessagePreview}
											<p class="truncate text-xs text-muted-foreground">
												{room.lastMessagePreview}
											</p>
										{/if}
									</div>
								</button>
							{/each}
						{/if}
					</section>

					<section
						class={`min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-white p-3 ${
							selectedRoomId ? 'flex' : 'hidden lg:flex'
						}`}
					>
						{#if selectedRoomId}
							<button
								type="button"
								class="mb-2 self-start text-sm font-medium text-orange-700 lg:hidden"
								onclick={() => (selectedRoomId = null)}
							>
								{t('parentAccounts.chatsTab')} &lt;
							</button>
						{/if}
						{#if !selectedRoomId}
							<p class="type-sm m-auto text-muted-foreground">
								{t('parentAccounts.selectChatPrompt')}
							</p>
						{:else if messagesResponse.isLoading && messages.length === 0}
							<LoadingState variant="inline" size="sm" label="Loading messages" />
						{:else if messages.length === 0}
							<p class="type-sm m-auto text-muted-foreground">{t('parentAccounts.noMessages')}</p>
						{:else}
							<div class="flex flex-1 flex-col gap-3 overflow-y-auto">
								{#each messages as entry (entry._id)}
									<div class="group flex items-start gap-2">
										<div class="min-w-0 flex-1 rounded-2xl bg-[#e7e9f3] px-3 py-2">
											<p class="break-words text-sm text-[#2b2b2b]">
												{#if entry.removedByModeration}
													<span class="italic opacity-70">{t('chat.removedByModeration')}</span>
												{:else}
													{#each linkifySegments(entry.content) as segment, index (index)}
														{#if segment.type === 'url'}
															<a
																href={segment.value}
																target="_blank"
																rel="noopener noreferrer"
																class="underline underline-offset-2 hover:opacity-80"
															>
																{segment.value}
															</a>
														{:else}
															{segment.value}
														{/if}
													{/each}
												{/if}
											</p>
											<p class="mt-1 text-right text-xs text-[#6b6f80]">
												{formatClockTime(entry._creationTime)}
											</p>
										</div>
										{#if !entry.removedByModeration}
											<span class="opacity-0 transition-opacity group-hover:opacity-100">
												<ReportIssueDialog
													targetType="chat_message"
													targetId={entry._id}
													contextText={entry.content}
												/>
											</span>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					</section>
				</div>
			</Tabs.Content>
		</Tabs.Root>
	{/if}
</div>
