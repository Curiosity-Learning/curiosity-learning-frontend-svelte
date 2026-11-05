<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { LoadingState } from '$lib/components/app';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { captureUnexpectedOperationalError } from '$lib/monitoring/capture';
	import { api } from '$convex/_generated/api';
	import { authClient } from '$lib/auth-client';
	import { _, formatT } from '$lib/i18n';
	import { useConvexClient } from 'convex-svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const convexClient = useConvexClient();
	const consentResponse = useStableQuery(api.childSignup.getConsentByToken, () => ({
		token: data.token
	}));
	let pending = $state(false);
	let errorMessage = $state('');
	let acceptedPolicies = $state(false);
	// Set once THIS visit approved the request. Takes precedence over the (reactively updated)
	// "already approved" status, and carries the one-time sign-in link approveConsent returns
	// only for the approval itself.
	let approval = $state<{ signInUrl?: string } | null>(null);
	// Following the sign-in link replaces whatever session this browser has.
	const session = authClient.useSession();

	let childName = $derived(
		consentResponse.data?.childUsername ?? $_('onboarding.parentConsent.childFallback')
	);
	let childSignInHref = $derived(
		consentResponse.data
			? `/auth/sign-in?next=${encodeURIComponent(`/child/${consentResponse.data.childProfileId}`)}`
			: '/auth/sign-in'
	);
	let signsOutOtherAccount = $derived(
		Boolean(
			$session.data?.user &&
			$session.data.user.email.toLowerCase() !== consentResponse.data?.parentEmail?.toLowerCase()
		)
	);

	const approve = async () => {
		if (!acceptedPolicies) {
			errorMessage = 'Please agree to the Terms and Privacy Policy before approving.';
			return;
		}
		pending = true;
		errorMessage = '';
		try {
			approval = await convexClient.mutation(api.childSignup.approveConsent, {
				token: data.token,
				acceptedTerms: true,
				acceptedPrivacyPolicy: true
			});
		} catch (error) {
			captureUnexpectedOperationalError(error, {
				area: 'auth',
				operation: 'parent-consent:approve'
			});
			errorMessage = error instanceof Error ? error.message : 'Unable to approve this account.';
		} finally {
			pending = false;
		}
	};
</script>

<FlowShell
	step={1}
	total={1}
	showAccountLink={false}
	showProgressBar={false}
	showSideIllustration={true}
>
	<div class="mx-auto flex w-full max-w-[28.75rem] flex-1 flex-col gap-6">
		{#if consentResponse.isLoading}
			<LoadingState label="Loading consent request" />
		{:else if !consentResponse.data}
			<Alert variant="destructive">
				<AlertTitle>Consent link not found</AlertTitle>
				<AlertDescription>This consent link is invalid or has expired.</AlertDescription>
			</Alert>
		{:else}
			<div class="flex flex-col gap-3">
				<h1 class="type-step-title text-gray-900">Approve learner account</h1>
				<p class="text-base leading-7 text-gray-600">
					{consentResponse.data.childUsername ?? 'A learner'} wants to use Curiosity Learning. Approving
					this verifies your email consent and activates their account.
				</p>
			</div>

			{#if approval}
				<Alert>
					<AlertTitle>{$_('onboarding.parentConsent.approvedTitle')}</AlertTitle>
					<AlertDescription>
						{formatT('onboarding.parentConsent.approvedDescription', { child: childName })}
					</AlertDescription>
				</Alert>
				<div class="mt-auto flex flex-col gap-3 pb-2 sm:pb-6">
					{#if approval.signInUrl}
						<!-- The /auth/link interstitial (30-minute link, token in the fragment): its button
						calls Better Auth's verify endpoint, which sets the session cookie and redirects
						to the child's overview. -->
						<Button class="h-12 w-full" size="xl" href={approval.signInUrl}>
							{formatT('onboarding.parentConsent.signInButton', { child: childName })}
						</Button>
						<p class="text-sm leading-6 text-gray-600">
							{formatT('onboarding.parentConsent.signInAs', {
								email: consentResponse.data.parentEmail
							})}
							{#if signsOutOtherAccount}
								{$_('onboarding.parentConsent.signOutWarning')}
							{/if}
						</p>
					{:else}
						<Button class="h-12 w-full" size="xl" href={childSignInHref}>
							{formatT('onboarding.parentConsent.signInLink', { child: childName })}
						</Button>
					{/if}
				</div>
			{:else if consentResponse.data.status === 'approved'}
				<Alert>
					<AlertTitle>Already approved</AlertTitle>
					<AlertDescription>This learner account has already been approved.</AlertDescription>
				</Alert>
				<a class="text-sm font-semibold text-primary underline" href={childSignInHref}>
					{formatT('onboarding.parentConsent.signInLink', { child: childName })}
				</a>
			{:else}
				{#if errorMessage}
					<Alert variant="destructive">
						<AlertTitle>Unable to approve</AlertTitle>
						<AlertDescription>{errorMessage}</AlertDescription>
					</Alert>
				{/if}

				<label class="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4">
					<input
						type="checkbox"
						bind:checked={acceptedPolicies}
						class="mt-1 size-4 rounded border-gray-300"
					/>
					<span class="text-sm leading-6 text-gray-700">
						I am this learner's parent or guardian, and I agree to the
						<a class="font-semibold text-primary underline" href="/terms" target="_blank">Terms</a>
						and
						<a class="font-semibold text-primary underline" href="/privacy" target="_blank">
							Privacy Policy
						</a>
						for this learner's Curiosity Learning account.
					</span>
				</label>

				<div class="mt-auto pb-2 sm:pb-6">
					<Button
						class="h-12 w-full"
						size="xl"
						disabled={pending || !acceptedPolicies}
						onclick={() => void approve()}
					>
						{pending ? 'Approving...' : 'Approve account'}
					</Button>
				</div>
			{/if}
		{/if}
	</div>
</FlowShell>
