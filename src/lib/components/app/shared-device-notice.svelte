<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { replaceUrlAfterRouterStart } from '$lib/navigation/replace-url';
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
	// the app layout (CL-801) because a sign-in link can land on any page, and /child/[id] now
	// forwards straight into the child's view.

	let signedInViaLink = $state(false);
	onMount(() => {
		try {
			signedInViaLink = window.sessionStorage.getItem(SIGNED_IN_VIA_LINK_STORAGE_KEY) === '1';
		} catch {
			// Storage unavailable: only a `via=link` arrival (below) shows the notice.
		}
	});
	// afterNavigate sees every arrival, including the first page load; on that one the router is
	// not started yet, so the address bar is rewritten a task later (replaceUrlAfterRouterStart).
	afterNavigate(({ to }) => {
		const url = to?.url;
		if (url?.searchParams.get(SIGNED_IN_VIA_LINK_PARAM) !== SIGNED_IN_VIA_LINK_VALUE) return;
		signedInViaLink = true;
		try {
			window.sessionStorage.setItem(SIGNED_IN_VIA_LINK_STORAGE_KEY, '1');
		} catch {
			// The notice still shows for this page view.
		}
		const cleaned = new URL(url);
		cleaned.searchParams.delete(SIGNED_IN_VIA_LINK_PARAM);
		const pathname = cleaned.pathname;
		replaceUrlAfterRouterStart(
			`${cleaned.pathname}${cleaned.search}${cleaned.hash}`,
			() => window.location.pathname === pathname
		);
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
