<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import SendHorizontalIcon from '@lucide/svelte/icons/send-horizontal';
	import type { Id } from '$convex/_generated/dataModel';
	import { api } from '$convex/_generated/api';
	import {
		LoadingState,
		PageBottomNavVisibility,
		PageContentMode,
		PageHeaderBackButton,
		PageHeaderSearch,
		PageHeaderTitle,
		PageHeaderTitleContent
	} from '$lib/components/app';
	import { authClient } from '$lib/auth-client';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { routes } from '$lib/routes';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Avatar, AvatarFallback } from '$lib/components/ui/avatar';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import noChatFoundImage from '$lib/assets/images/no_chat_found.png';
	import { useConvexClient } from 'convex-svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { _, t } from '$lib/i18n';
	import { linkifySegments } from '$lib/domain/linkify';

	type RoomSummary = {
		roomId: Id<'rooms'>;
		roomName: string;
		contextType: 'club' | 'project' | 'clubApplication' | 'joinRequest';
		lastMessagePreview: string | null;
		lastMessageAt: number;
		canSend: boolean;
		sendBlockedReason: 'archived' | 'not_participant' | null;
	};
	type LocalMessage = {
		localId: string;
		roomId: Id<'rooms'>;
		profileId: Id<'profiles'> | null;
		content: string;
		createdAt: number;
		status: 'sending' | 'failed';
		serverId?: Id<'messages'>;
	};
	type VisibleMessage = {
		key: string;
		profileId: Id<'profiles'> | null;
		content: string;
		createdAt: number;
		status?: LocalMessage['status'];
	};
	type ScrollAnchor = {
		key: string;
		top: number;
		serverMessageCount: number;
	};

	const DESKTOP_BREAKPOINT = 1024;
	const MAX_MESSAGE_LENGTH = 1_000;
	const INITIAL_MESSAGE_LIMIT = 40;
	const MESSAGE_LIMIT_INCREMENT = 40;
	const TOP_LOAD_THRESHOLD_PX = 960;
	const BOTTOM_STICK_THRESHOLD_PX = 120;

	const convexClient = useConvexClient();
	const session = authClient.useSession();

	const viewer = useStableQuery(api.profiles.getMe, () => ($session.data ? {} : 'skip'));
	const roomsResponse = useStableQuery(api.chat.listRoomSummaries, () =>
		$session.data ? {} : 'skip'
	);

	let message = $state('');
	let errorMessage = $state('');
	let roomSearchQuery = $state('');
	let isDesktopViewport = $state(false);
	let messageInputRef = $state<HTMLInputElement | null>(null);
	let messageScrollRef = $state<HTMLDivElement | null>(null);
	let messageLimit = $state(INITIAL_MESSAGE_LIMIT);
	let selectedRoomForScroll = $state<Id<'rooms'> | null>(null);
	let shouldStickToBottom = $state(true);
	let pendingPrependScrollHeight = $state<number | null>(null);
	let pendingPrependScrollTop = $state(0);
	let pendingPrependAnchor = $state<ScrollAnchor | null>(null);
	let localMessages = $state<LocalMessage[]>([]);
	let localMessageCounter = 0;

	$effect(() => {
		if (!browser) return;
		const syncViewport = () => {
			isDesktopViewport = window.innerWidth >= DESKTOP_BREAKPOINT;
		};
		syncViewport();
		window.addEventListener('resize', syncViewport);
		return () => window.removeEventListener('resize', syncViewport);
	});

	const resolveRoomIdFromQuery = (
		roomParam: string | null,
		rooms: RoomSummary[]
	): Id<'rooms'> | null => {
		if (!roomParam) {
			return null;
		}
		return rooms.some((room) => room.roomId === roomParam) ? (roomParam as Id<'rooms'>) : null;
	};

	let selectedRoomId = $derived.by(() =>
		resolveRoomIdFromQuery(page.url.searchParams.get('room'), roomsResponse.data ?? [])
	);
	let activeRoom = $derived(
		(roomsResponse.data ?? []).find((room) => room.roomId === selectedRoomId) ?? null
	);
	let isDetailView = $derived(Boolean(selectedRoomId));
	let isMobileDetailView = $derived(Boolean(selectedRoomId) && !isDesktopViewport);

	let visibleRooms = $derived.by(() => {
		const query = roomSearchQuery.trim().toLowerCase();
		const rooms = roomsResponse.data ?? [];
		if (!query) return rooms;
		return rooms.filter((room) => {
			const roomName = room.roomName.toLowerCase();
			const preview = (room.lastMessagePreview ?? '').toLowerCase();
			return roomName.includes(query) || preview.includes(query);
		});
	});

	const messagesResponse = useStableQuery(api.chat.listMessages, () =>
		$session.data && selectedRoomId ? { roomId: selectedRoomId, limit: messageLimit } : 'skip'
	);
	const joinRequestResponse = useStableQuery(api.joinRequests.getJoinRequestForRoom, () =>
		$session.data && selectedRoomId && activeRoom?.contextType === 'joinRequest'
			? { roomId: selectedRoomId }
			: 'skip'
	);
	let joinRequestInfo = $derived(joinRequestResponse.data ?? null);
	let joinRequestActionPending = $state(false);
	let joinRequestActionError = $state('');
	let serverMessages = $derived(messagesResponse.data?.messages ?? []);
	let hasMoreMessages = $derived(Boolean(messagesResponse.data?.hasMore));
	let visibleMessages = $derived.by(() => {
		const serverIds = new Set(serverMessages.map((entry) => entry._id));
		const localEntries = localMessages.filter(
			(entry) =>
				entry.roomId === selectedRoomId && (!entry.serverId || !serverIds.has(entry.serverId))
		);
		const entries: VisibleMessage[] = [
			...serverMessages.map((entry) => ({
				key: entry._id,
				profileId: entry.profileId,
				content: entry.content,
				createdAt: entry._creationTime
			})),
			...localEntries.map((entry) => ({
				key: entry.localId,
				profileId: entry.profileId,
				content: entry.content,
				createdAt: entry.createdAt,
				status: entry.status
			}))
		];

		return entries.sort((left, right) => left.createdAt - right.createdAt);
	});

	$effect(() => {
		const serverIds = new Set(serverMessages.map((entry) => entry._id));
		const nextLocalMessages = localMessages.filter(
			(entry) => !entry.serverId || !serverIds.has(entry.serverId)
		);
		if (nextLocalMessages.length !== localMessages.length) {
			localMessages = nextLocalMessages;
		}
	});

	$effect(() => {
		if (selectedRoomForScroll === selectedRoomId) return;
		selectedRoomForScroll = selectedRoomId;
		messageLimit = INITIAL_MESSAGE_LIMIT;
		shouldStickToBottom = true;
		pendingPrependScrollHeight = null;
		pendingPrependAnchor = null;
	});

	$effect(() => {
		const messageCount = visibleMessages.length;
		const serverMessageCount = serverMessages.length;
		const loading = messagesResponse.isLoading;
		const scrollElement = messageScrollRef;
		const prependScrollHeight = pendingPrependScrollHeight;
		const prependScrollTop = pendingPrependScrollTop;
		const prependAnchor = pendingPrependAnchor;
		const stickToBottom = shouldStickToBottom;
		if (!browser || !scrollElement || loading) return;
		if (
			prependScrollHeight !== null &&
			serverMessageCount <= (prependAnchor?.serverMessageCount ?? 0)
		) {
			return;
		}

		requestAnimationFrame(() => {
			if (prependScrollHeight !== null) {
				const anchorElement = prependAnchor
					? getMessageElements(scrollElement).find(
							(element) => element.dataset.messageKey === prependAnchor.key
						)
					: null;
				if (anchorElement && prependAnchor) {
					const containerTop = scrollElement.getBoundingClientRect().top;
					const nextTop = anchorElement.getBoundingClientRect().top - containerTop;
					scrollElement.scrollTop += nextTop - prependAnchor.top;
				} else {
					scrollElement.scrollTop =
						scrollElement.scrollHeight - prependScrollHeight + prependScrollTop;
				}
				pendingPrependScrollHeight = null;
				pendingPrependAnchor = null;
				return;
			}

			if (stickToBottom && messageCount > 0) {
				scrollElement.scrollTop = scrollElement.scrollHeight;
			}
		});
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

	const roomDisplayName = (room: RoomSummary | null) => {
		if (!room) return 'Chat';
		return room.roomName;
	};

	const roomPreviewText = (room: RoomSummary) => {
		const preview = room.lastMessagePreview?.trim();
		if (!preview) {
			return 'No messages yet';
		}
		return preview;
	};

	const openRoom = async (roomId: Id<'rooms'>) => {
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.set('room', roomId);
		await goto(`${routes.chat}?${params.toString()}`, { keepFocus: true, noScroll: true });
	};

	const focusMessageInput = () => {
		if (!browser) return;
		requestAnimationFrame(() => messageInputRef?.focus());
	};

	const getMessageElements = (scrollElement: HTMLDivElement) =>
		Array.from(scrollElement.querySelectorAll<HTMLElement>('[data-message-key]'));

	const getFirstVisibleMessageAnchor = (scrollElement: HTMLDivElement): ScrollAnchor | null => {
		const containerTop = scrollElement.getBoundingClientRect().top;
		const firstVisibleMessage = getMessageElements(scrollElement).find(
			(element) => element.getBoundingClientRect().bottom > containerTop
		);
		if (!firstVisibleMessage?.dataset.messageKey) return null;
		return {
			key: firstVisibleMessage.dataset.messageKey,
			top: firstVisibleMessage.getBoundingClientRect().top - containerTop,
			serverMessageCount: serverMessages.length
		};
	};

	const loadOlderMessages = () => {
		const scrollElement = messageScrollRef;
		if (
			!scrollElement ||
			messagesResponse.isLoading ||
			!hasMoreMessages ||
			pendingPrependScrollHeight !== null
		) {
			return;
		}
		pendingPrependScrollHeight = scrollElement.scrollHeight;
		pendingPrependScrollTop = scrollElement.scrollTop;
		pendingPrependAnchor = getFirstVisibleMessageAnchor(scrollElement);
		shouldStickToBottom = false;
		messageLimit += MESSAGE_LIMIT_INCREMENT;
	};

	const handleMessagesScroll = () => {
		const scrollElement = messageScrollRef;
		if (!scrollElement) return;

		const distanceFromBottom =
			scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
		shouldStickToBottom = distanceFromBottom <= BOTTOM_STICK_THRESHOLD_PX;

		if (scrollElement.scrollTop <= TOP_LOAD_THRESHOLD_PX) {
			loadOlderMessages();
		}
	};

	const sendMessage = async () => {
		const targetRoomId = selectedRoomId;
		const trimmedMessage = message.trim();
		if (!targetRoomId || !trimmedMessage || !activeRoom?.canSend) {
			return;
		}

		const localId = `${Date.now()}-${(localMessageCounter += 1)}`;
		localMessages = [
			...localMessages,
			{
				localId,
				roomId: targetRoomId,
				profileId: viewer.data?._id ?? null,
				content: trimmedMessage,
				createdAt: Date.now(),
				status: 'sending'
			}
		];
		message = '';
		errorMessage = '';
		shouldStickToBottom = true;
		focusMessageInput();

		try {
			const sentMessage = await convexClient.mutation(api.chat.sendMessage, {
				roomId: targetRoomId,
				content: trimmedMessage
			});
			localMessages = localMessages.map((entry) =>
				entry.localId === localId && sentMessage?._id
					? { ...entry, status: 'sending', serverId: sentMessage._id }
					: entry
			);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to send message.';
			localMessages = localMessages.map((entry) =>
				entry.localId === localId ? { ...entry, status: 'failed' } : entry
			);
		}
	};

	const handleMessageComposerKeydown = (event: KeyboardEvent) => {
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		void sendMessage();
	};

	const acceptJoinRequestAction = async () => {
		if (!joinRequestInfo) return;
		joinRequestActionPending = true;
		joinRequestActionError = '';
		try {
			await convexClient.mutation(api.joinRequests.acceptJoinRequest, {
				joinRequestId: joinRequestInfo.joinRequestId
			});
		} catch (error) {
			joinRequestActionError =
				error instanceof Error ? error.message : t('joinRequestChat.acceptFailure');
		} finally {
			joinRequestActionPending = false;
		}
	};

	const declineJoinRequestAction = async () => {
		if (!joinRequestInfo) return;
		joinRequestActionPending = true;
		joinRequestActionError = '';
		try {
			await convexClient.mutation(api.joinRequests.declineJoinRequest, {
				joinRequestId: joinRequestInfo.joinRequestId
			});
		} catch (error) {
			joinRequestActionError =
				error instanceof Error ? error.message : t('joinRequestChat.declineFailure');
		} finally {
			joinRequestActionPending = false;
		}
	};

	const cancelJoinRequestAction = async () => {
		if (!joinRequestInfo) return;
		joinRequestActionPending = true;
		joinRequestActionError = '';
		try {
			await convexClient.mutation(api.joinRequests.cancelJoinRequest, {
				joinRequestId: joinRequestInfo.joinRequestId
			});
		} catch (error) {
			joinRequestActionError =
				error instanceof Error ? error.message : t('joinRequestChat.cancelFailure');
		} finally {
			joinRequestActionPending = false;
		}
	};
</script>

<PageHeaderBackButton enabled={isMobileDetailView} fallbackHref={routes.chat} />
<PageHeaderTitle title="Chat" />
<PageHeaderSearch
	bind:value={roomSearchQuery}
	placeholder="Search chats"
	ariaLabel="Search chats"
	mode="auto"
	enabled={!isMobileDetailView}
/>
<PageHeaderTitleContent enabled={isMobileDetailView}>
	<div class="flex min-w-0 items-center gap-3">
		<Avatar class="size-8 shrink-0 bg-[#d8dbe5]">
			<AvatarFallback class="text-[0.68rem] font-bold text-slate-700">
				{initialsFromName(roomDisplayName(activeRoom))}
			</AvatarFallback>
		</Avatar>
		<p class="truncate text-[1.25rem] leading-6 font-bold text-[#191919]">
			{roomDisplayName(activeRoom)}
		</p>
	</div>
</PageHeaderTitleContent>
<PageBottomNavVisibility hidden={isMobileDetailView} />
<PageContentMode mode="viewport" />

{#if !$session.data}
	<Alert>
		<AlertTitle>Sign in required</AlertTitle>
		<AlertDescription>Sign in to view chats.</AlertDescription>
	</Alert>
{:else}
	<div class="flex min-h-0 w-full flex-1 flex-col gap-4">
		{#if errorMessage}
			<Alert variant="destructive">
				<AlertTitle>Chat action failed</AlertTitle>
				<AlertDescription>{errorMessage}</AlertDescription>
			</Alert>
		{/if}

		<div class="flex min-h-0 flex-1 gap-4 overflow-hidden">
			<section
				class={`min-h-0 w-full flex-col overflow-hidden lg:w-[22rem] ${
					isMobileDetailView
						? 'hidden lg:flex'
						: 'flex rounded-[1.1rem] bg-white/85 shadow-sm ring-1 ring-black/5'
				}`}
			>
				{#if roomsResponse.isLoading}
					<LoadingState class="flex-1" label="Loading chats" />
				{:else if visibleRooms.length === 0}
					<div
						class="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center"
					>
						<img
							src={noChatFoundImage}
							alt="No chats found"
							class="size-28 object-contain"
							loading="lazy"
						/>
						<p class="text-lg font-medium text-muted-foreground sm:text-xl">No chats yet</p>
						<p class="max-w-xs text-sm text-muted-foreground">
							Chats appear automatically when you join a club, project, or application flow.
						</p>
					</div>
				{:else}
					<div class="flex flex-1 flex-col gap-1 overflow-y-auto p-1.5">
						{#each visibleRooms as room (room.roomId)}
							<button
								type="button"
								class={`flex items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${
									selectedRoomId === room.roomId ? 'bg-[#f5e2d2]' : 'hover:bg-[#f7f3ee]'
								}`}
								onclick={() => void openRoom(room.roomId)}
							>
								<Avatar class="size-11 shrink-0 bg-[#d8dbe5]">
									<AvatarFallback class="text-[0.72rem] font-bold text-slate-700">
										{initialsFromName(room.roomName)}
									</AvatarFallback>
								</Avatar>

								<div class="min-w-0 flex-1">
									<div class="flex items-start justify-between gap-2">
										<p
											class="truncate text-[1rem] leading-tight font-bold text-[#242424] sm:text-[1.08rem]"
										>
											{roomDisplayName(room)}
										</p>
										<p class="shrink-0 text-xs text-gray-500">
											{formatRelativeTime(room.lastMessageAt)}
										</p>
									</div>
									<div class="mt-1 flex items-center gap-2">
										<p class="min-w-0 flex-1 truncate text-[0.82rem] text-gray-600 sm:text-sm">
											{roomPreviewText(room)}
										</p>
									</div>
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</section>

			{#if isDetailView}
				<section
					class={`min-h-0 flex-1 flex-col overflow-hidden ${
						isDesktopViewport
							? 'flex rounded-[1.1rem] bg-white/85 shadow-sm ring-1 ring-black/5'
							: 'flex'
					}`}
				>
					<div class="hidden items-center border-b border-border/60 px-4 py-3 lg:flex">
						<div class="flex min-w-0 flex-1 items-center gap-4 pr-2">
							<Avatar class="size-8 shrink-0 bg-[#d8dbe5]">
								<AvatarFallback class="text-[0.72rem] font-bold text-slate-700">
									{initialsFromName(roomDisplayName(activeRoom))}
								</AvatarFallback>
							</Avatar>
							<p class="truncate text-[1.25rem] leading-6 font-bold text-[#191919]">
								{roomDisplayName(activeRoom)}
							</p>
						</div>
					</div>

					<div
						bind:this={messageScrollRef}
						onscroll={handleMessagesScroll}
						class={`min-h-0 flex-1 overflow-y-auto ${
							isDesktopViewport ? 'bg-[#fbfaf8] px-4 py-4' : 'bg-transparent px-0 py-0'
						}`}
					>
						<div class="flex min-h-full flex-col">
							{#if activeRoom?.contextType === 'joinRequest' && joinRequestInfo}
								{#if joinRequestInfo.status === 'pending'}
									{#if joinRequestInfo.canDecide}
										<div class={`flex gap-2 ${isDesktopViewport ? 'mb-4' : 'mt-4 mb-4'}`}>
											<Button
												type="button"
												disabled={joinRequestActionPending}
												onclick={() => void acceptJoinRequestAction()}
											>
												{joinRequestActionPending
													? $_('joinRequestChat.accepting')
													: $_('joinRequestChat.acceptButton')}
											</Button>
											<Button
												type="button"
												variant="outline"
												disabled={joinRequestActionPending}
												onclick={() => void declineJoinRequestAction()}
											>
												{joinRequestActionPending
													? $_('joinRequestChat.declining')
													: $_('joinRequestChat.declineButton')}
											</Button>
										</div>
									{:else if joinRequestInfo.isRequester}
										<div class={`flex ${isDesktopViewport ? 'mb-4' : 'mt-4 mb-4'}`}>
											<Button
												type="button"
												variant="outline"
												disabled={joinRequestActionPending}
												onclick={() => void cancelJoinRequestAction()}
											>
												{joinRequestActionPending
													? $_('joinRequestChat.cancelling')
													: $_('joinRequestChat.cancelButton')}
											</Button>
										</div>
									{/if}
								{:else}
									<Alert class={isDesktopViewport ? 'mb-4' : 'mt-4 mb-4'}>
										<AlertTitle>
											{#if joinRequestInfo.status === 'accepted'}
												{$_('joinRequestChat.acceptedBanner')}
											{:else if joinRequestInfo.status === 'declined'}
												{$_('joinRequestChat.declinedBanner')}
											{:else}
												{$_('joinRequestChat.cancelledBanner')}
											{/if}
										</AlertTitle>
										<AlertDescription>
											{$_('joinRequestChat.requesterCancelledDescription')}
										</AlertDescription>
									</Alert>
								{/if}
								{#if joinRequestActionError}
									<Alert variant="destructive" class={isDesktopViewport ? 'mb-4' : 'mb-4'}>
										<AlertDescription>{joinRequestActionError}</AlertDescription>
									</Alert>
								{/if}
							{:else if activeRoom && !activeRoom.canSend && activeRoom.sendBlockedReason === 'archived'}
								<Alert class={isDesktopViewport ? 'mb-4' : 'mt-4 mb-4'}>
									<AlertTitle>{$_('chatCore.archivedBannerTitle')}</AlertTitle>
									<AlertDescription>{$_('chatCore.archivedBannerDescription')}</AlertDescription>
								</Alert>
							{:else if activeRoom && !activeRoom.canSend && activeRoom.sendBlockedReason === 'not_participant'}
								<Alert class={isDesktopViewport ? 'mb-4' : 'mt-4 mb-4'}>
									<AlertTitle>{$_('chatCore.notParticipantBannerTitle')}</AlertTitle>
									<AlertDescription>
										{$_('chatCore.notParticipantBannerDescription')}
									</AlertDescription>
								</Alert>
							{:else if activeRoom && !activeRoom.canSend}
								<Alert class={isDesktopViewport ? 'mb-4' : 'mt-4 mb-4'}>
									<AlertTitle>{$_('chatCore.readOnlyBannerTitle')}</AlertTitle>
									<AlertDescription>{$_('chatCore.readOnlyBannerDescription')}</AlertDescription>
								</Alert>
							{/if}

							{#if messagesResponse.isLoading && visibleMessages.length === 0}
								<LoadingState label="Loading messages" />
							{:else if visibleMessages.length === 0}
								<p class="px-4 text-sm text-muted-foreground lg:px-0">
									{activeRoom?.canSend
										? 'No messages yet. Send the first one.'
										: 'No messages yet.'}
								</p>
							{:else}
								{#if messagesResponse.isLoading && visibleMessages.length > 0}
									<p class="mb-3 text-center text-xs text-muted-foreground">
										Loading older messages...
									</p>
								{:else if hasMoreMessages}
									<p class="mb-3 text-center text-xs text-muted-foreground">
										Scroll up to load older messages
									</p>
								{/if}
								<p
									class={`mt-auto text-center text-xs font-normal text-[#838799] ${isDesktopViewport ? 'mb-3' : 'mt-4 mb-4'}`}
								>
									Today
								</p>
								<div class={`flex flex-col ${isDesktopViewport ? 'gap-3' : 'gap-4 pb-3'}`}>
									{#each visibleMessages as entry (entry.key)}
										<div
											data-message-key={entry.key}
											class={`flex ${
												entry.profileId === viewer.data?._id
													? isDesktopViewport
														? 'justify-end'
														: 'justify-end pl-11'
													: isDesktopViewport
														? 'justify-start'
														: 'justify-start pr-11'
											}`}
										>
											<div
												class={`${
													isDesktopViewport
														? 'max-w-[85%] rounded-2xl px-3 py-2'
														: 'w-full max-w-[18.75rem] rounded-[10px] px-[10px] pt-[10px] pb-1'
												} ${
													entry.profileId === viewer.data?._id
														? 'bg-[#f5e2d2] text-[#2b2b2b]'
														: 'bg-[#e7e9f3] text-[#2b2b2b]'
												}`}
											>
												<p
													class={`break-words ${isDesktopViewport ? 'text-[1.03rem] leading-6' : 'text-[14px] leading-6'}`}
												>
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
												</p>
												<p
													class={`text-right text-[#6b6f80] ${isDesktopViewport ? 'mt-1 text-xs' : 'mt-[2px] text-[10px] leading-4'}`}
												>
													{#if entry.status === 'sending'}
														Sending...
													{:else if entry.status === 'failed'}
														Failed to send
													{:else}
														{formatClockTime(entry.createdAt)}
													{/if}
												</p>
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>

					<div
						class={`shrink-0 bg-white/90 ${
							isDesktopViewport
								? 'border-t border-border/60 px-3 pt-2 pb-3 sm:px-4'
								: 'rounded-[1.1rem] bg-clip-padding shadow-sm ring-1 ring-black/5 [-moz-background-clip:padding]'
						}`}
					>
						<Input
							bind:ref={messageInputRef}
							bind:value={message}
							placeholder="Send a message..."
							maxlength={MAX_MESSAGE_LENGTH}
							class={`border-0 bg-clip-padding text-[1.02rem] shadow-none ring-0 focus-visible:ring-0 [-moz-background-clip:padding] ${
								isDesktopViewport ? 'rounded-none px-0' : 'h-10 rounded-[1.1rem] px-4 py-0'
							}`}
							disabled={!selectedRoomId || !activeRoom?.canSend}
							onkeydown={handleMessageComposerKeydown}
						/>
						<div
							class={`flex items-center justify-end text-[#7b8090] ${isDesktopViewport ? 'mt-2' : 'px-4 pt-0.5 pb-1.5'}`}
						>
							<button
								type="button"
								class={`grid size-8 place-items-center transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
									isDesktopViewport
										? 'text-orange-500 hover:text-orange-600'
										: 'text-orange-400 hover:text-orange-500'
								}`}
								disabled={!selectedRoomId || !activeRoom?.canSend || !message.trim()}
								onclick={() => void sendMessage()}
								aria-label="Send message"
							>
								<SendHorizontalIcon class={isDesktopViewport ? 'size-5' : 'size-[1.15rem]'} />
							</button>
						</div>
					</div>
				</section>
			{:else}
				<section
					class="hidden flex-1 items-center justify-center rounded-[1.1rem] bg-white/65 px-6 shadow-sm ring-1 ring-black/5 lg:flex"
				>
					<div class="max-w-sm text-center">
						<p class="text-base font-semibold text-[#242424]">Select a chat</p>
						<p class="mt-1 text-sm text-muted-foreground">
							Choose a club, project, or application chat to view its messages.
						</p>
					</div>
				</section>
			{/if}
		</div>
	</div>
{/if}
