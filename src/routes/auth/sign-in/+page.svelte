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
	import { normalizeAuthError } from '$lib/auth/error-handler';
	import { navigateAfterAuthChange } from '$lib/auth/navigation';
	import { _, t } from '$lib/i18n';
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
			? t('auth.signIn.existingGoogleJoinClub')
			: t('auth.signIn.existingGoogleDefault');

	let rawNextPath = $derived(page.url.searchParams.get('next'));
	let nextPath = $derived(normalizePostSignInPath(rawNextPath));
	let forceSignup = $derived(page.url.searchParams.get('forceSignup') === '1');
	let resolvedNextPath = $derived(nextPath);
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
		(value ?? '')
			.toLowerCase()
			.replaceAll(/[_+%-]+/g, ' ')
			.trim();

	const getGoogleSignInErrorMessage = (args: {
		code?: string | null;
		description?: string | null;
		hasTypedEmail?: boolean;
	}) => {
		const combined =
			`${normalizeGoogleAuthError(args.code)} ${normalizeGoogleAuthError(args.description)}`.trim();
		if (!combined) {
			return '';
		}
		if (combined.includes('signup disabled')) {
			return args.hasTypedEmail
				? t('auth.signIn.noAccountForEmail')
				: t('auth.signIn.noAccountForGoogleEmail');
		}
		if (
			combined.includes("email doesn't match") ||
			combined.includes('email doesnt match') ||
			combined.includes('different emails') ||
			combined.includes('unable to link account') ||
			combined.includes('account already linked')
		) {
			return t('auth.signIn.linkMismatch');
		}
		if (combined.includes('oauth provider not found')) {
			return t('auth.signIn.providerNotConfigured');
		}
		return t('auth.signIn.googleUnavailable');
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

	const isPendingConsentLogin = async (rawIdentifier: string) => {
		const normalizedIdentifier = normalizeIdentifier(rawIdentifier);
		if (!normalizedIdentifier || isEmailLike(normalizedIdentifier)) {
			return false;
		}
		const status = await convexClient.query(api.auth.getUsernameLoginStatus, {
			username: normalizedIdentifier
		});
		return status.parentConsentStatus === 'pending';
	};

	$effect(() => {
		if (!existingGoogleAccount) return;
		if (auth.isAuthenticated) return;
		infoMessage = t('auth.signIn.existingGoogleInfo');
	});

	$effect(() => {
		if (existingGoogleAccountHandled) return;
		if (!existingGoogleAccount) return;
		if (forceSignup) return;
		if (auth.isLoading || !auth.isAuthenticated) return;
		showGlobalSnackbar({
			title: t('auth.signIn.existingGoogleTitle'),
			description: t('auth.signIn.existingGoogleDescription')
		});
		existingGoogleAccountHandled = true;
		void navigateAfterAuthChange(resolvedNextPath, { replaceState: true });
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
			void navigateAfterAuthChange(resolvedNextPath, { replaceState: true });
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
				const googleMessage = getGoogleSignInErrorMessage({
					description: error.message,
					hasTypedEmail: isEmailLike(normalizeIdentifier(identifier))
				});
				if (googleMessage) {
					errorMessage = googleMessage;
				} else {
					const normalizedError = normalizeAuthError(error);
					errorMessage = t(normalizedError.userMessage);
				}
				return;
			}

			if (data?.url) {
				navigateToExternalUrl(data.url);
				return;
			}

			errorMessage = t('auth.signIn.googleStartFailed');
		} catch (error) {
			const normalizedError = normalizeAuthError(error);
			errorMessage = t(normalizedError.userMessage);
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
			const normalizedIdentifier = normalizeIdentifier(identifier);
			const emailMode = isEmailLike(normalizedIdentifier);
			const result = emailMode
				? await authClient.signIn.email({
						email: normalizedIdentifier,
						password,
						callbackURL: resolvedNextPath,
						rememberMe
					})
				: await authClient.signIn.username({
						username: normalizedIdentifier,
						password,
						callbackURL: resolvedNextPath,
						rememberMe
					});
			const { error } = result;
			resolvedCredentialEmail = emailMode
				? normalizedIdentifier
				: await resolveIdentifierEmail(normalizedIdentifier);

			if (error) {
				if (isInvalidEmailError(error.message)) {
					errorMessage = t('auth.signIn.invalidLoginDescription');
					return;
				}
				if (await isPendingConsentLogin(normalizedIdentifier)) {
					errorMessage = t('auth.signIn.parentConsentPending');
					return;
				}
				const normalizedError = normalizeAuthError(error);
				errorMessage =
					normalizedError.type === 'unknown-error'
						? t('auth.errors.invalidCredentials')
						: t(normalizedError.userMessage);
				return;
			}

			await navigateAfterAuthChange(resolvedNextPath, { replaceState: true });
		} catch (error) {
			const normalizedError = normalizeAuthError(error);
			errorMessage = t(normalizedError.userMessage);
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
				errorMessage = t('auth.signIn.resendIdentifierRequired');
				return;
			}
			const { error } = await authClient.sendVerificationEmail({
				email: resolvedEmail,
				callbackURL: resolvedNextPath
			});
			if (error) {
				const normalizedError = normalizeAuthError(error);
				errorMessage = t(normalizedError.userMessage);
				return;
			}
			infoMessage = t('auth.signIn.resendSuccess');
		} catch (error) {
			const normalizedError = normalizeAuthError(error);
			errorMessage = t(normalizedError.userMessage);
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
						alt={$_('auth.signIn.illustrationAlt')}
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
						aria-label={$_('common.goBack')}
					>
						<ChevronLeftIcon class="size-7" />
					</button>

					<div class="mt-2 flex flex-col gap-5">
						<h1 class="type-step-title text-gray-900">{$_('auth.signIn.title')}</h1>

						<Field class="flex flex-col gap-2">
							<FieldLabel for="email" required class="type-field-label text-gray-900">
								{$_('auth.signIn.identifierLabel')}
							</FieldLabel>
							<Input
								id="email"
								type="text"
								bind:value={identifier}
								autocomplete="username"
								placeholder={$_('auth.signIn.identifierPlaceholder')}
								class="h-12 border-gray-300 bg-white px-4 text-base"
							/>
						</Field>

						<Field class="flex flex-col gap-2">
							<FieldLabel for="password" required class="type-field-label text-gray-900">
								{$_('auth.signIn.passwordLabel')}
							</FieldLabel>
							<div class="relative">
								<Input
									id="password"
									type={showPassword ? 'text' : 'password'}
									bind:value={password}
									autocomplete="current-password"
									placeholder={$_('auth.signIn.passwordPlaceholder')}
									class="h-12 border-gray-300 bg-white px-4 pr-11 text-base"
								/>
								<button
									type="button"
									onclick={() => (showPassword = !showPassword)}
									onmousedown={(event) => event.preventDefault()}
									class="absolute inset-y-0 right-3 inline-flex size-5 cursor-pointer items-center justify-center self-center rounded-sm text-gray-500 transition-colors duration-200 hover:bg-transparent hover:text-gray-700 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-transparent"
									aria-label={showPassword
										? $_('auth.signIn.hidePassword')
										: $_('auth.signIn.showPassword')}
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
									{$_('auth.signIn.rememberMe')}
								</label>
							</div>
							<a
								href={forgotHref}
								class="text-sm font-bold text-orange-500 transition-colors duration-200 hover:text-orange-600"
							>
								{$_('auth.signIn.forgotPassword')}
							</a>
						</div>
					</div>

					{#if activeErrorMessage}
						<Alert variant="destructive" class="mt-5">
							<AlertTitle>{$_('auth.signIn.errorTitle')}</AlertTitle>
							<AlertDescription>{activeErrorMessage}</AlertDescription>
						</Alert>
					{/if}

					{#if infoMessage}
						<Alert class="mt-5">
							<AlertTitle>{$_('common.checkEmail')}</AlertTitle>
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
								{$_('auth.signIn.resendVerification')}
							</Button>
						{/if}
						<Button
							variant="default"
							size="xl"
							class="h-12 w-full"
							disabled={pending || googlePending || !identifier.trim() || !password}
							onclick={() => void signIn()}
						>
							{pending ? $_('auth.signIn.submitting') : $_('auth.signIn.submit')}
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
								{$_('auth.signIn.continuingWithGoogle')}
							{:else}
								<Icon icon="logos:google-icon" width="20" height="20" aria-hidden="true" />
								{$_('auth.signIn.continueWithGoogle')}
							{/if}
						</Button>
						<Button
							variant="outline"
							size="xl"
							class="h-12 w-full"
							disabled={pending || googlePending}
							href={signUpHref}
						>
							{$_('common.newSignUp')}
						</Button>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
