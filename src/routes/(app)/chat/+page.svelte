<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import ImageIcon from '@lucide/svelte/icons/image';
	import MessageCircleOffIcon from '@lucide/svelte/icons/message-circle-off';
	import PenLineIcon from '@lucide/svelte/icons/pen-line';
	import PinIcon from '@lucide/svelte/icons/pin';
	import SearchIcon from '@lucide/svelte/icons/search';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import type { Id } from '$convex/_generated/dataModel';
	import { api } from '$convex/_generated/api';
	import { ActionMenu, PageHeaderActions, PageHeaderBackButton, PageHeaderTitle } from '$lib/components/app';
	import { authClient } from '$lib/auth-client';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { routes } from '$lib/routes';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Avatar, AvatarFallback } from '$lib/components/ui/avatar';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { useConvexClient } from 'convex-svelte';
	import noChatFoundImage from '$lib/assets/images/no_chat_found.png';
	import { Sheet, SheetContent, SheetHeader, SheetTitle } from '$lib/components/ui/sheet';

	type RoomSummary = {
		roomId: Id<'rooms'>;
		roomName: string;
		isGroupChat: boolean;
		participantUserIds: string[];
		participantDisplayNames: string[];
		lastMessagePreview: string | null;
		lastMessageAt: number;
	};

	type ContactSuggestion = { userId: string; label: string };

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

	const messagesResponse = useStableQuery(api.chat.listMessages, () =>
		$session.data && selectedRoomId ? { roomId: selectedRoomId, limit: 100 } : 'skip'
	);

	const buildContactSuggestions = (
		rooms: Array<{
			participantUserIds: string[];
			participantDisplayNames: string[];
		}>
	): ContactSuggestion[] => {
		const labelsByUserId: Record<string, string> = {};
		for (const room of rooms) {
			for (let i = 0; i < room.participantUserIds.length; i++) {
				const userId = room.participantUserIds[i];
				const label = room.participantDisplayNames[i] ?? userId;
				if (!(userId in labelsByUserId)) {
					labelsByUserId[userId] = label;
				}
			}
		}
		return Object.entries(labelsByUserId)
			.map(([userId, label]) => ({ userId, label }))
			.sort((a, b) => a.label.localeCompare(b.label));
	};

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
</script>

<PageHeaderBackButton enabled={isDetailView} fallbackHref={routes.chat} />
<PageHeaderTitle title={isDetailView ? (activeRoom?.roomName ?? 'Chat') : 'Chat'} />
<PageHeaderActions>
	{#if isDetailView}
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
					composeOpen = !composeOpen;
				}}
			>
				<PenLineIcon class="size-5" />
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Search chats"
				class="text-gray-500 hover:text-gray-700"
			>
				<SearchIcon class="size-5" />
			</Button>
		</div>
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
						// TODO: Implement create group chat
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
	<div class="-mx-4 flex w-full flex-col gap-3 rounded-none border-0 bg-white px-4 py-0 sm:-mx-6 sm:rounded-[1.1rem] sm:border sm:border-border/70 sm:px-0 lg:-mx-8 lg:px-8">
		{#if errorMessage}
			<div class="px-0 pt-3 sm:px-3">
				<Alert variant="destructive">
					<AlertTitle>Chat action failed</AlertTitle>
					<AlertDescription>{errorMessage}</AlertDescription>
				</Alert>
			</div>
		{/if}

		{#if !isDetailView}
			{#if roomsResponse.isLoading}
				<div class="p-4 text-sm text-muted-foreground">Loading chats...</div>
			{:else if (roomsResponse.data?.length ?? 0) === 0}
				<div class="flex flex-col items-center justify-center gap-4 py-20 text-center">
					<img
						src={noChatFoundImage}
						alt="No chats found"
						class="size-32 object-contain"
						loading="lazy"
					/>
					<p class="text-2xl font-medium text-muted-foreground">No chats yet</p>
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
				<div class="flex max-h-[calc(100dvh-20rem)] flex-col overflow-y-auto sm:max-h-[72dvh]">
					{#each roomsResponse.data ?? [] as room, index (room.roomId)}
						<button
							type="button"
							class="flex items-center gap-3 border-b border-border/60 px-3 py-3 text-left transition-colors hover:bg-[#f7f8fc]"
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
									<p class="min-w-0 flex-1 truncate text-base text-gray-600">{roomPreviewText(room)}</p>
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
		{:else}
			<div class="flex min-h-[calc(100dvh-14rem)] flex-col sm:h-[calc(100dvh-17rem)] sm:min-h-[30rem]">
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
							size="sm"
							disabled={pending || !selectedRoomId || !message.trim()}
							onclick={() => void sendMessage()}
						>
							Send
						</Button>
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}
