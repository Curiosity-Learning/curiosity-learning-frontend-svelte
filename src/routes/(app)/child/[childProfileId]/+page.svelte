<script lang="ts">
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { useConvexClient } from 'convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { LoadingState, PageHeaderTitle } from '$lib/components/app';
	import { authClient } from '$lib/auth-client';
	import { startViewingAsChild, stopViewingAsChild } from '$lib/app/view-as';
	import {
		CHILD_NOTIFICATIONS_ANCHOR,
		CHILD_SETTINGS_EMAILS_VALUE,
		CHILD_SETTINGS_PARAM
	} from '$lib/domain/child-notification-email';
	import { routes } from '$lib/routes';
	import { t } from '$lib/i18n';

	// Parent "View as Child" (CL-801): the entry point emails and sign-in links lead to. It no
	// longer shows a read-only overview; it switches the parent's session into viewing as this
	// child and forwards them into the child's own interface:
	// - `?room=` (a chat email) opens that chat;
	// - `?settings=emails` (the "email settings" links in emails about a child) switches back to
	//   the parent instead and opens the child's card in the parent's own Settings;
	// - anything else (notices, the consent screen's and other sign-in links) opens the child's
	//   home.
	// `via=link` (a sign-in link) is read and stripped by the app layout's "Not your device?"
	// notice, which stays up after this page forwards.
	// When this account is not linked to the child, it explains why and offers to email a sign-in
	// link to the address that approved the child (review S9).

	let childProfileId = $derived(
		(page.params as Record<string, string | undefined>).childProfileId as Id<'profiles'>
	);

	const convexClient = useConvexClient();
	const auth = useAuth();
	const session = authClient.useSession();
	let status = $state<'opening' | 'notLinked' | 'failed'>('opening');

	// Waits for the Convex client's own sign-in: a sign-in link lands here with a full page load,
	// where the session exists before Convex has its token (CL-807).
	let started = false;
	$effect(() => {
		if (started || auth.isLoading || !auth.isAuthenticated) return;
		started = true;
		void open();
	});

	const isNotLinkedError = (error: unknown) => {
		const data = (error as { data?: unknown } | null)?.data;
		const text = typeof data === 'string' ? data : error instanceof Error ? error.message : '';
		return /do not have access|not found/i.test(text);
	};

	const open = async () => {
		const params = page.url.searchParams;
		try {
			if (params.get(CHILD_SETTINGS_PARAM) === CHILD_SETTINGS_EMAILS_VALUE) {
				await stopViewingAsChild(convexClient, {
					to: `${routes.settings}#${CHILD_NOTIFICATIONS_ANCHOR}`,
					replaceState: true
				});
				return;
			}
			// A parent whose consent predates link-at-approval may land here before the link is
			// claimed; claim first so starting the view can find it. Caller-scoped, so harmless.
			await convexClient.mutation(api.parentAccounts.syncParentLinks, {}).catch(() => undefined);
			const roomId = params.get('room');
			await startViewingAsChild(convexClient, childProfileId, {
				to: roomId ? `${routes.chat}?room=${encodeURIComponent(roomId)}` : '/',
				replaceState: true
			});
		} catch (error) {
			status = isNotLinkedError(error) ? 'notLinked' : 'failed';
		}
	};

	// Review S9: signed in as B, but the child was approved under another address A, so this
	// account is not linked. Offer to email a sign-in link to "the address that approved": the
	// server resolves it from the consent and answers the same whether or not one exists, so this
	// page never learns A (requestApprovingAccountSignInLink).
	let approvingLinkState = $state<'idle' | 'sending' | 'requested' | 'rateLimited' | 'failed'>(
		'idle'
	);
	const requestApprovingAccountLink = async () => {
		if (approvingLinkState === 'sending') return;
		approvingLinkState = 'sending';
		try {
			const result = await convexClient.mutation(
				api.parentAccounts.requestApprovingAccountSignInLink,
				{ childProfileId }
			);
			approvingLinkState = result.status;
		} catch {
			approvingLinkState = 'failed';
		}
	};
</script>

<PageHeaderTitle
	title={status === 'opening' ? t('viewAs.opening') : t('parentAccounts.notFoundTitle')}
/>

<div class="flex w-full flex-col gap-4 py-4">
	{#if status === 'notLinked'}
		<Alert variant="destructive">
			<AlertTitle>{t('parentAccounts.notFoundTitle')}</AlertTitle>
			<AlertDescription>{t('parentAccounts.notFoundDescription')}</AlertDescription>
		</Alert>
		<section class="flex flex-col gap-3 rounded-2xl border border-border/70 bg-white p-4">
			<p class="type-sm text-muted-foreground">
				{t('parentAccounts.differentEmailHelp').replace('{email}', $session.data?.user.email ?? '')}
			</p>
			{#if approvingLinkState === 'requested'}
				<p class="type-sm text-foreground" role="status">
					{t('parentAccounts.differentEmailRequested')}
				</p>
			{:else}
				{#if approvingLinkState === 'rateLimited'}
					<p class="type-sm text-destructive" role="alert">
						{t('parentAccounts.differentEmailRateLimited')}
					</p>
				{:else if approvingLinkState === 'failed'}
					<p class="type-sm text-destructive" role="alert">
						{t('parentAccounts.differentEmailFailure')}
					</p>
				{/if}
				<Button
					type="button"
					variant="outline"
					class="self-start"
					disabled={approvingLinkState === 'sending' || approvingLinkState === 'rateLimited'}
					onclick={() => void requestApprovingAccountLink()}
				>
					{t('parentAccounts.differentEmailSend')}
				</Button>
			{/if}
		</section>
	{:else if status === 'failed'}
		<Alert variant="destructive">
			<AlertTitle>{t('viewAs.openFailedTitle')}</AlertTitle>
			<AlertDescription>{t('viewAs.openFailedDescription')}</AlertDescription>
		</Alert>
		<Button href="/" variant="outline" class="w-fit">{t('viewAs.exitAction')}</Button>
	{:else}
		<LoadingState class="min-h-48" label={t('viewAs.opening')} />
	{/if}
</div>
