<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { api } from '$convex/_generated/api';
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

	const approve = async () => {
		if (!acceptedPolicies) {
			errorMessage = 'Please agree to the Terms and Privacy Policy before approving.';
			return;
		}
		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.childSignup.approveConsent, {
				token: data.token,
				acceptedTerms: true,
				acceptedPrivacyPolicy: true
			});
			await goto('/auth/sign-in');
		} catch (error) {
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
			<p class="text-sm text-gray-600">Loading consent request...</p>
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

			{#if consentResponse.data.status === 'approved'}
				<Alert>
					<AlertTitle>Already approved</AlertTitle>
					<AlertDescription>This learner account has already been approved.</AlertDescription>
				</Alert>
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
