<script lang="ts">
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Avatar, AvatarFallback } from '$lib/components/ui/avatar';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Tabs from '$lib/components/ui/tabs';
	import { LoadingState, PageHeaderBackButton, PageHeaderTitle } from '$lib/components/app';
	import ReportIssueDialog from '$lib/components/app/report-issue-dialog.svelte';
	import { showGlobalSnackbar } from '$lib/components/app/snackbar';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { routes } from '$lib/routes';
	import { t } from '$lib/i18n';
	import { linkifySegments } from '$lib/domain/linkify';
	import { formatClockTime } from '$lib/domain/date';
	import { SIGNED_IN_VIA_LINK_PARAM, SIGNED_IN_VIA_LINK_VALUE } from '$lib/auth/magic-link';
	import { SIGNED_IN_VIA_LINK_STORAGE_KEY } from '$lib/auth/onboarding-state';
	import { signOutAndGoToSignIn } from '$lib/auth/sign-out';
	import {
		FRESH_SESSION_REQUIRED,
		NOTIFICATION_EMAIL_IS_PARENT,
		RESEND_LIMIT_REACHED,
		hasErrorCode
	} from '$lib/domain/child-notification-email';

	// PRD 2.4/6.1.10 (CL-703): "View as Child" — a DEDICATED READ-ONLY SURFACE, not full app
	// impersonation (see parentAccounts.ts module header for the full design note). Every query
	// this page calls is server-verified against a `parentLinks` row between the caller and this
	// child, and computes visibility AS THE CHILD would see it. There is no composer and nothing
	// here acts "as" the child — reporting uses the normal ReportIssueDialog, which submits under
	// the PARENT's own identity. The one write on this page is the parent's own setting for the
	// child (notification email below), which is parent-owned by design: a child cannot consent
	// to receiving email, so the parent does it for them here.

	let childProfileId = $derived(
		(page.params as Record<string, string | undefined>).childProfileId as Id<'profiles'>
	);

	const convexClient = useConvexClient();

	// Fallback claim: parent links are created at consent approval (childSignup.approveConsent),
	// but a parent whose consent predates that has none until syncParentLinks runs — and they can
	// land here straight from a chat email without ever opening Settings. Claim once per mount,
	// alongside the queries below. Once the link row exists, getChildOverview's subscription
	// re-runs by itself (Convex re-runs a failed query when the data it read changes), so the only
	// thing to hold back is the "not linked" alert, until the claim has settled.
	let parentLinksClaimSettled = $state(false);
	onMount(() => {
		void convexClient
			.mutation(api.parentAccounts.syncParentLinks, {})
			.catch(() => {
				// Best-effort: without a claim the overview shows the "not linked" alert as before.
			})
			.finally(() => {
				parentLinksClaimSettled = true;
			});
	});

	// CL-769 (review S4): a parent who signs in from an email link is often on a shared family
	// computer, where the session they leave behind lets the child act as them. Visits that
	// arrived through a sign-in link carry `via=link` (lib/auth/magic-link.ts); it is read once,
	// remembered for this tab, and stripped from the address bar, and the page offers to sign
	// out. sessionStorage, not localStorage: the hint belongs to this visit, not the browser.
	let signedInViaLink = $state(false);
	onMount(() => {
		const viaLink =
			page.url.searchParams.get(SIGNED_IN_VIA_LINK_PARAM) === SIGNED_IN_VIA_LINK_VALUE;
		try {
			if (viaLink) window.sessionStorage.setItem(SIGNED_IN_VIA_LINK_STORAGE_KEY, '1');
			signedInViaLink = window.sessionStorage.getItem(SIGNED_IN_VIA_LINK_STORAGE_KEY) === '1';
		} catch {
			signedInViaLink = viaLink;
		}
		if (viaLink) {
			const url = new URL(page.url);
			url.searchParams.delete(SIGNED_IN_VIA_LINK_PARAM);
			replaceState(`${url.pathname}${url.search}${url.hash}`, {});
		}
	});
	const dismissSignedInViaLink = () => {
		signedInViaLink = false;
		try {
			window.sessionStorage.removeItem(SIGNED_IN_VIA_LINK_STORAGE_KEY);
		} catch {
			// Ignore storage errors.
		}
	};
	let signingOut = $state(false);
	const signOutFromSharedDevice = async () => {
		signingOut = true;
		try {
			await signOutAndGoToSignIn();
		} finally {
			signingOut = false;
		}
	};

	const overviewResponse = useStableQuery(api.parentAccounts.getChildOverview, () => ({
		childProfileId
	}));
	const roomsResponse = useStableQuery(api.parentAccounts.listChildRooms, () => ({
		childProfileId
	}));

	let overview = $derived(overviewResponse.data ?? null);
	let rooms = $derived(roomsResponse.data ?? []);

	// `?room=` is the deep link from a child's chat email, which is delivered to the parent
	// (chat.deliverChatEmailNotification) — it selects that room once the list has loaded, and
	// falls back to the first room when absent or not one of this child's rooms.
	let requestedRoomId = $derived(page.url.searchParams.get('room'));
	// Initial tab only: a deep link opens on the chats tab, later tab changes are the user's.
	// svelte-ignore state_referenced_locally
	let activeTab = $state(requestedRoomId ? 'chats' : 'overview');
	let selectedRoomId = $state<Id<'rooms'> | null>(null);
	$effect(() => {
		if (selectedRoomId && rooms.some((room) => room.roomId === selectedRoomId)) return;
		const requested = rooms.find((room) => room.roomId === requestedRoomId);
		selectedRoomId = requested?.roomId ?? rooms[0]?.roomId ?? null;
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

	// Notification email: where the child's club/project chat (and other non-critical) emails
	// go. Unset, they come to the parent — the chat email itself links here with a nudge to set
	// one (chat.deliverChatEmailNotification). Critical notices keep going to the parent.
	// CL-768 (review B2/B3/S5): a saved address is PENDING until the child confirms it from the
	// emailed link while signed in as themselves; until then emails keep coming to the parent.
	// Every change needs a recent sign-in (the server answers FRESH_SESSION_REQUIRED otherwise),
	// so a session left behind on a shared computer cannot redirect the child's emails.
	let notificationEmail = $derived(overview?.notificationEmail ?? null);
	let notificationEmailConfirmed = $derived(
		notificationEmail !== null && (overview?.notificationEmailVerifiedAt ?? null) !== null
	);
	// Edge case 4: a typo'd address never confirms; after a few days say so.
	const PENDING_STALE_AFTER_DAYS = 3;
	let pendingDays = $derived(
		notificationEmail && !notificationEmailConfirmed && overview?.notificationEmailSetAt
			? Math.floor((Date.now() - overview.notificationEmailSetAt) / (24 * 60 * 60 * 1000))
			: 0
	);
	let editingNotificationEmail = $state(false);
	let notificationEmailDraft = $state('');
	let notificationEmailError = $state<string | null>(null);
	let freshSignInRequired = $state(false);
	let savingNotificationEmail = $state(false);

	const startEditingNotificationEmail = () => {
		notificationEmailDraft = notificationEmail ?? '';
		notificationEmailError = null;
		editingNotificationEmail = true;
	};

	const notificationEmailErrorMessage = (error: unknown) => {
		if (hasErrorCode(error, NOTIFICATION_EMAIL_IS_PARENT)) {
			return t('parentAccounts.notificationEmailIsParent').replace('{name}', displayName);
		}
		if (hasErrorCode(error, RESEND_LIMIT_REACHED)) {
			return t('parentAccounts.notificationEmailResendLimit');
		}
		if (error instanceof Error && /valid email/i.test(error.message)) {
			return t('parentAccounts.notificationEmailInvalid');
		}
		return t('parentAccounts.notificationEmailFailure');
	};

	// `email` null removes the address; the current pending address again is "Resend".
	const submitNotificationEmail = async (email: string | null) => {
		if (savingNotificationEmail) return;
		notificationEmailError = null;
		freshSignInRequired = false;
		savingNotificationEmail = true;
		const isResend = email !== null && email === notificationEmail && !editingNotificationEmail;
		try {
			const result = await convexClient.mutation(api.parentAccounts.setChildNotificationEmail, {
				childProfileId,
				email
			});
			editingNotificationEmail = false;
			if (result.status === 'none') {
				showGlobalSnackbar({ title: t('parentAccounts.notificationEmailRemoved') });
			} else if (result.verificationSent) {
				showGlobalSnackbar({
					title: t(
						isResend
							? 'parentAccounts.notificationEmailResent'
							: 'parentAccounts.notificationEmailSaved'
					).replace('{name}', displayName)
				});
			}
		} catch (error) {
			if (hasErrorCode(error, FRESH_SESSION_REQUIRED)) {
				freshSignInRequired = true;
			} else {
				notificationEmailError = notificationEmailErrorMessage(error);
			}
		} finally {
			savingNotificationEmail = false;
		}
	};

	let signingInAgain = $state(false);
	const signInAgain = async () => {
		signingInAgain = true;
		try {
			await signOutAndGoToSignIn(routes.childOverview(childProfileId));
		} finally {
			signingInAgain = false;
		}
	};
</script>

<PageHeaderBackButton fallbackHref={routes.settings} />
<PageHeaderTitle title={displayName || 'Child overview'} />

<div class="flex w-full flex-col gap-4 py-4">
	{#if signedInViaLink}
		<Alert class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex flex-col gap-1">
				<AlertTitle>{t('parentAccounts.sharedDeviceTitle')}</AlertTitle>
				<AlertDescription>{t('parentAccounts.sharedDeviceDescription')}</AlertDescription>
			</div>
			<div class="flex items-center gap-2">
				<Button variant="ghost" onclick={dismissSignedInViaLink} disabled={signingOut}>
					{t('parentAccounts.sharedDeviceDismiss')}
				</Button>
				<Button
					variant="outline"
					onclick={() => void signOutFromSharedDevice()}
					disabled={signingOut}
				>
					{t('parentAccounts.sharedDeviceSignOut')}
				</Button>
			</div>
		</Alert>
	{/if}

	{#if overviewResponse.error && parentLinksClaimSettled}
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
	{:else if !overview}
		<LoadingState class="min-h-48" label="Loading child overview" />
	{:else if overview}
		<Alert class="flex flex-wrap items-center justify-between gap-3 border-orange-200 bg-orange-50">
			<div class="flex items-center gap-3">
				<Avatar class="size-9 shrink-0 bg-gray-200">
					<AvatarFallback class="type-sm-bold">{initials}</AvatarFallback>
				</Avatar>
				<AlertTitle class="text-orange-900">
					{t('parentAccounts.bannerLabel').replace('{name}', displayName)}
				</AlertTitle>
			</div>
			<a href={routes.settings} class="type-link text-orange-700">
				{t('parentAccounts.exitAction')}
			</a>
		</Alert>

		<Tabs.Root bind:value={activeTab} class="w-full">
			<Tabs.List>
				<Tabs.Trigger value="overview">{t('parentAccounts.overviewTab')}</Tabs.Trigger>
				<Tabs.Trigger value="chats">{t('parentAccounts.chatsTab')}</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content value="overview" class="flex flex-col gap-4">
				<section class="flex flex-col gap-3 rounded-2xl border border-border/70 bg-white p-4">
					<div class="flex flex-col gap-1">
						<div class="flex flex-wrap items-center gap-2">
							<p class="type-body-bold text-foreground">
								{t('parentAccounts.notificationEmailTitle')}
							</p>
							{#if notificationEmailConfirmed && !editingNotificationEmail}
								<Badge variant="secondary">{t('parentAccounts.notificationEmailConfirmed')}</Badge>
							{/if}
						</div>
						{#if notificationEmail && !editingNotificationEmail}
							{#if notificationEmailConfirmed}
								<p class="type-sm text-muted-foreground">
									{t('parentAccounts.notificationEmailCurrent').replace('{name}', displayName)}
									<span class="type-sm-bold text-foreground">{notificationEmail}</span>
								</p>
							{:else}
								<p class="type-sm text-muted-foreground">
									{t('parentAccounts.notificationEmailPending')
										.replace('{name}', displayName)
										.replace('{email}', notificationEmail)}
								</p>
								{#if pendingDays >= PENDING_STALE_AFTER_DAYS}
									<p class="type-sm text-muted-foreground">
										{t('parentAccounts.notificationEmailPendingStale').replace(
											'{days}',
											String(pendingDays)
										)}
									</p>
								{/if}
							{/if}
						{:else}
							<p class="type-sm text-muted-foreground">
								{t('parentAccounts.notificationEmailDescription').replace(/\{name\}/g, displayName)}
							</p>
						{/if}
						<p class="type-sm text-muted-foreground">
							{t('parentAccounts.notificationEmailCriticalNote')}
						</p>
					</div>
					{#if freshSignInRequired}
						<Alert class="flex flex-wrap items-center justify-between gap-3">
							<div class="flex flex-col gap-1">
								<AlertTitle>{t('parentAccounts.notificationEmailFreshSessionTitle')}</AlertTitle>
								<AlertDescription>
									{t('parentAccounts.notificationEmailFreshSession')}
								</AlertDescription>
							</div>
							<Button
								type="button"
								variant="outline"
								disabled={signingInAgain}
								onclick={() => void signInAgain()}
							>
								{t('parentAccounts.notificationEmailSignInAgain')}
							</Button>
						</Alert>
					{/if}
					{#if editingNotificationEmail || !notificationEmail}
						<form
							class="flex flex-col gap-3"
							onsubmit={(event) => {
								event.preventDefault();
								void submitNotificationEmail(notificationEmailDraft);
							}}
						>
							<div class="flex flex-col gap-1.5">
								<Label for="child-notification-email">
									{t('parentAccounts.notificationEmailLabel').replace('{name}', displayName)}
								</Label>
								<Input
									id="child-notification-email"
									type="email"
									autocomplete="off"
									placeholder={t('parentAccounts.notificationEmailPlaceholder')}
									bind:value={notificationEmailDraft}
									disabled={savingNotificationEmail}
									aria-invalid={notificationEmailError ? true : undefined}
								/>
								{#if notificationEmailError}
									<p class="type-sm text-destructive">{notificationEmailError}</p>
								{/if}
							</div>
							<p class="type-sm text-muted-foreground">
								{t('parentAccounts.notificationEmailConsent').replace('{name}', displayName)}
							</p>
							<div class="flex flex-wrap gap-2">
								<Button
									type="submit"
									disabled={savingNotificationEmail || notificationEmailDraft.trim() === ''}
								>
									{t('parentAccounts.notificationEmailSave')}
								</Button>
								{#if editingNotificationEmail}
									<Button
										type="button"
										variant="outline"
										disabled={savingNotificationEmail}
										onclick={() => (editingNotificationEmail = false)}
									>
										{t('parentAccounts.notificationEmailCancel')}
									</Button>
								{/if}
							</div>
						</form>
					{:else}
						{#if notificationEmailError}
							<p class="type-sm text-destructive">{notificationEmailError}</p>
						{/if}
						<div class="flex flex-wrap gap-2">
							{#if !notificationEmailConfirmed}
								<Button
									type="button"
									disabled={savingNotificationEmail}
									onclick={() => void submitNotificationEmail(notificationEmail)}
								>
									{t('parentAccounts.notificationEmailResend')}
								</Button>
							{/if}
							<Button
								type="button"
								variant="outline"
								disabled={savingNotificationEmail}
								onclick={startEditingNotificationEmail}
							>
								{t('parentAccounts.notificationEmailChange')}
							</Button>
							<Button
								type="button"
								variant="ghost"
								disabled={savingNotificationEmail}
								onclick={() => void submitNotificationEmail(null)}
							>
								{t('parentAccounts.notificationEmailRemove')}
							</Button>
						</div>
					{/if}
				</section>

				<section class="flex flex-col gap-3 rounded-2xl border border-border/70 bg-white p-4">
					<p class="type-body-bold text-foreground">{t('parentAccounts.clubsTitle')}</p>
					{#if overview.clubs.length === 0}
						<p class="type-sm text-muted-foreground">{t('parentAccounts.clubsEmpty')}</p>
					{:else}
						<div class="flex flex-wrap gap-2">
							{#each overview.clubs as club (club.clubId)}
								<div
									class="flex items-center gap-2 rounded-full border border-orange-100 bg-orange-50 px-3 py-1.5"
								>
									<span class="type-sm-bold text-orange-600">{club.clubName}</span>
									{#if club.roleName}
										<Badge
											class={club.roleKey === 'guide'
												? 'type-sm rounded-full bg-orange-500 px-2 py-0 text-white'
												: 'type-sm rounded-full bg-orange-100 px-2 py-0 text-orange-700'}
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
					<p class="type-h5-bold text-foreground">
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
					<p class="type-h5-bold text-foreground">
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
					<p class="type-h5-bold text-foreground">
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
							<p class="type-sm p-3 text-muted-foreground">{t('parentAccounts.roomsEmpty')}</p>
						{:else}
							{#each rooms as room (room.roomId)}
								<button
									type="button"
									class={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
										selectedRoomId === room.roomId ? 'bg-orange-100' : 'hover:bg-muted'
									}`}
									onclick={() => (selectedRoomId = room.roomId)}
								>
									<div class="min-w-0 flex-1">
										<p class="type-body-bold truncate text-foreground">{room.roomName}</p>
										{#if room.lastMessagePreview}
											<p class="type-sm truncate text-muted-foreground">
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
							<Button
								variant="link"
								class="type-body-medium mb-2 min-h-10 self-start px-1 text-orange-700 hover:text-orange-800 active:text-orange-800 lg:hidden"
								onclick={() => (selectedRoomId = null)}
							>
								{t('parentAccounts.chatsTab')} &lt;
							</Button>
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
										<div class="min-w-0 flex-1 rounded-2xl bg-purple-100 px-3 py-2">
											<p class="type-body break-words text-foreground">
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
											<p class="type-sm mt-1 text-right text-muted-foreground">
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
