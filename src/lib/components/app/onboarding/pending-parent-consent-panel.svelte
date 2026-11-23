<script lang="ts">
	import { onMount } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import type { PendingParentConsentResult } from '$convex/pendingParentConsent';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { Field, FieldLabel } from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { _, formatT, t } from '$lib/i18n';

	// CL-772: the child's "waiting for your parent" panel (PRD 6.1.6). A pending child has no
	// session, so every call carries the username and password they just typed.
	let { username, password }: { username: string; password: string } = $props();

	const convexClient = useConvexClient();

	let parentEmail = $state<string | null>(null);
	let hidden = $state(false);
	let editing = $state(false);
	let newEmail = $state('');
	let pending = $state(false);
	let successMessage = $state('');
	let notSentMessage = $state('');
	let errorMessage = $state('');

	const applyResult = (result: PendingParentConsentResult, mode: 'load' | 'resend' | 'change') => {
		successMessage = '';
		notSentMessage = '';
		errorMessage = '';
		switch (result.status) {
			case 'pending':
				parentEmail = result.parentEmail;
				return;
			case 'sent':
				parentEmail = result.parentEmail;
				editing = false;
				successMessage = formatT(
					mode === 'change' ? 'auth.pendingConsent.changed' : 'auth.pendingConsent.resent',
					{ email: result.parentEmail }
				);
				return;
			case 'rate_limited':
				parentEmail = result.parentEmail;
				notSentMessage = t(
					result.retryAfter === 'day'
						? 'auth.pendingConsent.rateLimitedDay'
						: 'auth.pendingConsent.rateLimitedHour'
				);
				return;
			case 'send_failed':
				parentEmail = result.parentEmail;
				notSentMessage = t('auth.pendingConsent.sendFailed');
				return;
			case 'invalid_email':
				errorMessage = t('auth.pendingConsent.invalidEmail');
				return;
			case 'too_many_attempts':
				if (mode === 'load') hidden = true;
				else notSentMessage = t('auth.pendingConsent.tooManyAttempts');
				return;
			case 'not_pending':
				parentEmail = null;
				editing = false;
				successMessage = t('auth.pendingConsent.alreadyApproved');
				return;
			case 'invalid_credentials':
				// Only reachable with a wrong password: show nothing more than the form already did.
				hidden = true;
				return;
		}
	};

	// Loaded once: the caller re-mounts the panel ({#key}) for other credentials.
	onMount(() => {
		let cancelled = false;
		void convexClient
			.action(api.pendingParentConsent.getPendingParentConsent, { username, password })
			.then((result) => {
				if (!cancelled) applyResult(result, 'load');
			})
			.catch(() => {
				if (!cancelled) hidden = true;
			});
		return () => {
			cancelled = true;
		};
	});

	const run = async (mode: 'resend' | 'change') => {
		if (pending) return;
		pending = true;
		try {
			const result =
				mode === 'change'
					? await convexClient.action(api.pendingParentConsent.changeParentConsentEmail, {
							username,
							password,
							parentEmail: newEmail
						})
					: await convexClient.action(api.pendingParentConsent.resendParentConsentEmail, {
							username,
							password
						});
			applyResult(result, mode);
		} catch {
			successMessage = '';
			notSentMessage = '';
			errorMessage = t('auth.pendingConsent.genericError');
		} finally {
			pending = false;
		}
	};

	const startEditing = () => {
		newEmail = parentEmail ?? '';
		errorMessage = '';
		editing = true;
	};
</script>

{#if !hidden && (parentEmail || successMessage)}
	<section
		class="flex w-full flex-col gap-3 rounded-lg border bg-card px-4 py-4 text-left"
		aria-live="polite"
		data-testid="pending-parent-consent"
	>
		{#if parentEmail}
			<div class="flex flex-col gap-1">
				<h2 class="text-base font-semibold text-gray-900">
					{$_('auth.pendingConsent.title')}
				</h2>
				<p class="text-sm text-gray-700">
					{formatT('auth.pendingConsent.sentTo', { email: parentEmail })}
				</p>
				<p class="text-sm text-gray-600">{$_('auth.pendingConsent.hint')}</p>
			</div>
		{/if}

		{#if successMessage}
			<Alert>
				<AlertDescription>{successMessage}</AlertDescription>
			</Alert>
		{/if}

		{#if notSentMessage}
			<Alert variant="destructive" role="alert">
				<AlertTitle>{$_('auth.pendingConsent.notSentTitle')}</AlertTitle>
				<AlertDescription>{notSentMessage}</AlertDescription>
			</Alert>
		{/if}

		{#if parentEmail}
			{#if editing}
				<form
					class="flex flex-col gap-3"
					onsubmit={(event) => {
						event.preventDefault();
						void run('change');
					}}
				>
					<Field>
						<FieldLabel for="pending-consent-parent-email">
							{$_('auth.pendingConsent.newEmailLabel')}
						</FieldLabel>
						<Input
							id="pending-consent-parent-email"
							type="email"
							autocomplete="email"
							required
							bind:value={newEmail}
							aria-invalid={errorMessage ? true : undefined}
						/>
						{#if errorMessage}
							<p class="text-sm text-destructive">{errorMessage}</p>
						{/if}
					</Field>
					<div class="flex flex-col gap-2 sm:flex-row">
						<Button type="submit" disabled={pending} class="sm:flex-1">
							{pending
								? $_('auth.pendingConsent.sending')
								: $_('auth.pendingConsent.sendToNewEmail')}
						</Button>
						<Button
							type="button"
							variant="ghost"
							disabled={pending}
							onclick={() => {
								editing = false;
								errorMessage = '';
							}}
						>
							{$_('auth.pendingConsent.cancel')}
						</Button>
					</div>
				</form>
			{:else}
				{#if errorMessage}
					<p class="text-sm text-destructive">{errorMessage}</p>
				{/if}
				<div class="flex flex-col gap-2 sm:flex-row">
					<Button
						type="button"
						variant="outline"
						disabled={pending}
						class="sm:flex-1"
						onclick={() => void run('resend')}
					>
						{pending ? $_('auth.pendingConsent.sending') : $_('auth.pendingConsent.resend')}
					</Button>
					<Button
						type="button"
						variant="outline"
						disabled={pending}
						class="sm:flex-1"
						onclick={startEditing}
					>
						{$_('auth.pendingConsent.change')}
					</Button>
				</div>
			{/if}
		{/if}
	</section>
{/if}
