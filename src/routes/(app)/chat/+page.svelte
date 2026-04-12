<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import ImageIcon from '@lucide/svelte/icons/image';
	import MessageCircleOffIcon from '@lucide/svelte/icons/message-circle-off';
	import PenLineIcon from '@lucide/svelte/icons/pen-line';
	import PinIcon from '@lucide/svelte/icons/pin';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SendHorizontalIcon from '@lucide/svelte/icons/send-horizontal';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import type { Id } from '$convex/_generated/dataModel';
	import { api } from '$convex/_generated/api';
	import { ActionMenu, PageHeaderActions, PageHeaderBackButton, PageHeaderTitle } from '$lib/components/app';
	import { authClient } from '$lib/auth-client';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { routes } from '$lib/routes';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Avatar, AvatarFallback } from '$lib/components/ui/avatar';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Sheet, SheetContent, SheetHeader, SheetTitle } from '$lib/components/ui/sheet';
	import noChatFoundImage from '$lib/assets/images/no_chat_found.png';
	import { useConvexClient } from 'convex-svelte';

	type RoomSummary = {
		roomId: Id<'rooms'>;
		roomName: string;
		isGroupChat: boolean;
		participantUserIds: string[];
		participantDisplayNames: string[];
		lastMessagePreview: string | null;
		lastMessageAt: number;
	};

	const DESKTOP_BREAKPOINT = 1024;

	const convexClient = useConvexClient();
	const session = authClient.useSession();

	const viewer = useStableQuery(api.auth.getViewerIdentity, () => ($session.data ? {} : 'skip'));
	const roomsResponse = useStableQuery(api.chat.listRoomSummaries, () =>
		$session.data ? {} : 'skip'
	);
	const messagingUsersResponse = useStableQuery(api.chat.listUsersForMessaging, () =>
		$session.data ? {} : 'skip'
	);

	let selectedOtherUserId = $state('');
	let message = $state('');
	let pending = $state(false);
	let errorMessage = $state('');
	let composeOpen = $state(false);
	let sendMessageSearchQuery = $state('');
	let roomSearchQuery = $state('');
	let isDesktopViewport = $state(false);

	$effect(() => {
		if (!browser) return;
		const syncViewport = () => {
			isDesktopViewport = window.innerWidth >= DESKTOP_BREAKPOINT;
		};
		syncViewport();
		window.addEventListener('resize', syncViewport);
		return () => window.removeEventListener('resize', syncViewport);
	});

	const resolveRoomIdFromQuery = (roomParam: string | null, rooms: RoomSummary[]): Id<'rooms'> | null => {
		if (!roomParam) {
			return null;
		}
		return rooms.some((room) => room.roomId === roomParam) ? (roomParam as Id<'rooms'>) : null;
	};

	let selectedRoomId = $derived.by(() =>
		resolveRoomIdFromQuery(page.url.searchParams.get('room'), roomsResponse.data ?? [])
	);
	let activeRoom = $derived((roomsResponse.data ?? []).find((room) => room.roomId === selectedRoomId) ?? null);
	let isDetailView = $derived(Boolean(selectedRoomId));
	let isMobileDetailView = $derived(Boolean(selectedRoomId) && !isDesktopViewport);

	let visibleRooms = $derived.by(() => {
		const query = roomSearchQuery.trim().toLowerCase();
		const rooms = roomsResponse.data ?? [];
		if (!query) return rooms;
		return rooms.filter((room) => {
			const roomName = room.roomName.toLowerCase();
			const preview = (room.lastMessagePreview ?? '').toLowerCase();
			const people = room.participantDisplayNames.join(' ').toLowerCase();
			return roomName.includes(query) || preview.includes(query) || people.includes(query);
		});
	});

	const messagesResponse = useStableQuery(api.chat.listMessages, () =>
		$session.data && selectedRoomId ? { roomId: selectedRoomId, limit: 100 } : 'skip'
	);

	let contactSuggestions = $derived.by(() => {
		const messagingUsers = messagingUsersResponse.data ?? [];
		return messagingUsers.map((user) => ({
			userId: user.userId,
			label: user.displayName
		}));
	});

	let filteredContacts = $derived.by(() => {
		const query = sendMessageSearchQuery.toLowerCase().trim();
		if (!query) return contactSuggestions;
		return contactSuggestions.filter(
			(contact) =>
				contact.label.toLowerCase().includes(query) || contact.userId.toLowerCase().includes(query)
		);
	});

	const initialsFromName = (name: string) =>
		name
			.split(' ')
			.map((part) => part.trim())
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('') || '?';

	const formatRelativeTime = (timestamp: number) => {
		const diff = Date.now() - timestamp;
		if (diff <= 0) return 'now';
		const minutes = Math.floor(diff / 60_000);
		if (minutes < 1) return 'now';
		if (minutes < 60) return `${minutes}m`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h`;
		const days = Math.floor(hours / 24);
		return `${days}d`;
	};

	const formatClockTime = (timestamp: number) =>
		new Date(timestamp).toLocaleTimeString(undefined, {
			hour: 'numeric',
			minute: '2-digit'
		});

	const roomPreviewText = (room: RoomSummary) => {
		const preview = room.lastMessagePreview?.trim();
		if (!preview) {
			return 'No messages yet';
		}
		if (room.isGroupChat && room.participantDisplayNames.length > 0) {
			return `${room.participantDisplayNames[0]}: ${preview}`;
		}
		return preview;
	};

	const unreadBadgeCount = (room: RoomSummary, index: number) => {
		if (!room.lastMessagePreview) return 0;
		const ageInMinutes = Math.floor((Date.now() - room.lastMessageAt) / 60_000);
		if (ageInMinutes <= 15) return 1;
		return index === 0 ? 1 : 0;
	};

	const openRoom = async (roomId: Id<'rooms'>) => {
		const params = new URLSearchParams(page.url.searchParams);
		params.set('room', roomId);
		await goto(`${routes.chat}?${params.toString()}`, { keepFocus: true, noScroll: true });
	};

	const openDirectRoom = async () => {
		if (!selectedOtherUserId.trim()) {
			return;
		}

		pending = true;
		errorMessage = '';
		try {
			const room = await convexClient.mutation(api.chat.getOrCreateDirectRoom, {
				otherUserId: selectedOtherUserId.trim()
			});
			if (room?._id) {
				await openRoom(room._id);
				selectedOtherUserId = '';
				composeOpen = false;
				sendMessageSearchQuery = '';
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to open chat.';
		} finally {
			pending = false;
		}
	};

	const sendMessage = async () => {
		if (!selectedRoomId || !message.trim()) {
			return;
		}

		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.chat.sendMessage, {
				roomId: selectedRoomId,
				content: message.trim()
			});
			message = '';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to send message.';
		} finally {
			pending = false;
		}
	};

	const handleMessageComposerKeydown = (event: KeyboardEvent) => {
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		void sendMessage();
	};

	const showComingSoon = (label: string) => {
		errorMessage = `${label} is not available yet.`;
	};

	let threadMenuItems = $derived([
		{
			id: 'archive',
			label: 'Archive',
			Icon: ArchiveIcon,
			onSelect: () => showComingSoon('Archive')
		},
		{
			id: 'clear',
			label: 'Clear chat',
			Icon: MessageCircleOffIcon,
			separatorBefore: true,
			onSelect: () => showComingSoon('Clear chat')
		},
		{
			id: 'delete',
			label: 'Delete chat',
			Icon: Trash2Icon,
			tone: 'destructive' as const,
			separatorBefore: true,
			onSelect: () => showComingSoon('Delete chat')
		}
	]);

	let chatListMenuItems = $derived([
		{
			id: 'mark-read',
			label: 'Mark all as read',
			onSelect: () => showComingSoon('Mark all as read')
		},
		{
			id: 'mute-all',
			label: 'Mute notifications',
			onSelect: () => showComingSoon('Mute notifications')
		}
	]);
</script>

<PageHeaderBackButton enabled={isMobileDetailView} fallbackHref={routes.chat} />
<PageHeaderTitle title={isMobileDetailView ? (activeRoom?.roomName ?? 'Chat') : 'Chat'} />
<PageHeaderActions>
	{#if !isDesktopViewport}
		{#if isMobileDetailView}
			<ActionMenu
				items={threadMenuItems}
				contentClass="w-44 rounded-xl border border-border/80 p-1 shadow-lg"
			/>
		{:else}
			<div class="flex items-center gap-1">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Start a chat"
					class="text-gray-500 hover:text-gray-700"
					onclick={() => {
						composeOpen = true;
					}}
				>
					<PenLineIcon class="size-5" />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Search chats"
					class="text-gray-500 hover:text-gray-700"
					onclick={() => {
						showComingSoon('Search');
					}}
				>
					<SearchIcon class="size-5" />
				</Button>
			</div>
		{/if}
	{/if}
</PageHeaderActions>

<Sheet bind:open={composeOpen}>
	<SheetContent class="flex max-h-[100dvh] w-full flex-col px-0 py-0 sm:max-h-auto sm:max-w-md">
		<SheetHeader class="border-b border-border/70 px-4 py-3 sm:px-6 sm:py-4">
			<SheetTitle class="text-xl">Send message</SheetTitle>
		</SheetHeader>
		<div class="flex flex-1 flex-col gap-3 overflow-hidden">
			<div class="border-b border-border/70 px-4 py-2 sm:px-6">
				<Button
					variant="outline"
					class="w-full gap-2 text-orange-500"
					onclick={() => {
						showComingSoon('Create group chat');
					}}
				>
					<svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
						<circle cx="9" cy="7" r="4"></circle>
						<path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
						<path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
					</svg>
					Create group chat
				</Button>
			</div>
			<div class="px-4 sm:px-6">
				<Input
					placeholder="Search"
					bind:value={sendMessageSearchQuery}
					class="border-0 bg-[#f5f5f5] px-3 py-2"
				/>
			</div>
			<div class="flex-1 overflow-y-auto">
				<div class="space-y-0">
					{#if messagingUsersResponse.isLoading}
						<div class="px-4 py-4 text-center text-sm text-muted-foreground sm:px-6">
							Loading contacts...
						</div>
					{:else if filteredContacts.length === 0}
						<div class="px-4 py-8 text-center text-sm text-muted-foreground sm:px-6">
							No contacts found
						</div>
					{:else}
						{#each filteredContacts as contact (contact.userId)}
							<button
								type="button"
								class="flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-[#f7f8fc] sm:px-6"
								onclick={() => {
									selectedOtherUserId = contact.userId;
									void openDirectRoom();
								}}
							>
								<Avatar class="size-12 shrink-0 bg-[#d8dbe5]">
									<AvatarFallback class="text-sm font-bold text-slate-700">
										{initialsFromName(contact.label)}
									</AvatarFallback>
								</Avatar>
								<div class="min-w-0 flex-1">
									<p class="truncate text-base font-semibold text-[#2d2d2d]">{contact.label}</p>
									<p class="truncate text-sm text-[#8b8fa0]">{contact.userId}</p>
								</div>
							</button>
						{/each}
					{/if}
				</div>
			</div>
		</div>
	</SheetContent>
</Sheet>

{#if !$session.data}
	<Alert>
		<AlertTitle>Sign in required</AlertTitle>
		<AlertDescription>Sign in to start or view chats.</AlertDescription>
	</Alert>
{:else}
	<div class="-mx-4 flex w-full flex-col overflow-hidden rounded-none bg-white sm:-mx-6 lg:-mx-8 lg:rounded-[1.1rem] lg:border lg:border-border/70">
		{#if errorMessage}
			<div class="px-4 pt-3">
				<Alert variant="destructive">
					<AlertTitle>Chat action failed</AlertTitle>
					<AlertDescription>{errorMessage}</AlertDescription>
				</Alert>
			</div>
		{/if}

		<div class="hidden items-center justify-end gap-3 border-b border-border/70 px-4 py-3 lg:flex">
			<div class="relative w-full max-w-sm">
				<SearchIcon class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#8b8fa0]" />
				<Input
					bind:value={roomSearchQuery}
					placeholder="Search"
					class="h-10 rounded-xl border-0 bg-[#f0f1f5] pr-3 pl-9 text-sm"
				/>
			</div>
			<Button
				class="h-10 rounded-md bg-orange-500 px-4 text-white hover:bg-orange-600"
				onclick={() => {
					composeOpen = true;
				}}
			>
				<PenLineIcon class="size-4" />
				New chat
			</Button>
			<ActionMenu
				items={chatListMenuItems}
				contentClass="w-48 rounded-xl border border-border/80 p-1 shadow-lg"
			/>
		</div>

		<div class="flex min-h-[calc(100dvh-13rem)]">
			<section
				class={`w-full flex-col border-r border-border/70 lg:w-[22rem] ${
					isMobileDetailView ? 'hidden lg:flex' : 'flex'
				}`}
			>
				{#if roomsResponse.isLoading}
					<div class="p-4 text-sm text-muted-foreground">Loading chats...</div>
				{:else if visibleRooms.length === 0}
					<div class="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
						<img
							src={noChatFoundImage}
							alt="No chats found"
							class="size-28 object-contain"
							loading="lazy"
						/>
						<p class="text-xl font-medium text-muted-foreground">No chats yet</p>
						<Button
							variant="ghost"
							class="gap-2 !text-orange-500"
							onclick={() => {
								composeOpen = true;
							}}
						>
							<span class="text-xl leading-none">+</span>
							Send a message
						</Button>
					</div>
				{:else}
					<div class="flex flex-1 flex-col overflow-y-auto">
						{#each visibleRooms as room, index (room.roomId)}
							<button
								type="button"
								class={`flex items-center gap-3 border-b border-border/60 px-3 py-3 text-left transition-colors ${
									selectedRoomId === room.roomId ? 'bg-[#f3f4f9]' : 'hover:bg-[#f7f8fc]'
								}`}
								onclick={() => void openRoom(room.roomId)}
							>
								{#if room.isGroupChat}
									<div class="relative size-11 shrink-0">
										<Avatar class="absolute left-0 top-0 size-8 border border-white bg-[#d8dbe5]">
											<AvatarFallback class="text-[0.6rem] font-bold text-slate-700">
												{initialsFromName(room.participantDisplayNames[0] ?? room.roomName)}
											</AvatarFallback>
										</Avatar>
										<Avatar class="absolute bottom-0 right-0 size-8 border border-white bg-[#d8dbe5]">
											<AvatarFallback class="text-[0.6rem] font-bold text-slate-700">
												{initialsFromName(room.participantDisplayNames[1] ?? room.roomName)}
											</AvatarFallback>
										</Avatar>
									</div>
								{:else}
									<Avatar class="size-11 shrink-0 bg-[#d8dbe5]">
										<AvatarFallback class="text-sm font-bold text-slate-700">
											{initialsFromName(room.roomName)}
										</AvatarFallback>
									</Avatar>
								{/if}

								<div class="min-w-0 flex-1">
									<div class="flex items-start justify-between gap-2">
										<p class="truncate text-[1.08rem] leading-tight font-bold text-[#242424]">
											{room.roomName}
										</p>
										<p class="shrink-0 text-xs text-gray-500">{formatRelativeTime(room.lastMessageAt)}</p>
									</div>
									<div class="mt-1 flex items-center gap-2">
										<p class="min-w-0 flex-1 truncate text-sm text-gray-600">{roomPreviewText(room)}</p>
										{#if index === 0}
											<PinIcon class="size-3.5 text-gray-500" />
										{/if}
										{#if unreadBadgeCount(room, index) > 0}
											<span
												class="inline-flex size-6 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white"
											>
												{unreadBadgeCount(room, index)}
											</span>
										{/if}
									</div>
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</section>

			{#if isDetailView}
				<section class="flex flex-1 flex-col">
					<div class="hidden items-center justify-between border-b border-border/70 bg-white px-4 py-3 lg:flex">
						<div class="flex min-w-0 items-center gap-3">
							<Avatar class="size-10 shrink-0 bg-[#d8dbe5]">
								<AvatarFallback class="text-sm font-bold text-slate-700">
									{initialsFromName(activeRoom?.roomName ?? 'Chat')}
								</AvatarFallback>
							</Avatar>
							<p class="truncate text-[2rem] leading-tight font-bold text-[#242424]">
								{activeRoom?.roomName ?? 'Chat'}
							</p>
						</div>
						<ActionMenu
							items={threadMenuItems}
							contentClass="w-44 rounded-xl border border-border/80 p-1 shadow-lg"
						/>
					</div>

					<div class="flex-1 overflow-y-auto bg-[#f7f7f8] px-3 py-4 sm:px-4">
						{#if messagesResponse.isLoading}
							<p class="text-sm text-muted-foreground">Loading messages...</p>
						{:else if (messagesResponse.data?.length ?? 0) === 0}
							<p class="text-sm text-muted-foreground">No messages yet. Send the first one.</p>
						{:else}
							<p class="mb-3 text-center text-xs font-medium text-[#9da3b3]">Today</p>
							<div class="flex flex-col gap-3">
								{#each messagesResponse.data ?? [] as entry (entry._id)}
									<div class={`flex ${entry.userId === viewer.data?.userId ? 'justify-end' : 'justify-start'}`}>
										<div
											class={`max-w-[85%] rounded-2xl px-3 py-2 ${
												entry.userId === viewer.data?.userId
													? 'bg-[#f5e2d2] text-[#2b2b2b]'
													: 'bg-[#e7e9f3] text-[#2b2b2b]'
											}`}
										>
											{#if entry.mediaUrl}
												<img
													src={entry.mediaUrl}
													alt="Shared media"
													class="mb-2 h-40 w-full rounded-xl object-cover"
													loading="lazy"
												/>
											{/if}
											<p class="text-[1.03rem] leading-6">{entry.content ?? '[Media message]'}</p>
											<p class="mt-1 text-right text-xs text-[#7b8090]">{formatClockTime(entry.createdAt)}</p>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>

					<div class="border-t border-border/70 bg-white px-3 pb-3 pt-2 sm:px-4">
						<Input
							bind:value={message}
							placeholder="Send a message..."
							class="border-0 px-0 text-[1.02rem] shadow-none ring-0 focus-visible:ring-0"
							disabled={pending || !selectedRoomId}
							onkeydown={handleMessageComposerKeydown}
						/>
						<div class="mt-2 flex items-center justify-between">
							<div class="flex items-center gap-4 text-[#7b8090]">
								<button type="button" class="transition-colors hover:text-orange-500" aria-label="Add camera">
									<CameraIcon class="size-5" />
								</button>
								<button type="button" class="transition-colors hover:text-orange-500" aria-label="Add image">
									<ImageIcon class="size-5" />
								</button>
							</div>
							<Button
								variant="ghost"
								size="icon-sm"
								class="text-orange-500 hover:text-orange-600"
								disabled={pending || !selectedRoomId || !message.trim()}
								onclick={() => void sendMessage()}
								aria-label="Send message"
							>
								<SendHorizontalIcon class="size-5" />
							</Button>
						</div>
					</div>
				</section>
			{:else}
				<section class="hidden flex-1 items-center justify-center bg-[#f7f7f8] px-6 lg:flex">
					<p class="text-base text-muted-foreground">Select a chat to view messages.</p>
				</section>
			{/if}
		</div>
	</div>
{/if}
