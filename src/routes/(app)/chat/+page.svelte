<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import SendHorizontalIcon from '@lucide/svelte/icons/send-horizontal';
	import SearchIcon from '@lucide/svelte/icons/search';
	import UsersIcon from '@lucide/svelte/icons/users';
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
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Dialog from '$lib/components/ui/dialog';
	import ReportIssueDialog from '$lib/components/app/report-issue-dialog.svelte';
	import noChatFoundImage from '$lib/assets/images/no_chat_found.png';
	import { useConvexClient } from 'convex-svelte';
	import { requestSignedMediaUrls } from '$lib/media/signed-media.svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { _, formatT, t } from '$lib/i18n';
	import { linkifySegments } from '$lib/domain/linkify';
	import { calendarDaysAgo, formatClockTime, formatShortDate, startOfDay } from '$lib/domain/date';

	type RoomActionState = 'open' | 'action_needed' | 'closed';
	type RoomSummary = {
		roomId: Id<'rooms'>;
		roomName: string;
		// CEO review (CL-695 round 3, item 1): fallback subtitle (the club) shown while the room has
		// no messages yet, for rooms with a 1:1 counterpart — see roomPreviewText below.
		roomSubtitle: string | null;
		contextType: 'club' | 'project' | 'clubApplication' | 'joinRequest';
		contextId: string;
		contextName: string;
		lastMessagePreview: string | null;
		lastMessageAt: number;
		canSend: boolean;
		sendBlockedReason: 'archived' | 'not_participant' | null;
		actionState: RoomActionState;
		/** Last-read feature: messages newer than the viewer's read watermark, capped server-side. */
		unreadCount: number;
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
		/** Only set for messages that have been persisted server-side (reportable). */
		messageId?: Id<'messages'>;
		profileId: Id<'profiles'> | null;
		content: string;
		createdAt: number;
		status?: LocalMessage['status'];
		/** CL-730: set when an admin took this message down from the moderation queue. */
		removedByModeration?: boolean;
		/** CL-695/725 CEO review item B: sender attribution, shown for inbound messages only. */
		senderName?: string | null;
		senderAvatarUrl?: string | null;
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
	// PRD 6.16 (CL-731): within-conversation search. Filters the currently loaded messages
	// only (messages paginate 40 at a time via scroll-to-top), which is noted in the UI.
	let messageSearchQuery = $state('');
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
	// CEO review (CL-695 round 3, item 2): the flicker fix. useStableQuery's keepPreviousData
	// deliberately keeps rendering the PREVIOUS room's result while the newly selected room's
	// subscription is still resolving — good for in-room pagination, wrong here, since neither
	// convex-svelte's `isLoading` nor `isStale` distinguish "args changed because we paginated"
	// from "args changed because the room changed" (both just see different args objects). So each
	// room-identity query now echoes back the `roomId` it answered for, and every derived read below
	// discards the result unless it matches the currently selected room — otherwise the previous
	// room's name/messages/banners would flash before the new room's data arrives.
	let joinRequestInfo = $derived(
		selectedRoomId && joinRequestResponse.data?.roomId === selectedRoomId
			? joinRequestResponse.data
			: null
	);
	let joinRequestActionPending = $state(false);
	let joinRequestActionError = $state('');

	const applicationResponse = useStableQuery(api.clubApplications.getApplicationForRoom, () =>
		$session.data && selectedRoomId && activeRoom?.contextType === 'clubApplication'
			? { roomId: selectedRoomId }
			: 'skip'
	);
	let applicationInfo = $derived(
		selectedRoomId && applicationResponse.data?.roomId === selectedRoomId
			? applicationResponse.data
			: null
	);
	let applicationActionPending = $state(false);
	let applicationActionError = $state('');
	let rejectDialogOpen = $state(false);
	let rejectNote = $state('');
	let followUpDialogOpen = $state(false);
	let followUpReason = $state('');
	// CL-710 CEO review item 2: the applicant's video, surfaced directly in the application chat.
	// Failure is tracked PER URL: the direct URL may 403 (private bucket) before the signed URL
	// arrives, and a boolean flag would keep the player hidden after the good URL lands.
	let applicationVideoFailedUrl = $state<string | null>(null);
	// CL-710 CEO review round 3 (Braga bug): applicationInfo.videoUrl is a direct storage URL that
	// 403s once secure media delivery (CloudFront) is configured, because the bucket is then
	// private. Prefer a signed delivery URL fetched via /api/media/refresh, falling back to the
	// direct URL (works in local dev, where the bucket is public) if signing isn't available.
	// Nothing renders until the signing request settles, so the browser never wastes a request
	// (and an error state) on the direct URL in CDN-enabled environments.
	let applicationSignedVideoUrl = $state<string | null>(null);
	let applicationVideoRequestSettled = $state(false);
	let applicationVideoRequestKey = $state<string | null>(null);

	$effect(() => {
		const info = applicationInfo;
		const assetId = info?.videoMediaAssetId ?? null;
		const applicationId = info?.applicationId ?? null;
		if (!assetId || !applicationId) {
			applicationSignedVideoUrl = null;
			applicationVideoRequestKey = null;
			applicationVideoRequestSettled = true;
			return;
		}

		const requestKey = `${applicationId}:${assetId}`;
		if (applicationVideoRequestKey === requestKey) {
			return;
		}
		applicationVideoRequestKey = requestKey;
		applicationVideoRequestSettled = false;

		void (async () => {
			try {
				const assets = await requestSignedMediaUrls({
					assetIds: [assetId],
					context: { kind: 'club-application', applicationId }
				});
				if (applicationVideoRequestKey !== requestKey) return;
				applicationSignedVideoUrl = assets[0]?.signedUrl ?? null;
			} catch {
				// Secure media delivery isn't configured (local dev) or the request failed — fall back
				// to applicationInfo.videoUrl below rather than surfacing an error for a nice-to-have.
				if (applicationVideoRequestKey !== requestKey) return;
				applicationSignedVideoUrl = null;
			} finally {
				if (applicationVideoRequestKey === requestKey) {
					applicationVideoRequestSettled = true;
				}
			}
		})();
	});

	let applicationVideoUrl = $derived(
		applicationVideoRequestSettled
			? (applicationSignedVideoUrl ?? applicationInfo?.videoUrl ?? null)
			: null
	);

	// CL-695/725 CEO review item A: chat member overview (header highlight + a "view members"
	// dialog), backed by chat.getRoomParticipants.
	const participantsResponse = useStableQuery(api.chat.getRoomParticipants, () =>
		$session.data && selectedRoomId ? { roomId: selectedRoomId } : 'skip'
	);
	// See the flicker-fix comment above joinRequestInfo: only trust this result once its echoed
	// roomId matches the room currently selected.
	let participantsInfo = $derived(
		selectedRoomId && participantsResponse.data?.roomId === selectedRoomId
			? participantsResponse.data
			: null
	);
	let headerParticipant = $derived(
		participantsInfo?.primaryProfileId
			? (participantsInfo.participants.find(
					(participant) => participant.profileId === participantsInfo?.primaryProfileId
				) ?? null)
			: null
	);
	let membersDialogOpen = $state(false);

	// Same staleness guard as above: while the new room's message page is still loading, fall back
	// to empty rather than the previous room's messages (the loading state below covers the gap).
	let isSelectedRoomMessagesFresh = $derived(
		!selectedRoomId || messagesResponse.data?.roomId === selectedRoomId
	);
	let serverMessages = $derived(
		isSelectedRoomMessagesFresh ? (messagesResponse.data?.messages ?? []) : []
	);
	let hasMoreMessages = $derived(
		isSelectedRoomMessagesFresh ? Boolean(messagesResponse.data?.hasMore) : false
	);

	// Last-read feature: while the viewer has a room open, keep their read watermark current.
	// Fires on room open and again whenever the live summaries subscription reports unread
	// messages in the open room (i.e. a new inbound message arrives while it's on screen). Gated
	// on the staleness check so a room is only marked read once its own messages are actually
	// rendered — not while keepPreviousData is still showing the previous room's page.
	$effect(() => {
		const roomId = selectedRoomId;
		if (!roomId || !isSelectedRoomMessagesFresh) return;
		if ((activeRoom?.unreadCount ?? 0) === 0) return;
		convexClient.mutation(api.chat.markRoomRead, { roomId }).catch(() => {
			// Best-effort: a failed watermark write just leaves the badge in place; the effect
			// re-runs on the next summaries update.
		});
	});
	let visibleMessages = $derived.by(() => {
		const serverIds = new Set(serverMessages.map((entry) => entry._id));
		const localEntries = localMessages.filter(
			(entry) =>
				entry.roomId === selectedRoomId && (!entry.serverId || !serverIds.has(entry.serverId))
		);
		const entries: VisibleMessage[] = [
			...serverMessages.map((entry) => ({
				key: entry._id,
				messageId: entry._id,
				profileId: entry.profileId ?? null,
				content: entry.removedByModeration ? t('chat.removedByModeration') : entry.content,
				createdAt: entry._creationTime,
				removedByModeration: Boolean(entry.removedByModeration),
				senderName: entry.senderName ?? null,
				senderAvatarUrl: entry.senderAvatarUrl ?? null
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
	let normalizedMessageSearch = $derived(messageSearchQuery.trim().toLowerCase());
	let isMessageSearching = $derived(normalizedMessageSearch.length > 0);
	let displayedMessages = $derived(
		isMessageSearching
			? visibleMessages.filter((entry) =>
					entry.content.toLowerCase().includes(normalizedMessageSearch)
				)
			: visibleMessages
	);

	const dayLabelFor = (dayStartTimestamp: number) => {
		const daysAgo = calendarDaysAgo(dayStartTimestamp);
		if (daysAgo === 0) return t('chat.todayLabel');
		if (daysAgo === 1) return t('chat.yesterdayLabel');
		return formatShortDate(dayStartTimestamp);
	};

	// Messages grouped by calendar day so each day gets its own separator label (the label used to
	// be a hardcoded "Today" regardless of when the messages were sent).
	let messageGroups = $derived.by(() => {
		const groups: { dayStart: number; messages: VisibleMessage[] }[] = [];
		for (const entry of displayedMessages) {
			const dayStart = startOfDay(entry.createdAt);
			const currentGroup = groups[groups.length - 1];
			if (currentGroup && currentGroup.dayStart === dayStart) {
				currentGroup.messages.push(entry);
			} else {
				groups.push({ dayStart, messages: [entry] });
			}
		}
		return groups;
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
		messageSearchQuery = '';
		messageLimit = INITIAL_MESSAGE_LIMIT;
		shouldStickToBottom = true;
		pendingPrependScrollHeight = null;
		pendingPrependAnchor = null;
		applicationVideoFailedUrl = null;
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

	const roomDisplayName = (room: RoomSummary | null) => {
		if (!room) return 'Chat';
		return room.roomName;
	};

	// When the room has a clear "other party" (a join request's requester, or an application's
	// applicant), surface their name/avatar directly in the header instead of the generic room
	// avatar — this is the concrete fix for "a Guide opens a join request chat and sees zero
	// information about the requester".
	//
	// headerTitleName/headerSubtitle deliberately read from `activeRoom` (sourced from
	// listRoomSummaries, whose args never change on room switch, so it's always up to date for the
	// selected room) rather than waiting on `headerParticipant`/`participantsInfo` (gated on the
	// room-identity staleness check above): listRoomSummaries already returns the same
	// name/club-subtitle pair as this header per the CL-695 round-3 CEO review item 1 fix, so the
	// correct title/subtitle are available immediately on room switch — only the avatar photo
	// depends on the participants query and briefly falls back to initials while it catches up.
	let headerAvatarUrl = $derived(headerParticipant?.avatarUrl ?? null);
	let headerTitleName = $derived(roomDisplayName(activeRoom));
	let headerSubtitle = $derived(activeRoom?.roomSubtitle ?? null);
	let hasParticipantsToShow = $derived((participantsInfo?.participants.length ?? 0) > 0);

	const roomPreviewText = (room: RoomSummary) => {
		const preview = room.lastMessagePreview?.trim();
		if (preview) {
			return preview;
		}
		// CEO review (CL-695 round 3, item 1): before any messages exist, 1:1-like rooms show the
		// club (matching the chat header's subtext) instead of the generic "No messages yet".
		return room.roomSubtitle ?? 'No messages yet';
	};

	// Last-read feature: the summaries query caps unread counting server-side, so anything at or
	// past the cap renders as "99+" (mirrors the notifications bell badge in profile/+page.svelte).
	const formatUnreadBadge = (count: number) => (count > 99 ? '99+' : `${count}`);

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

	const moveToInterviewAction = async () => {
		if (!applicationInfo) return;
		applicationActionPending = true;
		applicationActionError = '';
		try {
			await convexClient.mutation(api.clubApplications.moveToInterview, {
				applicationId: applicationInfo.applicationId
			});
		} catch (error) {
			applicationActionError =
				error instanceof Error ? error.message : t('applicationChat.moveToInterviewFailure');
		} finally {
			applicationActionPending = false;
		}
	};

	const acceptApplicationAction = async () => {
		if (!applicationInfo) return;
		applicationActionPending = true;
		applicationActionError = '';
		try {
			await convexClient.mutation(api.clubApplications.decideApplication, {
				applicationId: applicationInfo.applicationId,
				decision: 'accepted'
			});
		} catch (error) {
			applicationActionError =
				error instanceof Error ? error.message : t('applicationChat.acceptFailure');
		} finally {
			applicationActionPending = false;
		}
	};

	const openRejectDialog = () => {
		rejectNote = '';
		applicationActionError = '';
		rejectDialogOpen = true;
	};

	const confirmRejectApplicationAction = async () => {
		if (!applicationInfo) return;
		applicationActionPending = true;
		applicationActionError = '';
		try {
			await convexClient.mutation(api.clubApplications.decideApplication, {
				applicationId: applicationInfo.applicationId,
				decision: 'rejected',
				rejectionNote: rejectNote.trim() || undefined
			});
			rejectDialogOpen = false;
		} catch (error) {
			applicationActionError =
				error instanceof Error ? error.message : t('applicationChat.rejectFailure');
		} finally {
			applicationActionPending = false;
		}
	};

	const openFollowUpDialog = () => {
		followUpReason = '';
		applicationActionError = '';
		followUpDialogOpen = true;
	};

	const confirmFollowUpFlagAction = async () => {
		if (!applicationInfo) return;
		const reason = followUpReason.trim();
		if (!reason) return;
		applicationActionPending = true;
		applicationActionError = '';
		try {
			await convexClient.mutation(api.clubApplications.setAdminFollowUpFlag, {
				applicationId: applicationInfo.applicationId,
				reason
			});
			followUpDialogOpen = false;
		} catch (error) {
			applicationActionError =
				error instanceof Error ? error.message : t('applicationChat.followUpFailure');
		} finally {
			applicationActionPending = false;
		}
	};
</script>

<PageHeaderBackButton enabled={isMobileDetailView} fallbackHref={routes.chat} />
<PageHeaderTitle title="Chat" />
{#if isMobileDetailView}
	<!-- PRD 6.16: on the mobile conversation view the header search targets the open
	conversation's loaded messages instead of the room list. -->
	<PageHeaderSearch
		bind:value={messageSearchQuery}
		placeholder={t('chat.messageSearchPlaceholder')}
		ariaLabel={t('chat.messageSearchToggle')}
		mode="auto"
	/>
{:else}
	<PageHeaderSearch
		bind:value={roomSearchQuery}
		placeholder="Search chats"
		ariaLabel="Search chats"
		mode="auto"
	/>
{/if}
<PageHeaderTitleContent enabled={isMobileDetailView}>
	<div class="flex min-w-0 items-center gap-3">
		<Avatar class="size-8 shrink-0 bg-gray-200">
			{#if headerAvatarUrl}
				<AvatarImage src={headerAvatarUrl} alt={headerTitleName} />
			{/if}
			<AvatarFallback class="type-caption-bold">
				{initialsFromName(headerTitleName)}
			</AvatarFallback>
		</Avatar>
		<div class="min-w-0">
			<p class="type-h5-bold truncate text-foreground">
				{headerTitleName}
			</p>
			{#if headerSubtitle}
				<p class="type-xs truncate text-muted-foreground">{headerSubtitle}</p>
			{/if}
		</div>
		{#if hasParticipantsToShow}
			<Button
				variant="ghost"
				size="icon-sm"
				class="ml-auto"
				aria-label={t('chat.membersDialogTrigger')}
				onclick={() => (membersDialogOpen = true)}
			>
				<UsersIcon class="size-4" />
			</Button>
		{/if}
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
									selectedRoomId === room.roomId ? 'bg-orange-100' : 'hover:bg-muted'
								}`}
								onclick={() => void openRoom(room.roomId)}
							>
								<Avatar class="size-11 shrink-0 bg-gray-200">
									<AvatarFallback class="type-caption-bold">
										{initialsFromName(room.roomName)}
									</AvatarFallback>
								</Avatar>

								<div class="min-w-0 flex-1">
									<div class="flex items-start justify-between gap-2">
										<p class="type-body-bold truncate text-foreground">
											{roomDisplayName(room)}
										</p>
										<p class="type-sm shrink-0 text-muted-foreground">
											{formatRelativeTime(room.lastMessageAt)}
										</p>
									</div>
									<div class="mt-1 flex items-center gap-2">
										<p
											class={`type-sm min-w-0 flex-1 truncate ${
												room.unreadCount > 0 && selectedRoomId !== room.roomId
													? 'font-semibold text-foreground'
													: 'text-muted-foreground'
											}`}
										>
											{roomPreviewText(room)}
										</p>
										<!-- Last-read feature: unread badge, hidden for the open room (its watermark
										is being advanced by the mark-read effect, so a badge would only flash). -->
										{#if room.unreadCount > 0 && selectedRoomId !== room.roomId}
											<Badge
												size="sm"
												class="shrink-0 border-transparent bg-orange-500 text-white"
												aria-label={formatT('chat.unreadBadgeLabel', {
													count: room.unreadCount
												})}
											>
												{formatUnreadBadge(room.unreadCount)}
											</Badge>
										{/if}
										<!-- CL-695/725 CEO review item E: only call out the states worth a glance —
										nothing rendered for the unremarkable "open, nothing pending" default. -->
										{#if room.actionState === 'action_needed'}
											<Badge
												size="sm"
												class="shrink-0 border-transparent bg-orange-100 text-orange-700"
											>
												{$_('chat.actionNeededBadge')}
											</Badge>
										{:else if room.actionState === 'closed'}
											<Badge size="sm" variant="outline" class="shrink-0 text-muted-foreground">
												{$_('chat.closedBadge')}
											</Badge>
										{/if}
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
						<div class="flex min-w-0 flex-1 items-center gap-3 pr-2">
							<Avatar class="size-8 shrink-0 bg-gray-200">
								{#if headerAvatarUrl}
									<AvatarImage src={headerAvatarUrl} alt={headerTitleName} />
								{/if}
								<AvatarFallback class="type-caption-bold">
									{initialsFromName(headerTitleName)}
								</AvatarFallback>
							</Avatar>
							<div class="min-w-0">
								<p class="type-h5-bold truncate text-foreground">
									{headerTitleName}
								</p>
								{#if headerSubtitle}
									<p class="type-xs truncate text-muted-foreground">{headerSubtitle}</p>
								{/if}
							</div>
							{#if hasParticipantsToShow}
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={t('chat.membersDialogTrigger')}
									onclick={() => (membersDialogOpen = true)}
								>
									<UsersIcon class="size-4" />
								</Button>
							{/if}
						</div>
						<div class="relative w-56 shrink-0">
							<SearchIcon
								class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								type="search"
								bind:value={messageSearchQuery}
								placeholder={t('chat.messageSearchPlaceholder')}
								aria-label={t('chat.messageSearchToggle')}
								class="h-9 pl-9"
							/>
						</div>
					</div>

					<div
						bind:this={messageScrollRef}
						onscroll={handleMessagesScroll}
						class={`min-h-0 flex-1 overflow-y-auto ${
							isDesktopViewport ? 'bg-card px-4 py-4' : 'bg-transparent px-0 py-0'
						}`}
					>
						<div class="flex min-h-full flex-col">
							{#if activeRoom?.contextType === 'clubApplication' && applicationInfo}
								<!-- CL-710 CEO review item 2: the application video, one of the most important
								parts of the application, surfaced directly in the review/interview chat. -->
								{#if applicationVideoUrl && applicationVideoFailedUrl !== applicationVideoUrl}
									<div class={isDesktopViewport ? 'mb-4' : 'mt-4 mb-4'}>
										<p class="type-sm mb-1.5 text-muted-foreground">
											{$_('applicationChat.videoLabel')}
										</p>
										<div
											class="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-900"
										>
											<!-- svelte-ignore a11y_media_has_caption -->
											<video
												src={applicationVideoUrl}
												controls
												preload="metadata"
												class="h-44 w-full object-cover sm:h-52"
												onerror={() => {
													applicationVideoFailedUrl = applicationVideoUrl;
												}}
											></video>
										</div>
									</div>
								{/if}
								{#if applicationInfo.status === 'pending' && applicationInfo.canDecide}
									<!-- CL-695/725 CEO review item D: actions live INSIDE the banner as a compact,
									low-emphasis row instead of large standalone buttons floating above it. -->
									<Alert class={isDesktopViewport ? 'mb-4' : 'mt-4 mb-4'}>
										<AlertTitle>{$_('applicationChat.pendingBannerTitle')}</AlertTitle>
										<AlertDescription
											>{$_('applicationChat.pendingBannerDescription')}</AlertDescription
										>
										<div class="col-start-2 mt-3 flex flex-wrap gap-2">
											<Button
												type="button"
												size="sm"
												variant="secondary"
												disabled={applicationActionPending}
												onclick={() => void moveToInterviewAction()}
											>
												{applicationActionPending
													? $_('applicationChat.movingToInterview')
													: $_('applicationChat.moveToInterviewButton')}
											</Button>
										</div>
									</Alert>
								{:else if applicationInfo.status === 'interview' && applicationInfo.canDecide}
									<Alert class={isDesktopViewport ? 'mb-4' : 'mt-4 mb-4'}>
										<AlertTitle>{$_('applicationChat.interviewBannerTitle')}</AlertTitle>
										<AlertDescription
											>{$_('applicationChat.interviewBannerDescription')}</AlertDescription
										>
										<div class="col-start-2 mt-3 flex flex-wrap gap-2">
											<Button
												type="button"
												size="sm"
												variant="secondary"
												disabled={applicationActionPending}
												onclick={() => void acceptApplicationAction()}
											>
												{applicationActionPending
													? $_('applicationChat.accepting')
													: $_('applicationChat.acceptButton')}
											</Button>
											<Button
												type="button"
												size="sm"
												variant="ghost"
												disabled={applicationActionPending}
												onclick={openRejectDialog}
											>
												{$_('applicationChat.rejectButton')}
											</Button>
										</div>
									</Alert>
								{:else if applicationInfo.status === 'accepted' && applicationInfo.canDecide}
									<Alert class={isDesktopViewport ? 'mb-4' : 'mt-4 mb-4'}>
										<AlertTitle>{$_('applicationChat.acceptedBannerTitle')}</AlertTitle>
										<AlertDescription
											>{$_('applicationChat.acceptedBannerDescription')}</AlertDescription
										>
										<div class="col-start-2 mt-3 flex flex-wrap gap-2">
											<Button
												type="button"
												size="sm"
												variant="ghost"
												disabled={applicationActionPending}
												onclick={openFollowUpDialog}
											>
												{$_('applicationChat.flagFollowUpButton')}
											</Button>
										</div>
									</Alert>
									{#if applicationInfo.adminFollowUpFlag}
										<Alert class={isDesktopViewport ? 'mb-4' : 'mb-4'}>
											<AlertTitle>{$_('applicationChat.followUpFlaggedBanner')}</AlertTitle>
											<AlertDescription>{applicationInfo.adminFollowUpFlag.reason}</AlertDescription
											>
										</Alert>
									{/if}
								{:else if applicationInfo.status === 'interview'}
									<Alert class={isDesktopViewport ? 'mb-4' : 'mt-4 mb-4'}>
										<AlertTitle>{$_('applicationChat.interviewBannerTitle')}</AlertTitle>
										<AlertDescription
											>{$_('applicationChat.interviewBannerDescription')}</AlertDescription
										>
									</Alert>
								{:else if applicationInfo.status === 'accepted'}
									<Alert class={isDesktopViewport ? 'mb-4' : 'mt-4 mb-4'}>
										<AlertTitle>{$_('applicationChat.acceptedBannerTitle')}</AlertTitle>
										<AlertDescription
											>{$_('applicationChat.acceptedBannerDescription')}</AlertDescription
										>
									</Alert>
								{:else if applicationInfo.status === 'rejected'}
									<Alert class={isDesktopViewport ? 'mb-4' : 'mt-4 mb-4'}>
										<AlertTitle>{$_('applicationChat.rejectedBannerTitle')}</AlertTitle>
										<AlertDescription
											>{$_('applicationChat.rejectedBannerDescription')}</AlertDescription
										>
									</Alert>
								{/if}
								{#if applicationActionError}
									<Alert variant="destructive" class="mb-4">
										<AlertDescription>{applicationActionError}</AlertDescription>
									</Alert>
								{/if}
							{:else if activeRoom?.contextType === 'joinRequest' && joinRequestInfo}
								{#if joinRequestInfo.status === 'pending'}
									{#if joinRequestInfo.canDecide}
										<Alert class={isDesktopViewport ? 'mb-4' : 'mt-4 mb-4'}>
											<AlertTitle>
												{formatT('joinRequestChat.pendingBannerTitle', {
													name: joinRequestInfo.requesterName
												})}
											</AlertTitle>
											<AlertDescription
												>{$_('joinRequestChat.pendingBannerDescription')}</AlertDescription
											>
											<div class="col-start-2 mt-3 flex flex-wrap gap-2">
												<Button
													type="button"
													size="sm"
													variant="secondary"
													disabled={joinRequestActionPending}
													onclick={() => void acceptJoinRequestAction()}
												>
													{joinRequestActionPending
														? $_('joinRequestChat.accepting')
														: $_('joinRequestChat.acceptButton')}
												</Button>
												<Button
													type="button"
													size="sm"
													variant="ghost"
													disabled={joinRequestActionPending}
													onclick={() => void declineJoinRequestAction()}
												>
													{joinRequestActionPending
														? $_('joinRequestChat.declining')
														: $_('joinRequestChat.declineButton')}
												</Button>
											</div>
										</Alert>
									{:else if joinRequestInfo.isRequester}
										<Alert class={isDesktopViewport ? 'mb-4' : 'mt-4 mb-4'}>
											<AlertTitle>{$_('joinRequestChat.pendingRequesterBannerTitle')}</AlertTitle>
											<AlertDescription
												>{$_('joinRequestChat.pendingRequesterBannerDescription')}</AlertDescription
											>
											<div class="col-start-2 mt-3 flex">
												<Button
													type="button"
													size="sm"
													variant="ghost"
													disabled={joinRequestActionPending}
													onclick={() => void cancelJoinRequestAction()}
												>
													{joinRequestActionPending
														? $_('joinRequestChat.cancelling')
														: $_('joinRequestChat.cancelButton')}
												</Button>
											</div>
										</Alert>
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

							{#if (!isSelectedRoomMessagesFresh || messagesResponse.isLoading) && visibleMessages.length === 0}
								<LoadingState label="Loading messages" />
							{:else if visibleMessages.length === 0}
								<p class="type-body px-4 text-muted-foreground lg:px-0">
									{activeRoom?.canSend
										? 'No messages yet. Send the first one.'
										: 'No messages yet.'}
								</p>
							{:else}
								{#if isMessageSearching && hasMoreMessages}
									<p class="type-sm mb-3 text-center text-muted-foreground">
										{$_('chat.messageSearchLoadedOnly')}
									</p>
								{:else if messagesResponse.isLoading && visibleMessages.length > 0}
									<p class="type-sm mb-3 text-center text-muted-foreground">
										Loading older messages...
									</p>
								{:else if hasMoreMessages}
									<p class="type-sm mb-3 text-center text-muted-foreground">
										Scroll up to load older messages
									</p>
								{/if}
								{#if isMessageSearching && displayedMessages.length === 0}
									<p class="type-body mt-auto px-4 text-center text-muted-foreground lg:px-0">
										{$_('chat.messageSearchNoMatches')}
									</p>
								{/if}
								<div
									class={`mt-auto flex flex-col ${isDesktopViewport ? 'gap-3' : 'gap-4 pt-4 pb-3'}`}
								>
									{#each messageGroups as group (group.dayStart)}
										<p class="type-sm text-center text-muted-foreground">
											{dayLabelFor(group.dayStart)}
										</p>
										{#each group.messages as entry (entry.key)}
											{#if entry.profileId === null}
												<div data-message-key={entry.key} class="flex justify-center">
													<p
														class="type-sm max-w-[85%] rounded-full bg-gray-100 px-3 py-1 text-center text-muted-foreground"
													>
														{entry.content}
													</p>
												</div>
											{:else}
												{@const isOwnMessage = entry.profileId === viewer.data?._id}
												<div
													data-message-key={entry.key}
													class={`group flex items-end gap-1.5 ${
														isOwnMessage
															? isDesktopViewport
																? 'justify-end'
																: 'justify-end pl-11'
															: isDesktopViewport
																? 'justify-start'
																: 'justify-start pr-11'
													}`}
												>
													{#if !isOwnMessage}
														<!-- CL-695/725 CEO review item B: sender attribution on every inbound
													message, even in a 1:1 chat. Own outgoing messages skip this — obvious. -->
														<Avatar class="size-6 shrink-0 self-end bg-gray-200">
															{#if entry.senderAvatarUrl}
																<AvatarImage
																	src={entry.senderAvatarUrl}
																	alt={entry.senderName ?? ''}
																/>
															{/if}
															<AvatarFallback class="type-caption-bold text-[0.6rem]">
																{initialsFromName(entry.senderName ?? '?')}
															</AvatarFallback>
														</Avatar>
													{/if}
													<!-- The width cap lives on this column wrapper, not the bubble: a capped
													bubble inside an uncapped wrapper leaves dead space beside the bubble whenever
													the message text wraps (the wrapper keeps its unwrapped intrinsic width),
													pushing trailing siblings — the report flag — away from the bubble and
													stranding own messages short of the right edge. -->
													<div
														class={`flex min-w-0 flex-col ${
															isDesktopViewport ? 'max-w-[85%]' : 'max-w-[18.75rem]'
														}`}
													>
														{#if !isOwnMessage && entry.senderName}
															<p class="type-xs px-1 text-muted-foreground">{entry.senderName}</p>
														{/if}
														<div
															class={`${
																isDesktopViewport
																	? 'rounded-2xl px-3 py-2'
																	: 'w-full rounded-[10px] px-[10px] pt-[10px] pb-1'
															} ${
																isOwnMessage
																	? 'bg-orange-100 text-foreground'
																	: 'bg-purple-100 text-foreground'
															}`}
														>
															<p
																class={`break-words ${isDesktopViewport ? 'type-lead' : 'type-body'} ${entry.removedByModeration ? 'italic opacity-70' : ''}`}
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
																class={`text-right text-muted-foreground ${isDesktopViewport ? 'type-sm mt-1' : 'type-caption mt-[2px]'}`}
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
													{#if entry.messageId && !isOwnMessage}
														<!-- The report affordance trails the message (reads left-to-right: sender,
												message, actions) instead of leading it. -->
														<span
															class="opacity-100 transition-opacity lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100"
														>
															<ReportIssueDialog
																targetType="chat_message"
																targetId={entry.messageId}
																contextText={entry.content}
																triggerAriaLabel={$_('reportEntryPoints.chatMessageAction')}
															/>
														</span>
													{/if}
												</div>
											{/if}
										{/each}
									{/each}
								</div>
							{/if}
						</div>
					</div>

					<!-- CL-695/725 CEO review item C: the composer is removed entirely once sending isn't
					possible — the banners above already explain why (archived/removed/decided) — rather
					than staying visible in a disabled state. -->
					{#if selectedRoomId && activeRoom?.canSend}
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
								class={`border-0 bg-clip-padding text-[1.02rem] shadow-none ring-0 [-moz-background-clip:padding] focus-visible:ring-0 ${
									isDesktopViewport ? 'rounded-none px-0' : 'h-10 rounded-[1.1rem] px-4 py-0'
								}`}
								onkeydown={handleMessageComposerKeydown}
							/>
							<div
								class={`flex items-center justify-end text-muted-foreground ${isDesktopViewport ? 'mt-2' : 'px-4 pt-0.5 pb-1.5'}`}
							>
								<!-- Composer send keeps deliberate orange emphasis (primary action of the
								composer) via explicit classes on top of the neutral ghost icon button. -->
								<Button
									variant="ghost"
									size="icon-lg"
									class={`hover:bg-transparent active:bg-transparent ${
										isDesktopViewport
											? 'text-orange-500 hover:text-orange-600'
											: 'text-orange-400 hover:text-orange-500'
									}`}
									disabled={!message.trim()}
									onclick={() => void sendMessage()}
									aria-label="Send message"
								>
									<SendHorizontalIcon class={isDesktopViewport ? 'size-5' : 'size-[1.15rem]'} />
								</Button>
							</div>
						</div>
					{/if}
				</section>
			{:else}
				<section
					class="hidden flex-1 items-center justify-center rounded-[1.1rem] bg-white/65 px-6 shadow-sm ring-1 ring-black/5 lg:flex"
				>
					<div class="max-w-sm text-center">
						<p class="type-h6-bold text-foreground">Select a chat</p>
						<p class="type-body mt-1 text-muted-foreground">
							Choose a club, project, or application chat to view its messages.
						</p>
					</div>
				</section>
			{/if}
		</div>
	</div>

	<Dialog.Root bind:open={rejectDialogOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>{$_('applicationChat.rejectDialogTitle')}</Dialog.Title>
				<Dialog.Description>{$_('applicationChat.rejectDialogDescription')}</Dialog.Description>
			</Dialog.Header>
			<Textarea
				bind:value={rejectNote}
				placeholder={$_('applicationChat.rejectDialogPlaceholder')}
				rows={4}
			/>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (rejectDialogOpen = false)}>
					{$_('applicationChat.cancel')}
				</Button>
				<Button
					variant="destructive"
					disabled={applicationActionPending}
					onclick={() => void confirmRejectApplicationAction()}
				>
					{applicationActionPending
						? $_('applicationChat.rejecting')
						: $_('applicationChat.rejectButton')}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={followUpDialogOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>{$_('applicationChat.followUpDialogTitle')}</Dialog.Title>
				<Dialog.Description>{$_('applicationChat.followUpDialogDescription')}</Dialog.Description>
			</Dialog.Header>
			<Textarea
				bind:value={followUpReason}
				placeholder={$_('applicationChat.followUpDialogPlaceholder')}
				rows={3}
			/>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (followUpDialogOpen = false)}>
					{$_('applicationChat.cancel')}
				</Button>
				<Button
					disabled={applicationActionPending || !followUpReason.trim()}
					onclick={() => void confirmFollowUpFlagAction()}
				>
					{applicationActionPending
						? $_('applicationChat.flaggingFollowUp')
						: $_('applicationChat.flagFollowUpButton')}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<!-- CL-695/725 CEO review item A: the chat member overview affordance. -->
	<Dialog.Root bind:open={membersDialogOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>{$_('chat.membersDialogTitle')}</Dialog.Title>
			</Dialog.Header>
			<div class="flex max-h-80 flex-col gap-3 overflow-y-auto">
				{#each participantsInfo?.participants ?? [] as participant (participant.profileId)}
					<div class="flex items-center gap-3">
						<Avatar class="size-9 shrink-0 bg-gray-200">
							{#if participant.avatarUrl}
								<AvatarImage src={participant.avatarUrl} alt={participant.name} />
							{/if}
							<AvatarFallback class="type-caption-bold">
								{initialsFromName(participant.name)}
							</AvatarFallback>
						</Avatar>
						<div class="min-w-0">
							<p class="type-body-bold truncate text-foreground">{participant.name}</p>
							<p class="type-sm text-muted-foreground">{participant.roleLabel}</p>
						</div>
					</div>
				{/each}
			</div>
		</Dialog.Content>
	</Dialog.Root>
{/if}
