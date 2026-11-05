<script lang="ts">
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { SIGNED_IN_VIA_LINK_PARAM, SIGNED_IN_VIA_LINK_VALUE } from '$lib/auth/magic-link';
	import { SIGNED_IN_VIA_LINK_STORAGE_KEY } from '$lib/auth/onboarding-state';
	import { signOutAndGoToSignIn } from '$lib/auth/sign-out';
	import { t } from '$lib/i18n';

	// CL-769 (review S4): a parent who signs in from an email link is often on a shared family
	// computer, where the session they leave behind lets the child act as them. Visits that
	// arrived through a sign-in link carry `via=link` (lib/auth/magic-link.ts); it is read once,
	// remembered for this tab, and stripped from the address bar, and the app offers to sign out.
	// sessionStorage, not localStorage: the hint belongs to this visit, not the browser. Lives in
	// the app layout (CL-734) because a sign-in link can land on any page, not just the child's.

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

	const dismiss = () => {
		signedInViaLink = false;
		try {
			window.sessionStorage.removeItem(SIGNED_IN_VIA_LINK_STORAGE_KEY);
		} catch {
			// Ignore storage errors.
		}
	};

	let signingOut = $state(false);
	const signOut = async () => {
		signingOut = true;
		try {
			await signOutAndGoToSignIn();
		} finally {
			signingOut = false;
		}
	};
</script>

{#if signedInViaLink}
	<Alert class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex flex-col gap-1">
			<AlertTitle>{t('parentAccounts.sharedDeviceTitle')}</AlertTitle>
			<AlertDescription>{t('parentAccounts.sharedDeviceDescription')}</AlertDescription>
		</div>
		<div class="flex items-center gap-2">
			<Button variant="ghost" onclick={dismiss} disabled={signingOut}>
				{t('parentAccounts.sharedDeviceDismiss')}
			</Button>
			<Button variant="outline" onclick={() => void signOut()} disabled={signingOut}>
				{t('parentAccounts.sharedDeviceSignOut')}
			</Button>
		</div>
	</Alert>
{/if}
