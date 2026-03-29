<script lang="ts">
	import Icon from '@iconify/svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Field, FieldLabel } from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { showGlobalSnackbar } from '$lib/components/app/snackbar';
	import { authClient } from '$lib/auth-client';
	import { routes } from '$lib/routes';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import loginIllustration from '$lib/assets/svg/login.svg';

	const auth = useAuth();
	const convexClient = useConvexClient();

	let identifier = $state('');
	let password = $state('');
	let rememberMe = $state(false);
	let showPassword = $state(false);
	let pending = $state(false);
	let googlePending = $state(false);
	let errorMessage = $state('');
	let infoMessage = $state('');
	let existingGoogleAccountHandled = $state(false);
	let handledForcedExistingGoogleAccount = $state(false);
	let dismissGoogleAuthCallbackError = $state(false);
	let resolvedCredentialEmail = $state<string | null>(null);

	const normalizePostSignInPath = (value: string | null) => {
		if (!value?.startsWith('/')) return '/';
		if (value === routes.profile) return '/';
		return value;
	};

	const getExistingGoogleSignupBlockedMessage = () =>
		nextPath.startsWith('/onboarding/join-club/')
			? 'This Google account is already registered. Log in to continue joining this club.'
			: 'This Google account is already registered. Log in instead of signing up.';

	let rawNextPath = $derived(page.url.searchParams.get('next'));
	let nextPath = $derived(normalizePostSignInPath(rawNextPath));
	let forceSignup = $derived(page.url.searchParams.get('forceSignup') === '1');
	let resolvedNextPath = $derived(
		forceSignup && nextPath.startsWith('/onboarding/') && !nextPath.startsWith('/onboarding/post-signup')
			? '/'
			: nextPath
	);
	let googleAuthErrorCode = $derived(page.url.searchParams.get('error') ?? '');
	let googleAuthErrorDescription = $derived(
		page.url.searchParams.get('error_description') ??
			page.url.searchParams.get('message') ??
			page.url.searchParams.get('error_message') ??
			''
	);
	const signUpHref = '/onboarding/get-started';
	let forgotHref = $derived(`/auth/reset-password?next=${encodeURIComponent(resolvedNextPath)}`);
	let needsVerification = $derived(errorMessage.toLowerCase().includes('not verified'));
	let existingGoogleAccount = $derived(page.url.searchParams.get('existingGoogleAccount') === '1');

	const normalizeIdentifier = (value: string) => value.trim().toLowerCase();
	const isEmailLike = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

	const normalizeGoogleAuthError = (value: string | null | undefined) =>
		(value ?? '').toLowerCase().replaceAll(/[_+%-]+/g, ' ').trim();

	const getGoogleSignInErrorMessage = (args: {
		code?: string | null;
		description?: string | null;
		hasTypedEmail?: boolean;
	}) => {
		const combined = `${normalizeGoogleAuthError(args.code)} ${normalizeGoogleAuthError(args.description)}`.trim();
		if (!combined) {
			return '';
		}
		if (combined.includes('signup disabled')) {
			return args.hasTypedEmail
				? 'You do not have an account with that email. Sign up to continue.'
				: 'You do not have an account with that Google email. Sign up to continue.';
		}
		if (
			combined.includes("email doesn't match") ||
			combined.includes('email doesnt match') ||
			combined.includes('different emails') ||
			combined.includes('unable to link account') ||
			combined.includes('account already linked')
		) {
			return 'This Google account could not be linked here. Sign in with your existing account first or use the same email address.';
		}
		if (combined.includes('oauth provider not found')) {
			return 'Google sign-in is not configured yet.';
		}
		return 'Unable to continue with Google right now. Please try again.';
	};

	const buildSignInPath = () => {
		const params = new SvelteURLSearchParams();
		if (nextPath !== '/') {
			params.set('next', nextPath);
		}
		if (forceSignup) {
			params.set('forceSignup', '1');
		}
		const query = params.toString();
		return query.length > 0 ? `/auth/sign-in?${query}` : '/auth/sign-in';
	};

	let googleAuthCallbackErrorMessage = $derived(
		dismissGoogleAuthCallbackError || existingGoogleAccount
			? ''
			: getGoogleSignInErrorMessage({
					code: googleAuthErrorCode,
					description: googleAuthErrorDescription
				})
	);
	let activeErrorMessage = $derived(errorMessage || googleAuthCallbackErrorMessage);

	const isInvalidEmailError = (message?: string) => {
		const normalized = (message?.trim().toLowerCase() ?? '').replace(/[.!]+$/g, '');
		return normalized === 'invalid email' || normalized === 'invalid email address';
	};

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

	$effect(() => {
		if (!existingGoogleAccount) return;
		if (auth.isAuthenticated) return;
		infoMessage = 'You already have an account with Google. Continue with Google to sign in.';
	});

	$effect(() => {
		if (existingGoogleAccountHandled) return;
		if (!existingGoogleAccount) return;
		if (forceSignup) return;
		if (auth.isLoading || !auth.isAuthenticated) return;
		showGlobalSnackbar({
			title: 'Account already exists',
			description: 'You already have an account with Google. We signed you in.'
		});
		existingGoogleAccountHandled = true;
		void goto(resolvedNextPath, { replaceState: true });
	});

	$effect(() => {
		if (forceSignup && existingGoogleAccount) {
			if (auth.isLoading || !auth.isAuthenticated) return;
			if (handledForcedExistingGoogleAccount) return;
			handledForcedExistingGoogleAccount = true;
			void (async () => {
				try {
					await authClient.signOut();
				} finally {
					errorMessage = getExistingGoogleSignupBlockedMessage();
					infoMessage = '';
					dismissGoogleAuthCallbackError = true;
				}
			})();
			return;
		}

		if (existingGoogleAccount) return;
		if (!auth.isLoading && auth.isAuthenticated) {
			void goto(resolvedNextPath, { replaceState: true });
		}
	});

	$effect(() => {
		if (googleAuthErrorCode || googleAuthErrorDescription) {
			dismissGoogleAuthCallbackError = false;
		}
	});

	const goBack = async () => {
		await goto('/onboarding/get-started');
	};

	const navigateToExternalUrl = (url: string) => {
		window.location.assign(url);
	};

	const signInWithGoogle = async () => {
		errorMessage = '';
		infoMessage = '';
		googlePending = true;
		dismissGoogleAuthCallbackError = true;
		try {
			const { data, error } = await authClient.signIn.social({
				provider: 'google',
				callbackURL: resolvedNextPath,
				errorCallbackURL: buildSignInPath()
			});

			if (error) {
				errorMessage = getGoogleSignInErrorMessage({
					description: error.message,
					hasTypedEmail: isEmailLike(normalizeIdentifier(identifier))
				});
				return;
			}

			if (data?.url) {
				navigateToExternalUrl(data.url);
				return;
			}

			errorMessage = 'Failed to start Google sign in.';
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : 'Failed to start Google sign in.';
		} finally {
			googlePending = false;
		}
	};

	const signIn = async () => {
		errorMessage = '';
		infoMessage = '';
		dismissGoogleAuthCallbackError = true;
		pending = true;
		try {
			const resolvedEmail = await resolveIdentifierEmail(identifier);
			resolvedCredentialEmail = resolvedEmail;
			if (!resolvedEmail) {
				errorMessage = 'Invalid username, email, or password.';
				return;
			}

			const { error } = await authClient.signIn.email({
				email: resolvedEmail,
				password,
				callbackURL: resolvedNextPath,
				rememberMe
			});

			if (error) {
				if (isInvalidEmailError(error.message)) {
					showGlobalSnackbar({
						title: 'Invalid login',
						description: 'Enter a valid username or email and try again.'
					});
					return;
				}
				errorMessage = error.message ?? 'Failed to sign in.';
				return;
			}

			await goto(resolvedNextPath, { replaceState: true });
		} catch (error) {
			errorMessage =
				error instanceof Error
					? error.message
					: 'Unable to sign in right now. Please try again.';
		} finally {
			pending = false;
		}
	};

	const resendVerification = async () => {
		if (!identifier.trim()) return;
		errorMessage = '';
		infoMessage = '';
		dismissGoogleAuthCallbackError = true;
		pending = true;
		try {
			const resolvedEmail = resolvedCredentialEmail ?? (await resolveIdentifierEmail(identifier));
			if (!resolvedEmail) {
				errorMessage = 'Enter a valid username or email to resend verification.';
				return;
			}
			const { error } = await authClient.sendVerificationEmail({
				email: resolvedEmail,
				callbackURL: resolvedNextPath
			});
			if (error) {
				errorMessage = error.message ?? 'Failed to resend verification email.';
				return;
			}
			infoMessage = 'Verification email sent. Check your inbox and spam folder.';
		} catch (error) {
			errorMessage =
				error instanceof Error
					? error.message
					: 'Failed to resend verification email.';
		} finally {
			pending = false;
		}
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

						<Field class="flex flex-col gap-2">
							<FieldLabel for="email" required class="type-field-label text-gray-900">
								Username or email
							</FieldLabel>
							<Input
								id="email"
								type="text"
								bind:value={identifier}
								autocomplete="username"
								placeholder="Enter your username or email"
								class="h-12 border-gray-300 bg-white px-4 text-base"
							/>
						</Field>

						<Field class="flex flex-col gap-2">
							<FieldLabel for="password" required class="type-field-label text-gray-900">
								Password
							</FieldLabel>
							<div class="relative">
								<Input
									id="password"
									type={showPassword ? 'text' : 'password'}
									bind:value={password}
									autocomplete="current-password"
									placeholder="Enter your password"
									class="h-12 border-gray-300 bg-white px-4 pr-11 text-base"
								/>
								<button
									type="button"
									onclick={() => (showPassword = !showPassword)}
									onmousedown={(event) => event.preventDefault()}
									class="absolute inset-y-0 right-3 inline-flex size-5 cursor-pointer items-center justify-center self-center rounded-sm text-gray-500 transition-colors duration-200 hover:bg-transparent hover:text-gray-700 focus:outline-none focus-visible:outline-none focus-visible:ring-0 active:bg-transparent"
									aria-label={showPassword ? 'Hide password' : 'Show password'}
									aria-pressed={showPassword}
								>
									{#if showPassword}
										<EyeOffIcon class="size-5" />
									{:else}
										<EyeIcon class="size-5" />
									{/if}
								</button>
							</div>
						</Field>

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

					{#if activeErrorMessage}
						<Alert variant="destructive" class="mt-5">
							<AlertTitle>Sign in failed</AlertTitle>
							<AlertDescription>{activeErrorMessage}</AlertDescription>
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
								disabled={pending || googlePending || !identifier.trim()}
								onclick={() => void resendVerification()}
							>
								Resend verification email
							</Button>
						{/if}
						<Button
							variant="default"
							size="xl"
							class="h-12 w-full"
							disabled={pending || googlePending || !identifier.trim() || !password}
							onclick={() => void signIn()}
						>
							{pending ? 'Logging in...' : 'Log in'}
						</Button>
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
