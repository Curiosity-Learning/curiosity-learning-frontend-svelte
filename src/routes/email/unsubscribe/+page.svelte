<script lang="ts">
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { LoadingState } from '$lib/components/app';
	import { Button } from '$lib/components/ui/button';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { _, formatT } from '$lib/i18n';
	import { useConvexClient } from 'convex-svelte';

	// CL-770: the footer link of application reminder emails. Unsubscribing takes a button press,
	// not just opening the page, because mail scanners open links in advance. The token in the
	// link is the credential (emailUnsubscribe.ts), so no sign-in is needed.
	const token = page.url.searchParams.get('t') ?? '';
	const convexClient = useConvexClient();
	const tokenResponse = useStableQuery(api.emailUnsubscribe.describeUnsubscribeToken, () =>
		token ? { token } : 'skip'
	);

	let pending = $state(false);
	let done = $state(false);
	let errorMessage = $state('');

	let details = $derived(tokenResponse.data);
	let unsubscribed = $derived(done || Boolean(details?.alreadyUnsubscribed));

	const confirm = async () => {
		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.emailUnsubscribe.unsubscribe, { token });
			done = true;
		} catch {
			errorMessage = $_('emailUnsubscribe.failure');
		} finally {
			pending = false;
		}
	};
</script>

<svelte:head>
	<meta name="referrer" content="no-referrer" />
	<meta name="robots" content="noindex" />
</svelte:head>

{#if token && tokenResponse.isLoading}
	<LoadingState />
{:else if !token || !details}
	<Alert variant="destructive">
		<AlertTitle>{$_('emailUnsubscribe.invalidTitle')}</AlertTitle>
		<AlertDescription>{$_('emailUnsubscribe.invalidDescription')}</AlertDescription>
	</Alert>
{:else if unsubscribed}
	<div class="flex flex-col gap-2">
		<h1 class="type-step-title text-gray-900">{$_('emailUnsubscribe.doneTitle')}</h1>
		<p class="text-sm leading-6 text-gray-600">
			{formatT('emailUnsubscribe.doneDescription', { email: details.maskedEmail })}
		</p>
	</div>
{:else}
	<div class="flex flex-col gap-2">
		<h1 class="type-step-title text-gray-900">{$_('emailUnsubscribe.title')}</h1>
		<p class="text-sm leading-6 text-gray-600">
			{formatT('emailUnsubscribe.description', { email: details.maskedEmail })}
		</p>
	</div>
	<Button class="h-12 w-full" size="xl" disabled={pending} onclick={confirm}>
		{pending ? $_('emailUnsubscribe.submitting') : $_('emailUnsubscribe.submit')}
	</Button>
	{#if errorMessage}
		<p class="text-sm text-red-600">{errorMessage}</p>
	{/if}
{/if}
