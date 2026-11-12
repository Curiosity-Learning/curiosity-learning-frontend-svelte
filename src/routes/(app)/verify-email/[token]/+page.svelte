<script lang="ts">
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { LoadingState, PageHeaderTitle } from '$lib/components/app';
	import { showGlobalSnackbar } from '$lib/components/app/snackbar';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { signOutAndGoToSignIn } from '$lib/auth/sign-out';
	import { routes } from '$lib/routes';
	import { t } from '$lib/i18n';

	// CL-768 (review B2): a child confirms the notification email their parent added (or, 16+,
	// added themselves from Settings — CL-769; `addedBySelf` only changes the wording). The link
	// alone proves nothing (whoever owns that inbox can click it), so this page lives in the (app)
	// group — the layout sends signed-out visitors to sign-in and back — and the server only
	// confirms when the CALLER is the child the link was issued for
	// (childEmailVerification.confirmChildEmail). Anyone else signed in gets "different account",
	// without the child's name.
	let token = $derived((page.params as Record<string, string | undefined>).token ?? '');

	const convexClient = useConvexClient();
	const verificationResponse = useStableQuery(
		api.childEmailVerification.getChildEmailVerification,
		() => ({ token })
	);
	let verification = $derived(verificationResponse.data ?? null);

	let confirming = $state(false);
	let confirmed = $state(false);
	let errorMessage = $state<string | null>(null);

	const confirm = async () => {
		if (confirming) return;
		confirming = true;
		errorMessage = null;
		try {
			await convexClient.mutation(api.childEmailVerification.confirmChildEmail, { token });
			confirmed = true;
			showGlobalSnackbar({ title: t('verifyEmail.confirmedSnackbar') });
		} catch {
			errorMessage = t('verifyEmail.failure');
		} finally {
			confirming = false;
		}
	};

	let signingOut = $state(false);
	const signOutAndSwitch = async () => {
		signingOut = true;
		try {
			await signOutAndGoToSignIn(`${routes.verifyEmail}/${token}`);
		} finally {
			signingOut = false;
		}
	};
</script>

<svelte:head>
	<meta name="referrer" content="no-referrer" />
	<meta name="robots" content="noindex" />
</svelte:head>

<PageHeaderTitle title={t('verifyEmail.title')} />

<div class="flex w-full max-w-xl flex-col gap-4 py-4">
	{#if confirmed}
		<Alert>
			<AlertTitle>{t('verifyEmail.confirmedTitle')}</AlertTitle>
			<AlertDescription>{t('verifyEmail.confirmedDescription')}</AlertDescription>
		</Alert>
		<Button class="self-start" href={routes.chat}>{t('verifyEmail.goToChat')}</Button>
	{:else if verificationResponse.error}
		<Alert variant="destructive">
			<AlertTitle>{t('verifyEmail.notFoundTitle')}</AlertTitle>
			<AlertDescription>{t('verifyEmail.failure')}</AlertDescription>
		</Alert>
	{:else if !verification}
		<LoadingState class="min-h-48" label={t('verifyEmail.title')} />
	{:else if verification.status === 'valid'}
		<section class="flex flex-col gap-3 rounded-2xl border border-border/70 bg-white p-4">
			<p class="type-body-bold wrap-anywhere text-foreground">
				{t('verifyEmail.validQuestion').replace('{email}', verification.email ?? '')}
			</p>
			<p class="type-sm text-muted-foreground">
				{t(
					verification.addedBySelf
						? 'verifyEmail.validDescriptionSelf'
						: 'verifyEmail.validDescription'
				).replace('{username}', verification.username ?? '')}
			</p>
			{#if errorMessage}
				<p class="type-sm text-destructive" role="alert">{errorMessage}</p>
			{/if}
			<Button class="self-start" disabled={confirming} onclick={() => void confirm()}>
				{confirming ? t('verifyEmail.confirming') : t('verifyEmail.confirm')}
			</Button>
		</section>
	{:else if verification.status === 'wrongAccount'}
		<Alert class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex flex-col gap-1">
				<AlertTitle>{t('verifyEmail.wrongAccountTitle')}</AlertTitle>
				<AlertDescription>{t('verifyEmail.wrongAccountDescription')}</AlertDescription>
			</div>
			<Button variant="outline" disabled={signingOut} onclick={() => void signOutAndSwitch()}>
				{t('verifyEmail.signOut')}
			</Button>
		</Alert>
	{:else if verification.status === 'used'}
		<Alert>
			<AlertTitle>{t('verifyEmail.usedTitle')}</AlertTitle>
			<AlertDescription>{t('verifyEmail.usedDescription')}</AlertDescription>
		</Alert>
		<Button class="self-start" variant="outline" href={routes.chat}>
			{t('verifyEmail.goToChat')}
		</Button>
	{:else if verification.status === 'expired'}
		<Alert>
			<AlertTitle>{t('verifyEmail.expiredTitle')}</AlertTitle>
			<AlertDescription>
				{t(
					verification.addedBySelf
						? 'verifyEmail.expiredDescriptionSelf'
						: 'verifyEmail.expiredDescription'
				)}
			</AlertDescription>
		</Alert>
		{#if verification.addedBySelf}
			<Button class="self-start" variant="outline" href={routes.settings}>
				{t('verifyEmail.goToSettings')}
			</Button>
		{/if}
	{:else}
		<Alert>
			<AlertTitle>{t('verifyEmail.notFoundTitle')}</AlertTitle>
			<AlertDescription>{t('verifyEmail.notFoundDescription')}</AlertDescription>
		</Alert>
	{/if}
</div>
