<script lang="ts">
	import Icon from '@iconify/svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { InputField } from '$lib/components/app/form';
	import { showGlobalSnackbar } from '$lib/components/app/snackbar';
	import { authClient } from '$lib/auth-client';
	import loginIllustration from '$lib/assets/svg/login.svg';

	const session = authClient.useSession();

	let email = $state('');
	let password = $state('');
	let rememberMe = $state(false);
	let showPassword = $state(false);
	let pending = $state(false);
	let googlePending = $state(false);
	let errorMessage = $state('');
	let infoMessage = $state('');
	let existingGoogleAccountHandled = $state(false);

	let rawNextPath = $derived(page.url.searchParams.get('next') ?? '/');
	let nextPath = $derived(rawNextPath.startsWith('/') ? rawNextPath : '/');
	const signUpHref = '/onboarding/get-started';
	let forgotHref = $derived(`/auth/reset-password?next=${encodeURIComponent(nextPath)}`);
	let needsVerification = $derived(errorMessage.toLowerCase().includes('not verified'));
	let existingGoogleAccount = $derived(page.url.searchParams.get('existingGoogleAccount') === '1');

	const isInvalidEmailError = (message?: string) => {
		const normalized = (message?.trim().toLowerCase() ?? '').replace(/[.!]+$/g, '');
		return normalized === 'invalid email' || normalized === 'invalid email address';
	};

	$effect(() => {
		if (!existingGoogleAccount) return;
		if ($session.data) return;
		infoMessage = 'You already have an account with Google. Continue with Google to sign in.';
	});

	$effect(() => {
		if (existingGoogleAccountHandled) return;
		if (!existingGoogleAccount) return;
		if (!$session.data) return;
		showGlobalSnackbar({
			title: 'Account already exists',
			description: 'You already have an account with Google. We signed you in.'
		});
		existingGoogleAccountHandled = true;
		void goto(nextPath, { replaceState: true });
	});

	$effect(() => {
		if (existingGoogleAccount) return;
		if ($session.data) {
			void goto(nextPath, { replaceState: true });
		}
	});

	const goBack = async () => {
		await goto('/onboarding/get-started');
	};

	const signInWithGoogle = async () => {
		errorMessage = '';
		infoMessage = '';
		googlePending = true;

		const { data, error } = await authClient.signIn.social({
			provider: 'google',
			callbackURL: nextPath
		});

		if (error) {
			googlePending = false;
			errorMessage = error.message ?? 'Failed to start Google sign in.';
			return;
		}

		if (data?.url) {
			await goto(data.url);
			return;
		}

		googlePending = false;
		errorMessage = 'Failed to start Google sign in.';
	};

	const signIn = async () => {
		pending = true;
		errorMessage = '';
		infoMessage = '';
		const { error } = await authClient.signIn.email({
			email: email.trim(),
			password,
			callbackURL: nextPath,
			rememberMe
		});
		pending = false;
		if (error) {
			if (isInvalidEmailError(error.message)) {
				showGlobalSnackbar({
					title: 'Invalid email',
					description: 'Enter a valid email address and try again.'
				});
				return;
			}
			errorMessage = error.message ?? 'Failed to sign in.';
			return;
		}
		await goto(nextPath, { replaceState: true });
	};

	const resendVerification = async () => {
		if (!email.trim()) return;
		pending = true;
		errorMessage = '';
		infoMessage = '';
		const { error } = await authClient.sendVerificationEmail({
			email: email.trim(),
			callbackURL: nextPath
		});
		pending = false;
		if (error) {
			errorMessage = error.message ?? 'Failed to resend verification email.';
			return;
		}
		infoMessage = 'Verification email sent. Check your inbox and spam folder.';
	};
</script>

<div class="min-h-screen bg-white px-4 py-6 sm:px-8">
	<div class="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl items-center justify-center">
		<div class="grid w-full max-w-[54rem] items-center gap-8 md:grid-cols-[19.5rem_minmax(0,1fr)]">
			<div class="hidden md:flex md:items-center md:justify-center">
				<div class="w-full max-w-[18.5rem] overflow-hidden rounded-2xl bg-orange-50">
					<img
						src={loginIllustration}
						alt="Login illustration"
						class="h-auto w-full object-contain"
					/>
				</div>
			</div>

			<div class="mx-auto flex w-full max-w-[28.75rem] flex-1 flex-col">
				<div class="flex flex-1 flex-col pt-2 md:pt-8">
					<button
						type="button"
						onclick={() => void goBack()}
						class="inline-flex w-fit items-center text-gray-500 transition-colors duration-200 hover:text-gray-700"
						aria-label="Go back"
					>
						<ChevronLeftIcon class="size-7" />
					</button>

					<div class="mt-2 flex flex-col gap-5">
						<h1 class="type-step-title text-gray-900">Log in</h1>

						<InputField
							id="email"
							label="Username/Email"
							required={true}
							type="email"
							bind:value={email}
							autocomplete="email"
							placeholder="john.doe@gmail.com"
							inputClass="bg-white"
						/>

						<InputField
							id="password"
							label="Password"
							required={true}
							type={showPassword ? 'text' : 'password'}
							bind:value={password}
							autocomplete="current-password"
							placeholder="Enter your password"
							inputClass="bg-white"
						>
							{#snippet trailing()}
								<button
									type="button"
									onclick={() => (showPassword = !showPassword)}
									onmousedown={(event) => event.preventDefault()}
									class="inline-flex size-5 cursor-pointer items-center justify-center rounded-sm text-gray-500 transition-colors duration-200 hover:bg-transparent hover:text-gray-700 focus:outline-none focus-visible:outline-none focus-visible:ring-0 active:bg-transparent"
									aria-label={showPassword ? 'Hide password' : 'Show password'}
									aria-pressed={showPassword}
								>
									{#if showPassword}
										<EyeOffIcon class="size-5" />
									{:else}
										<EyeIcon class="size-5" />
									{/if}
								</button>
							{/snippet}
						</InputField>

						<div class="mb-5 flex items-center justify-between gap-3">
							<div class="flex items-center gap-2 pt-0.5">
								<Checkbox id="remember-me" bind:checked={rememberMe} />
								<label for="remember-me" class="cursor-pointer text-sm leading-6 text-gray-600">
									Remember me
								</label>
							</div>
							<a
								href={forgotHref}
								class="text-sm font-bold text-orange-500 transition-colors duration-200 hover:text-orange-600"
							>
								Forgot password?
							</a>
						</div>
					</div>

					{#if errorMessage}
						<Alert variant="destructive" class="mt-5">
							<AlertTitle>Sign in failed</AlertTitle>
							<AlertDescription>{errorMessage}</AlertDescription>
						</Alert>
					{/if}

					{#if infoMessage}
						<Alert class="mt-5">
							<AlertTitle>Check your email</AlertTitle>
							<AlertDescription>{infoMessage}</AlertDescription>
						</Alert>
					{/if}

					<div class="mt-auto flex flex-col gap-3 pb-2 sm:pb-6">
						{#if needsVerification}
							<Button
								variant="outline"
								size="xl"
								class="h-12 w-full"
								disabled={pending || googlePending || !email.trim()}
								onclick={() => void resendVerification()}
							>
								Resend verification email
							</Button>
						{/if}
						<Button
							variant="outline"
							size="xl"
							class="h-12 w-full text-black hover:text-black active:text-black"
							disabled={pending || googlePending}
							onclick={() => void signInWithGoogle()}
						>
							{#if googlePending}
								<LoaderCircleIcon class="size-4 animate-spin" />
								Continuing with Google...
							{:else}
								<Icon icon="logos:google-icon" width="20" height="20" aria-hidden="true" />
								Continue with Google
							{/if}
						</Button>
						<Button
							variant="default"
							size="xl"
							class="h-12 w-full"
							disabled={pending || googlePending || !email.trim() || !password}
							onclick={() => void signIn()}
						>
							{pending ? 'Logging in...' : 'Log in'}
						</Button>
						<Button
							variant="outline"
							size="xl"
							class="h-12 w-full"
							disabled={pending || googlePending}
							href={signUpHref}
						>
							I'm new, sign me up
						</Button>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
