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

	const requestReset = async () => {
		errorMessage = '';
		pending = true;
		try {
			const resolvedEmail = await resolveIdentifierEmail(identifier);
			if (!resolvedEmail) {
				errorMessage = 'Enter a valid username or email.';
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
				errorMessage = error.message ?? 'Could not send reset email.';
				return;
			}
			requestSent = true;
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : 'Could not send reset email.';
		} finally {
			pending = false;
		}
	};

	const updatePassword = async () => {
		if (trimmedNewPassword !== trimmedConfirmPassword) {
			errorMessage = 'Passwords do not match.';
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
			errorMessage = error.message ?? 'Could not reset password.';
			return;
		}

		showGlobalSnackbar({
			title: 'Password updated',
			description: 'You can now log in with your new password.'
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
	accountLabel="I'm new, sign me up"
	accountHref={signUpHref}
>
	<div class="flex flex-1 flex-col">
			<button
				type="button"
				onclick={() => void goToSignIn()}
				class="inline-flex w-fit items-center text-gray-500 transition-colors duration-200 hover:text-gray-700"
				aria-label="Go back"
			>
				<ChevronLeftIcon class="size-7" />
			</button>

			{#if isTokenFlow}
				<div class="mt-2 flex flex-col gap-6">
					<h1 class="type-step-title text-gray-900">Create new password</h1>

					<Field class="flex flex-col gap-2">
						<FieldLabel for="newPassword" required class="type-field-label text-gray-900">
							New password
						</FieldLabel>
						<div class="relative">
							<Input
								id="newPassword"
								type={showNewPassword ? 'text' : 'password'}
								bind:value={newPassword}
								autocomplete="new-password"
								placeholder="Enter your new password"
								class="h-12 border-gray-300 bg-white px-4 pr-11 text-base"
							/>
							<button
								type="button"
								onclick={() => (showNewPassword = !showNewPassword)}
								onmousedown={(event) => event.preventDefault()}
								class="absolute inset-y-0 right-3 inline-flex size-5 cursor-pointer items-center justify-center self-center rounded-sm text-gray-500 transition-colors duration-200 hover:bg-transparent hover:text-gray-700 focus:outline-none focus-visible:outline-none focus-visible:ring-0 active:bg-transparent"
								aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
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
							Confirm password
						</FieldLabel>
						<div class="relative">
							<Input
								id="confirmNewPassword"
								type={showConfirmPassword ? 'text' : 'password'}
								bind:value={confirmPassword}
								autocomplete="new-password"
								placeholder="Confirm your password"
								class="h-12 border-gray-300 bg-white px-4 pr-11 text-base"
							/>
							<button
								type="button"
								onclick={() => (showConfirmPassword = !showConfirmPassword)}
								onmousedown={(event) => event.preventDefault()}
								class="absolute inset-y-0 right-3 inline-flex size-5 cursor-pointer items-center justify-center self-center rounded-sm text-gray-500 transition-colors duration-200 hover:bg-transparent hover:text-gray-700 focus:outline-none focus-visible:outline-none focus-visible:ring-0 active:bg-transparent"
								aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
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
						<AlertTitle>Unable to save password</AlertTitle>
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
						{pending ? 'Saving...' : 'Save changes'}
					</Button>
				</div>
			{:else if requestSent}
				<div class="mt-2 flex flex-1 flex-col gap-6">
					<h1 class="type-step-title text-gray-900">Password reset link sent</h1>
					<p class="text-sm leading-6 text-gray-600">
						{#if isParentResetFlow}
							We've sent an email to your parent's account. Please ask them to click the link in the
							email to reset your password.
						{:else}
							We've sent an email to your account. Click the link in the email to reset your password.
						{/if}
					</p>
					<p class="text-sm leading-6 text-gray-600">
						If you don't see the email, check your spam folder.
					</p>

					<div class="pt-2">
						<img
							src={resetPasswordImage}
							alt="Password reset email sent"
							class="mx-auto h-auto w-[12.5rem] object-contain"
						/>
					</div>
				</div>

				<div class="mt-auto flex flex-col gap-4 pt-4 pb-2 sm:pb-6 lg:pb-2">
					<Button variant="outline" size="xl" class="h-12 w-full" onclick={() => void goToSignIn()}>
						Return to account log in
					</Button>
				</div>
			{:else}
				<div class="mt-2 flex flex-col gap-6">
					<div class="flex flex-col gap-2">
						<h1 class="type-step-title text-gray-900">Reset your password</h1>
						<p class="text-sm leading-6 text-gray-600">
							No need to worry. Enter your username or email and we’ll send instructions to reset your
							password.
						</p>
					</div>

					<Field class="flex flex-col gap-2">
						<FieldLabel for="resetEmail" required class="type-field-label text-gray-900">
							Username or email
						</FieldLabel>
						<Input
							id="resetEmail"
							type="text"
							bind:value={identifier}
							autocomplete="username"
							placeholder="Enter your username or email"
							class="h-12 border-gray-300 bg-white px-4 text-base"
						/>
					</Field>
				</div>

				{#if errorMessage}
					<Alert variant="destructive" class="mt-5">
						<AlertTitle>Unable to send reset link</AlertTitle>
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
						{pending ? 'Sending...' : 'Reset password'}
					</Button>
					<Button variant="outline" size="xl" class="h-12 w-full" onclick={() => void goToSignIn()}>
						Return to account log in
					</Button>
				</div>
			{/if}
	</div>
</FlowShell>
