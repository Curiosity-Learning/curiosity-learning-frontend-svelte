<script lang="ts">
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import type { Id } from '$convex/_generated/dataModel';
	import { api } from '$convex/_generated/api';
	import { authClient } from '$lib/auth-client';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';

	const convexClient = useConvexClient();
	const session = authClient.useSession();

	const viewer = useStableQuery(api.auth.getViewerIdentity, () => ($session.data ? {} : 'skip'));
	const roomsResponse = useStableQuery(api.chat.listRoomSummaries, () =>
		$session.data ? {} : 'skip'
	);

	let selectedRoomId = $state<Id<'rooms'> | null>(null);
	let selectedOtherUserId = $state('');
	let message = $state('');
	let pending = $state(false);
	let errorMessage = $state('');

	const messagesResponse = useStableQuery(api.chat.listMessages, () =>
		$session.data && selectedRoomId ? { roomId: selectedRoomId, limit: 100 } : 'skip'
	);

	$effect(() => {
		const rooms = roomsResponse.data ?? [];
		if (!rooms.length) {
			selectedRoomId = null;
			return;
		}
		if (!selectedRoomId || !rooms.some((room) => room.roomId === selectedRoomId)) {
			selectedRoomId = rooms[0].roomId;
		}
	});

	type ContactSuggestion = { userId: string; label: string };

	const buildContactSuggestions = (
		rooms: Array<{
			participantUserIds: string[];
			participantDisplayNames: string[];
		}>
	): ContactSuggestion[] => {
		const map = new Map<string, string>();
		for (const room of rooms) {
			for (let i = 0; i < room.participantUserIds.length; i++) {
				const userId = room.participantUserIds[i];
				const label = room.participantDisplayNames[i] ?? userId;
				if (!map.has(userId)) {
					map.set(userId, label);
				}
			}
		}
		return [...map.entries()]
			.map(([userId, label]) => ({ userId, label }))
			.sort((a, b) => a.label.localeCompare(b.label));
	};

	let contactSuggestions = $derived(buildContactSuggestions(roomsResponse.data ?? []));

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
				selectedRoomId = room._id;
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
</script>

{#if !$session.data}
	<Alert>
		<AlertTitle>Sign in required</AlertTitle>
		<AlertDescription>Sign in to start or view chats.</AlertDescription>
	</Alert>
{:else}
	<div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
		<Card>
			<CardHeader class="flex flex-col gap-2">
				<CardTitle>Start chat</CardTitle>
				<CardDescription>Open a direct message with another user.</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-3">
				{#if errorMessage}
					<Alert variant="destructive">
						<AlertTitle>Chat error</AlertTitle>
						<AlertDescription>{errorMessage}</AlertDescription>
					</Alert>
				{/if}

				<div class="flex flex-col gap-2">
					<label for="chat-user" class="text-sm font-medium">User ID</label>
					<Input id="chat-user" list="chat-contacts" bind:value={selectedOtherUserId} />
					<datalist id="chat-contacts">
						{#each contactSuggestions as person (person.userId)}
							<option value={person.userId}>{person.label}</option>
						{/each}
					</datalist>
					<p class="text-xs text-muted-foreground">
						Enter a user ID to start or resume a direct room.
					</p>
				</div>
				<Button
					disabled={pending || !selectedOtherUserId.trim()}
					onclick={() => void openDirectRoom()}
				>
					Open direct chat
				</Button>
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="flex flex-col gap-2">
				<CardTitle>Rooms</CardTitle>
				<CardDescription>Your current chat threads.</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-2">
				{#if roomsResponse.isLoading}
					<p class="text-sm text-muted-foreground">Loading rooms...</p>
				{:else if (roomsResponse.data?.length ?? 0) === 0}
					<p class="text-sm text-muted-foreground">No chats yet. Start one from the left panel.</p>
				{:else}
					{#each roomsResponse.data ?? [] as room (room.roomId)}
						<button
							type="button"
							class="flex flex-col gap-1 rounded-md border border-border p-3 text-left"
							onclick={() => {
								selectedRoomId = room.roomId;
							}}
						>
							<div class="flex flex-wrap items-center gap-2">
								<p class="font-medium">{room.roomName}</p>
								{#if selectedRoomId === room.roomId}
									<Badge>Open</Badge>
								{/if}
							</div>
							<p class="text-xs text-muted-foreground">
								{room.lastMessagePreview ?? 'No messages yet'}
							</p>
						</button>
					{/each}
				{/if}
			</CardContent>
		</Card>

		<Card class="xl:col-span-1">
			<CardHeader class="flex flex-col gap-2">
				<CardTitle>Messages</CardTitle>
				<CardDescription>
					{#if selectedRoomId}
						Room {selectedRoomId}
					{:else}
						Select a room to view messages
					{/if}
				</CardDescription>
			</CardHeader>
			<CardContent class="flex h-[28rem] flex-col gap-3">
				<div class="flex flex-1 flex-col gap-2 overflow-y-auto rounded-md border border-border p-3">
					{#if !selectedRoomId}
						<p class="text-sm text-muted-foreground">No room selected.</p>
					{:else if messagesResponse.isLoading}
						<p class="text-sm text-muted-foreground">Loading messages...</p>
					{:else if (messagesResponse.data?.length ?? 0) === 0}
						<p class="text-sm text-muted-foreground">No messages yet. Send the first one.</p>
					{:else}
						{#each messagesResponse.data ?? [] as entry (entry._id)}
							<div
								class={`max-w-[85%] rounded-md border p-2 text-sm ${
									entry.userId === viewer.data?.userId
										? 'ml-auto border-primary/30 bg-primary/10'
										: 'border-border bg-muted/40'
								}`}
							>
								<p>{entry.content ?? '[Media message]'}</p>
							</div>
						{/each}
					{/if}
				</div>
				<div class="flex gap-2">
					<Input
						bind:value={message}
						placeholder="Type a message"
						disabled={!selectedRoomId || pending}
					/>
					<Button
						disabled={pending || !selectedRoomId || !message.trim()}
						onclick={() => void sendMessage()}
					>
						Send
					</Button>
				</div>
			</CardContent>
		</Card>
	</div>
{/if}
