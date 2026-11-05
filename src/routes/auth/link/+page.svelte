<script lang="ts">
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { _, formatT } from '$lib/i18n';
	import {
		buildMagicLinkVerifyPath,
		parseMagicLinkInterstitialFragment,
		type MagicLinkInterstitial
	} from '$lib/auth/magic-link';

	// Interstitial for every sign-in link we email or show (review S1; see lib/auth/magic-link.ts):
	// the token sits in the URL fragment, which never reaches a server, and the verify endpoint —
	// which consumes the token and creates the session — is only called when a person presses the
	// button. Mail scanners GET the page but neither run its script nor press anything.
	let link = $state<MagicLinkInterstitial | null>(null);
	let ready = $state(false);
	let pending = $state(false);

	onMount(() => {
		link = parseMagicLinkInterstitialFragment(window.location.hash);
		ready = true;
		// Drop the token from the address bar and from this history entry once read.
		if (window.location.hash) {
			replaceState(page.url.pathname, {});
		}
	});

	const continueSignIn = () => {
		if (!link) return;
		pending = true;
		// A full navigation: the verify endpoint answers with the session cookie and a redirect
		// to `next` (or, for an expired or used link, to the sign-in page's "Send me a new link").
		window.location.assign(buildMagicLinkVerifyPath(link));
	};
</script>

<svelte:head>
	<meta name="referrer" content="no-referrer" />
	<meta name="robots" content="noindex" />
</svelte:head>

{#if ready}
	{#if link}
		<div class="flex flex-col gap-4">
			<div class="flex flex-col gap-2">
				<h1 class="type-step-title text-gray-900">
					{link.as
						? formatT('auth.signInLink.title', { email: link.as })
						: $_('auth.signInLink.titleNoEmail')}
				</h1>
				<p class="text-sm leading-6 text-gray-600">{$_('auth.signInLink.description')}</p>
			</div>
			<Button class="h-12 w-full" size="xl" disabled={pending} onclick={continueSignIn}>
				{pending ? $_('auth.signInLink.submitting') : $_('auth.signInLink.submit')}
			</Button>
			<p class="text-sm leading-6 text-gray-600">{$_('auth.signInLink.notYou')}</p>
		</div>
	{:else}
		<div class="flex flex-col gap-4">
			<Alert>
				<AlertTitle>{$_('auth.signInLink.invalidTitle')}</AlertTitle>
				<AlertDescription>{$_('auth.signInLink.invalidDescription')}</AlertDescription>
			</Alert>
			<Button class="h-12 w-full" size="xl" variant="outline" href="/auth/sign-in">
				{$_('auth.signInLink.goToSignIn')}
			</Button>
		</div>
	{/if}
{/if}
