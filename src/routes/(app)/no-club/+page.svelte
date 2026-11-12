<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ClipboardCheckIcon from '@lucide/svelte/icons/clipboard-check';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import RocketIcon from '@lucide/svelte/icons/rocket';
	import UsersRoundIcon from '@lucide/svelte/icons/users-round';
	import type { Id } from '$convex/_generated/dataModel';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardDescription, CardTitle } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { EmptyState, LoadingState, PageHeaderTitle } from '$lib/components/app';
	import { goto } from '$app/navigation';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { api } from '$convex/_generated/api';
	import { routes } from '$lib/routes';
	import { _ } from '$lib/i18n';
	import myClubImage from '$lib/assets/images/my_club.png';

	// CL-690 CEO review item F: "Applications" must surface BOTH requests to join an existing club
	// and applications to start a new one — previously only Start Club applications were listed, so
	// a user who requested to join a club had no way back to that request's chat from here.
	type ApplicationListItem = {
		kind: 'start' | 'join';
		key: string;
		title: string;
		location: string | null;
		status: string;
		createdAt: number;
		applicationId: string | null;
		roomId: Id<'rooms'> | null;
	};

	const convexClient = useConvexClient();

	// Applicant-side support chat for a still-incomplete application: the room normally only
	// exists from submission onward, so the first "Message us" click creates it on demand
	// (clubApplications.ensureMyApplicationRoom) before opening the chat. Once it exists the
	// item's roomId is set and the regular "Open chat" button takes over.
	let supportChatPending = $state(false);
	let supportChatFailed = $state(false);
	const openSupportChat = async () => {
		supportChatFailed = false;
		supportChatPending = true;
		try {
			const { roomId } = await convexClient.mutation(
				api.clubApplications.ensureMyApplicationRoom,
				{}
			);
			await goto(`${routes.chat}?room=${roomId}`);
		} catch {
			supportChatFailed = true;
		} finally {
			supportChatPending = false;
		}
	};

	const applicationsResponse = useStableQuery(api.clubApplications.listMyApplications, {});
	const joinRequestsResponse = useStableQuery(api.joinRequests.listMyJoinRequests, {});
	// CL-690 CEO review (round 2): this page is reached two ways now — club-less users hitting
	// the onboarding gate, and existing members using the club switcher's "New club" entry (see
	// club-switcher.svelte). Reusing the same lightweight switcher-items query the app shell
	// already subscribes to (`(app)/+layout.svelte`) tells us which case we're in without an
	// extra round trip — convex-svelte multiplexes identical query+args subscriptions, so this
	// piggybacks on the layout's existing data instead of firing a second query.
	const membershipResponse = useStableQuery(api.clubs.getMyClubSwitcherItems, {});
	let hasClubMembership = $derived((membershipResponse.data ?? []).length > 0);
	let isLoading = $derived(applicationsResponse.isLoading || joinRequestsResponse.isLoading);
	let applicationItems = $derived.by((): ApplicationListItem[] => {
		const startApplications = (applicationsResponse.data ?? []).map(
			(application): ApplicationListItem => ({
				kind: 'start',
				key: `start-${application._id}`,
				title: application.name,
				location: application.location ?? null,
				status: application.status,
				createdAt: application.createdAt,
				applicationId: application._id,
				roomId: application.roomId ?? null
			})
		);
		const joinRequestItems = (joinRequestsResponse.data ?? []).map(
			(joinRequest): ApplicationListItem => ({
				kind: 'join',
				key: `join-${joinRequest.joinRequestId}`,
				title: joinRequest.clubName,
				location: null,
				status: joinRequest.status,
				createdAt: joinRequest.createdAt,
				applicationId: null,
				roomId: joinRequest.roomId
			})
		);
		return [...startApplications, ...joinRequestItems].sort((a, b) => b.createdAt - a.createdAt);
	});
	const applicationStatusLabel = (status: string) => {
		switch (status) {
			case 'incomplete':
				return $_('applicationStatus.incompleteLabel');
			case 'interview':
				return $_('applicationStatus.interviewLabel');
			case 'accepted':
				return $_('applicationStatus.acceptedLabel');
			case 'rejected':
				return $_('applicationStatus.rejectedLabel');
			default:
				return $_('applicationStatus.pendingLabel');
		}
	};
	const applicationStatusDescription = (status: string) => {
		switch (status) {
			case 'incomplete':
				return $_('applicationStatus.incompleteDescription');
			case 'interview':
				return $_('applicationStatus.interviewDescription');
			case 'accepted':
				return $_('applicationStatus.acceptedDescription');
			case 'rejected':
				return $_('applicationStatus.rejectedDescription');
			default:
				return $_('applicationStatus.pendingDescription');
		}
	};
	const joinRequestStatusLabel = (status: string) => {
		switch (status) {
			case 'accepted':
				return $_('joinRequestStatus.acceptedLabel');
			case 'declined':
				return $_('joinRequestStatus.declinedLabel');
			case 'cancelled':
				return $_('joinRequestStatus.cancelledLabel');
			default:
				return $_('joinRequestStatus.pendingLabel');
		}
	};
	const joinRequestStatusDescription = (status: string) => {
		switch (status) {
			case 'accepted':
				return $_('joinRequestStatus.acceptedDescription');
			case 'declined':
				return $_('joinRequestStatus.declinedDescription');
			case 'cancelled':
				return $_('joinRequestStatus.cancelledDescription');
			default:
				return $_('joinRequestStatus.pendingDescription');
		}
	};
	const itemStatusLabel = (item: ApplicationListItem) =>
		item.kind === 'start'
			? applicationStatusLabel(item.status)
			: joinRequestStatusLabel(item.status);
	const itemStatusDescription = (item: ApplicationListItem) =>
		item.kind === 'start'
			? applicationStatusDescription(item.status)
			: joinRequestStatusDescription(item.status);
	const itemKindLabel = (item: ApplicationListItem) =>
		item.kind === 'start'
			? $_('noClubApplications.startKindLabel')
			: $_('noClubApplications.joinKindLabel');
	const applicationDateLabel = (timestamp: number | undefined) => {
		if (!timestamp) return null;
		return new Date(timestamp).toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	};
</script>

<PageHeaderTitle title="New club" />

<div class="flex w-full flex-col gap-4 py-4">
	<section
		class="grid overflow-hidden rounded-2xl border border-border/70 bg-white lg:grid-cols-[minmax(0,1fr)_18rem]"
	>
		<div class="flex flex-col justify-center gap-6 p-5 sm:p-6 lg:p-8">
			<div class="flex flex-col gap-2">
				<!-- CL-690 CEO review (round 2): dropped the "No active club" framing outright —
				     existing members land here too (via the switcher's "New club" entry), so the
				     copy is now neutral for them and onboarding-flavored only for club-less users. -->
				{#if hasClubMembership}
					<h1 class="type-h1 text-foreground">Join or start another club</h1>
					<p class="type-lead max-w-2xl text-muted-foreground">
						Browse clubs to join, or send in an application to start a new one.
					</p>
				{:else}
					<h1 class="type-h1 text-foreground">Pick your next Curiosity Club</h1>
					<p class="type-lead max-w-2xl text-muted-foreground">
						Join an existing club or send in an application to start a new club for your community.
					</p>
				{/if}
			</div>

			<div class="grid gap-3 sm:grid-cols-2">
				<Button href={routes.newClubJoin} size="xl" class="h-12 justify-between px-4">
					<span class="inline-flex items-center gap-2">
						<UsersRoundIcon class="size-5" />
						Join a club
					</span>
					<ArrowRightIcon class="size-4" />
				</Button>
				<Button
					href={routes.newClubStart}
					variant="outline"
					size="xl"
					class="h-12 justify-between px-4"
				>
					<span class="inline-flex items-center gap-2">
						<RocketIcon class="size-5" />
						Start a club
					</span>
					<ArrowRightIcon class="size-4" />
				</Button>
			</div>
		</div>

		<div class="hidden items-end justify-center bg-orange-50 px-6 pt-6 lg:flex">
			<img src={myClubImage} alt="" class="h-auto w-full max-w-[15rem] object-contain" />
		</div>
	</section>

	<div>
		<Card class="gap-4 p-5">
			<div class="flex items-center gap-3">
				<div
					class="flex size-11 items-center justify-center rounded-xl bg-orange-50 text-orange-500"
				>
					<ClipboardCheckIcon class="size-5" />
				</div>
				<div class="min-w-0">
					<CardTitle>Applications</CardTitle>
					<CardDescription>{$_('noClubApplications.cardDescription')}</CardDescription>
				</div>
			</div>
			<div class="flex flex-col gap-3">
				{#if isLoading}
					<LoadingState variant="inline" size="sm" label="Loading your applications" />
				{:else if applicationItems.length > 0}
					<div class="flex flex-col divide-y divide-border/70">
						{#each applicationItems as item (item.key)}
							<div class="py-3 first:pt-0 last:pb-0">
								<div class="flex items-start justify-between gap-3">
									<div class="min-w-0">
										<p class="type-body-bold truncate text-foreground">{item.title}</p>
										<p class="type-sm text-muted-foreground">{itemKindLabel(item)}</p>
										{#if item.location}
											<p class="type-sm flex items-center gap-1 text-muted-foreground">
												<MapPinIcon class="size-3.5 shrink-0" />
												<span class="truncate">{item.location}</span>
											</p>
										{/if}
										{#if applicationDateLabel(item.createdAt)}
											<p class="type-sm text-muted-foreground">
												Submitted {applicationDateLabel(item.createdAt)}
											</p>
										{/if}
									</div>
									<Badge variant="outline" class="shrink-0">
										{itemStatusLabel(item)}
									</Badge>
								</div>
								<p class="type-sm mt-1 text-muted-foreground">
									{itemStatusDescription(item)}
								</p>
								{#if item.kind === 'start' && item.status === 'incomplete'}
									<div class="mt-3 flex flex-wrap gap-2">
										<Button href={routes.newClubStartVideo} variant="outline" class="h-9 px-3">
											{$_('noClubApplications.resumeApplication')}
										</Button>
										{#if item.roomId}
											<Button
												href={`${routes.chat}?room=${item.roomId}`}
												variant="outline"
												class="h-9 px-3"
											>
												{$_('noClubApplications.openChat')}
											</Button>
										{:else}
											<Button
												variant="outline"
												class="h-9 px-3"
												disabled={supportChatPending}
												onclick={() => void openSupportChat()}
											>
												{$_('noClubApplications.messageUs')}
											</Button>
										{/if}
									</div>
									{#if supportChatFailed}
										<p class="type-sm mt-2 text-red-600">
											{$_('noClubApplications.messageUsFailure')}
										</p>
									{/if}
								{:else if item.roomId || item.applicationId}
									<div class="mt-3 flex flex-wrap gap-2">
										{#if item.applicationId}
											<Button
												href={routes.applicationReviewDetail(item.applicationId)}
												variant="outline"
												class="h-9 px-3"
											>
												{$_('chatContext.viewApplication')}
											</Button>
										{/if}
										{#if item.roomId}
											<Button
												href={`${routes.chat}?room=${item.roomId}`}
												variant="outline"
												class="h-9 px-3"
											>
												{$_('noClubApplications.openChat')}
											</Button>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<EmptyState bordered={false} title={$_('noClubApplications.emptyState')} />
				{/if}
			</div>
		</Card>
	</div>
</div>
