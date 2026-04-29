<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import { Button } from '$lib/components/ui/button';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Field, FieldLabel } from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import { authClient } from '$lib/auth-client';
	import { _, t } from '$lib/i18n';
	import { navigateBack } from '$lib/navigation/back';
	import { showGlobalSnackbar } from '$lib/components/app/snackbar';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import resetPasswordImage from '$lib/assets/svg/reset_password.png';

	let token = $derived(page.url.searchParams.get('token') ?? '');
	let isTokenFlow = $derived(token.length > 0);
	let isParentResetFlow = $derived(page.url.searchParams.get('parent') === '1');

	let rawNextPath = $derived(page.url.searchParams.get('next') ?? '/');
	let nextPath = $derived(rawNextPath.startsWith('/') ? rawNextPath : '/');
	let signInHref = $derived(`/auth/sign-in?next=${encodeURIComponent(nextPath)}`);
	const signUpHref = '/onboarding/get-started';
	const convexClient = useConvexClient();

	let identifier = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let pending = $state(false);
	let requestSent = $state(false);
	let errorMessage = $state('');
	let showNewPassword = $state(false);
	let showConfirmPassword = $state(false);
	let trimmedNewPassword = $derived(newPassword.trim());
	let trimmedConfirmPassword = $derived(confirmPassword.trim());

	const normalizeIdentifier = (value: string) => value.trim().toLowerCase();
	const isEmailLike = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

	const resolveIdentifierEmail = async (rawIdentifier: string) => {
		const normalizedIdentifier = normalizeIdentifier(rawIdentifier);
		if (!normalizedIdentifier) {
			return null;
		}
		if (isEmailLike(normalizedIdentifier)) {
			return normalizedIdentifier;
		}
		const result = await convexClient.query(api.auth.resolveAuthIdentifier, {
			identifier: normalizedIdentifier
		});
		return result.email;
	};

	const goToSignIn = async () => {
		await goto(signInHref, { replaceState: true });
	};

	const goBack = async () => {
		await navigateBack({ fallbackHref: signInHref, replaceState: true });
	};

	const requestReset = async () => {
		errorMessage = '';
		pending = true;
		try {
			const resolvedEmail = await resolveIdentifierEmail(identifier);
			if (!resolvedEmail) {
				errorMessage = t('auth.resetPassword.requestInvalidIdentifier');
				return;
			}
			const redirectTo = new URL('/auth/reset-password', window.location.origin);
			redirectTo.searchParams.set('next', nextPath);
			if (isParentResetFlow) {
				redirectTo.searchParams.set('parent', '1');
			}
			const { error } = await authClient.requestPasswordReset({
				email: resolvedEmail,
				redirectTo: redirectTo.toString()
			});
			if (error) {
				errorMessage = error.message ?? t('auth.resetPassword.requestFailure');
				return;
			}
			requestSent = true;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('auth.resetPassword.requestFailure');
		} finally {
			pending = false;
		}
	};

	const updatePassword = async () => {
		if (trimmedNewPassword !== trimmedConfirmPassword) {
			errorMessage = t('auth.resetPassword.passwordMismatch');
			return;
		}

		pending = true;
		errorMessage = '';
		const { error } = await authClient.resetPassword({
			token,
			newPassword: trimmedNewPassword
		});
		pending = false;
		if (error) {
			errorMessage = error.message ?? t('auth.resetPassword.resetFailure');
			return;
		}

		showGlobalSnackbar({
			title: t('auth.resetPassword.passwordUpdatedTitle'),
			description: t('auth.resetPassword.passwordUpdatedDescription')
		});
		await goto(signInHref, { replaceState: true });
	};
</script>

<FlowShell
	step={1}
	total={1}
	showSideIllustration={true}
	showProgressBar={false}
	showAccountLink={true}
	accountLabel={$_('common.newSignUp')}
	accountHref={signUpHref}
>
	<div class="flex flex-1 flex-col">
			<button
				type="button"
				onclick={() => void goBack()}
				class="inline-flex w-fit items-center text-gray-500 transition-colors duration-200 hover:text-gray-700"
				aria-label={$_('common.goBack')}
			>
				<ChevronLeftIcon class="size-7" />
			</button>

			{#if isTokenFlow}
				<div class="mt-2 flex flex-col gap-6">
					<h1 class="type-step-title text-gray-900">{$_('auth.resetPassword.tokenTitle')}</h1>

					<Field class="flex flex-col gap-2">
						<FieldLabel for="newPassword" required class="type-field-label text-gray-900">
							{$_('auth.resetPassword.newPasswordLabel')}
						</FieldLabel>
						<div class="relative">
							<Input
								id="newPassword"
								type={showNewPassword ? 'text' : 'password'}
								bind:value={newPassword}
								autocomplete="new-password"
								placeholder={$_('auth.resetPassword.newPasswordPlaceholder')}
								class="h-12 border-gray-300 bg-white px-4 pr-11 text-base"
							/>
							<button
								type="button"
								onclick={() => (showNewPassword = !showNewPassword)}
								onmousedown={(event) => event.preventDefault()}
								class="absolute inset-y-0 right-3 inline-flex size-5 cursor-pointer items-center justify-center self-center rounded-sm text-gray-500 transition-colors duration-200 hover:bg-transparent hover:text-gray-700 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-transparent"
								aria-label={showNewPassword ? $_('auth.resetPassword.hideNewPassword') : $_('auth.resetPassword.showNewPassword')}
								aria-pressed={showNewPassword}
							>
								{#if showNewPassword}
									<EyeOffIcon class="size-5" />
								{:else}
									<EyeIcon class="size-5" />
								{/if}
							</button>
						</div>
					</Field>

					<Field class="flex flex-col gap-2">
						<FieldLabel for="confirmNewPassword" required class="type-field-label text-gray-900">
							{$_('auth.resetPassword.confirmPasswordLabel')}
						</FieldLabel>
						<div class="relative">
							<Input
								id="confirmNewPassword"
								type={showConfirmPassword ? 'text' : 'password'}
								bind:value={confirmPassword}
								autocomplete="new-password"
								placeholder={$_('auth.resetPassword.confirmPasswordPlaceholder')}
								class="h-12 border-gray-300 bg-white px-4 pr-11 text-base"
							/>
							<button
								type="button"
								onclick={() => (showConfirmPassword = !showConfirmPassword)}
								onmousedown={(event) => event.preventDefault()}
								class="absolute inset-y-0 right-3 inline-flex size-5 cursor-pointer items-center justify-center self-center rounded-sm text-gray-500 transition-colors duration-200 hover:bg-transparent hover:text-gray-700 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-transparent"
								aria-label={showConfirmPassword ? $_('auth.resetPassword.hideConfirmPassword') : $_('auth.resetPassword.showConfirmPassword')}
								aria-pressed={showConfirmPassword}
							>
								{#if showConfirmPassword}
									<EyeOffIcon class="size-5" />
								{:else}
									<EyeIcon class="size-5" />
								{/if}
							</button>
						</div>
					</Field>
				</div>

				{#if errorMessage}
					<Alert variant="destructive" class="mt-5">
						<AlertTitle>{$_('auth.resetPassword.saveErrorTitle')}</AlertTitle>
						<AlertDescription>{errorMessage}</AlertDescription>
					</Alert>
				{/if}

				<div class="mt-auto flex flex-col gap-4 pt-4 pb-2 sm:pb-6 lg:pb-2">
					<Button
						variant="default"
						size="xl"
						class="h-12 w-full"
						disabled={pending || !trimmedNewPassword || !trimmedConfirmPassword || trimmedNewPassword !== trimmedConfirmPassword}
						onclick={() => void updatePassword()}
					>
						{pending ? $_('auth.resetPassword.savingChanges') : $_('auth.resetPassword.saveChanges')}
					</Button>
				</div>
			{:else if requestSent}
				<div class="mt-2 flex flex-1 flex-col gap-6">
					<h1 class="type-step-title text-gray-900">{$_('auth.resetPassword.emailSentTitle')}</h1>
					<p class="text-sm leading-6 text-gray-600">
						{#if isParentResetFlow}
							{$_('auth.resetPassword.emailSentParent')}
						{:else}
							{$_('auth.resetPassword.emailSentDefault')}
						{/if}
					</p>
					<p class="text-sm leading-6 text-gray-600">
						{$_('auth.resetPassword.checkSpam')}
					</p>

					<div class="pt-2">
						<img
							src={resetPasswordImage}
							alt={$_('auth.resetPassword.emailSentIllustrationAlt')}
							class="mx-auto h-auto w-[12.5rem] object-contain"
						/>
					</div>
				</div>

				<div class="mt-auto flex flex-col gap-4 pt-4 pb-2 sm:pb-6 lg:pb-2">
					<Button variant="outline" size="xl" class="h-12 w-full" onclick={() => void goToSignIn()}>
						{$_('auth.resetPassword.backToSignIn')}
					</Button>
				</div>
			{:else}
				<div class="mt-2 flex flex-col gap-6">
					<div class="flex flex-col gap-2">
						<h1 class="type-step-title text-gray-900">{$_('auth.resetPassword.requestTitle')}</h1>
						<p class="text-sm leading-6 text-gray-600">
							{$_('auth.resetPassword.requestDescription')}
						</p>
					</div>

					<Field class="flex flex-col gap-2">
						<FieldLabel for="resetEmail" required class="type-field-label text-gray-900">
							{$_('auth.resetPassword.identifierLabel')}
						</FieldLabel>
						<Input
							id="resetEmail"
							type="text"
							bind:value={identifier}
							autocomplete="username"
							placeholder={$_('auth.resetPassword.identifierPlaceholder')}
							class="h-12 border-gray-300 bg-white px-4 text-base"
						/>
					</Field>
				</div>

				{#if errorMessage}
					<Alert variant="destructive" class="mt-5">
						<AlertTitle>{$_('auth.resetPassword.requestErrorTitle')}</AlertTitle>
						<AlertDescription>{errorMessage}</AlertDescription>
					</Alert>
				{/if}

				<div class="mt-auto flex flex-col gap-4 pt-4 pb-2 sm:pb-6 lg:pb-2">
					<Button
						variant="default"
						size="xl"
						class="h-12 w-full"
						disabled={pending || !identifier.trim()}
						onclick={() => void requestReset()}
					>
						{pending ? $_('auth.resetPassword.submitting') : $_('auth.resetPassword.submit')}
					</Button>
					<Button variant="outline" size="xl" class="h-12 w-full" onclick={() => void goToSignIn()}>
						{$_('auth.resetPassword.backToSignIn')}
					</Button>
				</div>
			{/if}
	</div>
</FlowShell>
