<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Field, FieldError, FieldLabel } from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { LoadingState } from '$lib/components/app';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { captureUnexpectedOperationalError } from '$lib/monitoring/capture';
	import { api } from '$convex/_generated/api';
	import { authClient } from '$lib/auth-client';
	import { _, formatT, locale, t } from '$lib/i18n';
	import { NOTIFICATION_EMAIL_IS_PARENT, hasErrorCode } from '$lib/domain/child-notification-email';
	import { useConvexClient } from 'convex-svelte';
	import { ConvexError } from 'convex/values';
	import type { PageProps } from './$types';

	// Consent screen v2 (CL-769, review S12/D8/D9, edge cases 1 and 8): one combined checkbox
	// for the child's account and the parent's own, where the child's emails go, then a success
	// screen with a 30-minute sign-in link.

	let { data }: PageProps = $props();
	const convexClient = useConvexClient();
	const consentResponse = useStableQuery(api.childSignup.getConsentByToken, () => ({
		token: data.token
	}));
	let pending = $state(false);
	let errorMessage = $state('');
	let acceptedPolicies = $state(false);
	let routing = $state<'parent' | 'child'>('parent');
	let childEmail = $state('');
	// Server-side refusal of the typed address, shown under the field.
	let childEmailServerError = $state('');
	// Set once THIS visit approved the request. Takes precedence over the (reactively updated)
	// "already approved" status, and carries the one-time sign-in link approveConsent returns
	// only for the approval itself.
	let approval = $state<{
		signInUrl?: string;
		childEmail?: string;
		parentAccountCreated?: boolean;
	} | null>(null);
	// Following the sign-in link replaces whatever session this browser has (edge case 8).
	const session = authClient.useSession();

	let parentEmail = $derived(consentResponse.data?.parentEmail ?? '');
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
			$session.data?.user && $session.data.user.email.toLowerCase() !== parentEmail.toLowerCase()
		)
	);

	let trimmedChildEmail = $derived(childEmail.trim());
	// Edge case 1, client side (the server refuses it too).
	let childEmailIsParent = $derived(
		routing === 'child' &&
			trimmedChildEmail !== '' &&
			trimmedChildEmail.toLowerCase() === parentEmail.toLowerCase()
	);
	let childEmailError = $derived(
		childEmailIsParent ? $_('onboarding.parentConsent.childEmailIsParent') : childEmailServerError
	);
	let canApprove = $derived(
		acceptedPolicies &&
			!pending &&
			(routing === 'parent' || (trimmedChildEmail !== '' && !childEmailIsParent))
	);

	// The agreement sentence with the Terms / Privacy Policy placeholders turned into links.
	let agreementParts = $derived(
		formatT('onboarding.parentConsent.agreement', { child: childName, parentEmail })
			.split(/(\{terms\}|\{privacy\})/)
			.filter((part) => part !== '')
	);

	const approve = async () => {
		if (!acceptedPolicies) {
			errorMessage = t('onboarding.parentConsent.acceptRequired');
			return;
		}
		pending = true;
		errorMessage = '';
		childEmailServerError = '';
		try {
			approval = await convexClient.mutation(api.childSignup.approveConsent, {
				token: data.token,
				acceptedTerms: true,
				acceptedPrivacyPolicy: true,
				childEmail: routing === 'child' ? trimmedChildEmail : undefined,
				locale: $locale
			});
		} catch (error) {
			if (hasErrorCode(error, NOTIFICATION_EMAIL_IS_PARENT)) {
				childEmailServerError = t('onboarding.parentConsent.childEmailIsParent');
			} else if (error instanceof ConvexError && routing === 'child') {
				// The only other user error with an address chosen is its format.
				childEmailServerError = t('onboarding.parentConsent.childEmailInvalid');
			} else {
				captureUnexpectedOperationalError(error, {
					area: 'auth',
					operation: 'parent-consent:approve'
				});
				errorMessage = t('onboarding.parentConsent.genericError');
			}
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
			<LoadingState label={$_('onboarding.parentConsent.loading')} />
		{:else if !consentResponse.data}
			<Alert variant="destructive">
				<AlertTitle>{$_('onboarding.parentConsent.notFoundTitle')}</AlertTitle>
				<AlertDescription>{$_('onboarding.parentConsent.notFoundDescription')}</AlertDescription>
			</Alert>
		{:else if approval}
			<!-- Screen 2: done. -->
			<div class="flex flex-col gap-3">
				<h1 class="type-step-title text-gray-900">
					{formatT('onboarding.parentConsent.doneTitle', { child: childName })}
				</h1>
				<p class="text-base leading-7 text-gray-600">
					{formatT(
						approval.parentAccountCreated === false
							? 'onboarding.parentConsent.doneParentAccountLinked'
							: 'onboarding.parentConsent.doneParentAccountCreated',
						{ child: childName, parentEmail }
					)}
				</p>
				{#if approval.childEmail}
					<p class="text-base leading-7 text-gray-600">
						{formatT('onboarding.parentConsent.doneChildEmail', {
							child: childName,
							childEmail: approval.childEmail
						})}
					</p>
				{/if}
			</div>
			<div class="mt-auto flex flex-col gap-3 pb-2 sm:pb-6">
				{#if approval.signInUrl}
					<!-- The /auth/link interstitial (30-minute link, token in the fragment): its button
					calls Better Auth's verify endpoint, which sets the session cookie and redirects to
					the child's overview. -->
					<Button class="h-12 w-full" size="xl" href={approval.signInUrl}>
						{formatT('onboarding.parentConsent.signInButton', { child: childName })}
					</Button>
					<p class="text-sm leading-6 text-gray-600">
						{formatT('onboarding.parentConsent.signInFinePrint', { parentEmail })}
						{#if signsOutOtherAccount}
							<span class="font-semibold text-gray-900">
								{$_('onboarding.parentConsent.otherSessionWarning')}
							</span>
						{/if}
					</p>
				{:else}
					<Button class="h-12 w-full" size="xl" href={childSignInHref}>
						{formatT('onboarding.parentConsent.signInLink', { child: childName })}
					</Button>
				{/if}
				<p class="text-sm leading-6 text-gray-600">
					{formatT('onboarding.parentConsent.closePage', { child: childName })}
				</p>
			</div>
		{:else if consentResponse.data.status === 'approved'}
			<!-- Revisit: no sign-in link (the approved token never expires), just the sign-in page. -->
			<Alert>
				<AlertTitle>{$_('onboarding.parentConsent.alreadyTitle')}</AlertTitle>
				<AlertDescription>
					{formatT('onboarding.parentConsent.alreadyDescription', { child: childName })}
				</AlertDescription>
			</Alert>
			<a class="text-sm font-semibold text-primary underline" href={childSignInHref}>
				{formatT('onboarding.parentConsent.signInLink', { child: childName })}
			</a>
		{:else}
			<!-- Screen 1: approve. -->
			<div class="flex flex-col gap-3">
				<h1 class="type-step-title text-gray-900">
					{formatT('onboarding.parentConsent.title', { child: childName })}
				</h1>
				<p class="text-base leading-7 text-gray-600">
					{formatT('onboarding.parentConsent.subtitle', { child: childName })}
				</p>
			</div>

			{#if errorMessage}
				<Alert variant="destructive">
					<AlertTitle>{$_('onboarding.parentConsent.errorTitle')}</AlertTitle>
					<AlertDescription>{errorMessage}</AlertDescription>
				</Alert>
			{/if}

			<div class="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4">
				<Checkbox id="consent-agreement" bind:checked={acceptedPolicies} class="mt-1" />
				<!-- Clicking the Terms / Privacy links opens them without toggling the checkbox (links are
				interactive content, so the label does not activate). -->
				<label for="consent-agreement" class="cursor-pointer text-sm leading-6 text-gray-700">
					{#each agreementParts as part, index (index)}
						{#if part === '{terms}'}
							<a class="font-semibold text-primary underline" href="/terms" target="_blank"
								>{$_('onboarding.parentConsent.termsLink')}</a
							>
						{:else if part === '{privacy}'}
							<a class="font-semibold text-primary underline" href="/privacy" target="_blank"
								>{$_('onboarding.parentConsent.privacyLink')}</a
							>
						{:else}
							{part}
						{/if}
					{/each}
				</label>
			</div>

			<fieldset class="flex flex-col gap-3">
				<legend class="type-field-label pb-3 text-gray-900">
					{formatT('onboarding.parentConsent.routingQuestion', { child: childName })}
				</legend>
				<RadioGroup.Root
					value={routing}
					onValueChange={(value) => {
						routing = value === 'child' ? 'child' : 'parent';
						childEmailServerError = '';
					}}
				>
					<div class="flex items-center gap-3">
						<RadioGroup.Item value="parent" id="routing-parent" />
						<Label for="routing-parent" class="font-normal text-gray-700">
							{formatT('onboarding.parentConsent.routingParent', { parentEmail })}
						</Label>
					</div>
					<div class="flex items-center gap-3">
						<RadioGroup.Item value="child" id="routing-child" />
						<Label for="routing-child" class="font-normal text-gray-700">
							{formatT('onboarding.parentConsent.routingChild', { child: childName })}
						</Label>
					</div>
				</RadioGroup.Root>
				{#if routing === 'child'}
					<Field class="flex flex-col gap-2 pl-7">
						<FieldLabel for="child-email" class="type-field-label text-gray-900">
							{formatT('onboarding.parentConsent.childEmailLabel', { child: childName })}
						</FieldLabel>
						<Input
							id="child-email"
							type="email"
							autocomplete="off"
							placeholder={$_('onboarding.parentConsent.childEmailPlaceholder')}
							bind:value={childEmail}
							oninput={() => (childEmailServerError = '')}
							aria-invalid={childEmailError ? true : undefined}
						/>
						{#if childEmailError}
							<FieldError>{childEmailError}</FieldError>
						{/if}
					</Field>
				{/if}
				<p class="text-sm leading-6 text-gray-600">
					{formatT('onboarding.parentConsent.routingFinePrint', { child: childName })}
				</p>
			</fieldset>

			<div class="mt-auto pb-2 sm:pb-6">
				<Button class="h-12 w-full" size="xl" disabled={!canApprove} onclick={() => void approve()}>
					{pending
						? $_('onboarding.parentConsent.approving')
						: formatT('onboarding.parentConsent.approveButton', { child: childName })}
				</Button>
			</div>
		{/if}
	</div>
</FlowShell>
