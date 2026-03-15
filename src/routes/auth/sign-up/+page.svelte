<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '@iconify/svelte';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { InputOtp } from '$lib/components/ui/input-otp';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import { DateSelectField, InputField } from '$lib/components/app/form';
	import { authClient } from '$lib/auth-client';
	import { api } from '$convex/_generated/api';
	import { useConvexClient } from 'convex-svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const session = authClient.useSession();
	const convexClient = useConvexClient();

	const OTP_LENGTH = 6;
	const OTP_RESEND_COOLDOWN_SECONDS = 30;

	const parseSignUpStep = (value: string | null): 3 | 4 | 5 => {
		if (value === '5') return 5;
		if (value === '4') return 4;
		return 3;
	};

	let step = $state<3 | 4 | 5>(parseSignUpStep(page.url.searchParams.get('step')));

	let birthMonth = $state('');
	let birthYear = $state('');

	let email = $state('');
	let username = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let acceptedTerms = $state(false);
	let showPassword = $state(false);
	let showConfirmPassword = $state(false);

	let otpCode = $state('');
	let resendCooldownSeconds = $state(0);
	let cooldownTimer: ReturnType<typeof setInterval> | null = null;

	let pending = $state(false);
	let errorMessage = $state('');
	let infoMessage = $state('');

	let rawNextPath = $derived(page.url.searchParams.get('next') ?? '/');
	let nextPath = $derived(rawNextPath.startsWith('/') ? rawNextPath : '/');
	let backPath = $derived(
		nextPath.startsWith('/onboarding/start-club') ? '/onboarding/start-club?step=2' : '/onboarding/get-started'
	);
	let signUpPathForCurrentStep = $derived.by(() => {
		const params = new URLSearchParams();
		if (nextPath !== '/') {
			params.set('next', nextPath);
		}
		if (step !== 3) {
			params.set('step', String(step));
		}
		const query = params.toString();
		return query.length > 0 ? `/auth/sign-up?${query}` : '/auth/sign-up';
	});
	let termsHref = $derived(`/terms?backTo=${encodeURIComponent(signUpPathForCurrentStep)}`);

	const monthOptions = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];

	const calculateAge = (month: string, year: string) => {
		if (!month || !year) return null;
		const monthIndex = monthOptions.indexOf(month);
		if (monthIndex < 0) return null;
		// Day is intentionally omitted in this flow; use end-of-month for a conservative age check.
		const dob = new Date(Number(year), monthIndex + 1, 0);
		if (Number.isNaN(dob.getTime())) return null;
		const today = new Date();
		let age = today.getFullYear() - dob.getFullYear();
		const hasBirthdayPassed =
			today.getMonth() > dob.getMonth() ||
			(today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
		if (!hasBirthdayPassed) {
			age -= 1;
		}
		return age;
	};

	const clearOtp = () => {
		otpCode = '';
	};

	const startResendCooldown = () => {
		if (cooldownTimer) {
			clearInterval(cooldownTimer);
		}
		resendCooldownSeconds = OTP_RESEND_COOLDOWN_SECONDS;
		cooldownTimer = setInterval(() => {
			if (resendCooldownSeconds <= 1) {
				resendCooldownSeconds = 0;
				if (cooldownTimer) {
					clearInterval(cooldownTimer);
					cooldownTimer = null;
				}
				return;
			}
			resendCooldownSeconds -= 1;
		}, 1000);
	};

	const stopResendCooldown = () => {
		if (cooldownTimer) {
			clearInterval(cooldownTimer);
			cooldownTimer = null;
		}
		resendCooldownSeconds = 0;
	};

	onDestroy(() => {
		stopResendCooldown();
	});

	let age = $derived(calculateAge(birthMonth, birthYear));
	let isMinor = $derived(age !== null && age < 13);
	let isOver16 = $derived(age !== null && age > 16);
	let isGoogleOAuthEnabled = $derived(data.googleOAuthEnabled);
	let canContinuePersonalStep = $derived(birthMonth.length > 0 && birthYear.length > 0);
	let isOtpComplete = $derived(otpCode.length === OTP_LENGTH);

	const formatDateOfBirth = (month: string, year: string) => {
		if (!month || !year) return undefined;
		const monthIndex = monthOptions.indexOf(month);
		if (monthIndex < 0) return undefined;
		return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
	};

	const completeSignupProfile = async (signUpWith: 'email' | 'google') => {
		const normalizedUsername = username.trim().toLowerCase() || undefined;
		await convexClient.mutation(api.auth.ensureProfile, {});
		await convexClient.mutation(api.auth.completeSignupProfile, {
			signUpWith,
			dateOfBirth: formatDateOfBirth(birthMonth, birthYear),
			username: normalizedUsername,
			nextPath
		});
	};

	const syncStepInUrl = (targetStep: 3 | 4 | 5) => {
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		if (targetStep === 3) {
			url.searchParams.delete('step');
		} else {
			url.searchParams.set('step', String(targetStep));
		}
		const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
		const next = `${url.pathname}${url.search}${url.hash}`;
		if (current !== next) {
			history.replaceState(history.state, '', next);
		}
	};

	const goBack = async () => {
		errorMessage = '';
		infoMessage = '';

		if (step === 5) {
			step = 4;
			syncStepInUrl(4);
			return;
		}

		if (step === 4) {
			step = 3;
			syncStepInUrl(3);
			return;
		}

		await goto(backPath);
	};

	const goToAccountStep = () => {
		errorMessage = '';
		if (!canContinuePersonalStep) {
			errorMessage = 'Please complete all required fields before continuing.';
			return;
		}
		step = 4;
		syncStepInUrl(4);
	};

	const signUp = async () => {
		errorMessage = '';
		infoMessage = '';

		if (!acceptedTerms) {
			errorMessage = 'Please accept the terms and conditions to continue.';
			return;
		}

		if (password !== confirmPassword) {
			errorMessage = 'Passwords do not match.';
			return;
		}

		pending = true;
		const sanitizedEmail = email.trim();

		const { data, error } = await authClient.signUp.email({
			name: username.trim(),
			email: sanitizedEmail,
			password,
			callbackURL: nextPath
		});
		pending = false;

		if (error) {
			errorMessage = error.message ?? 'Failed to create account.';
			return;
		}

		if (data?.token) {
			try {
				await completeSignupProfile('email');
			} catch (error) {
				errorMessage =
					error instanceof Error
						? error.message
						: 'Unable to save profile details. Please try again.';
				return;
			}
			await goto(nextPath);
			return;
		}

		step = 5;
		syncStepInUrl(5);
		clearOtp();
		infoMessage = `We sent a 6-digit verification code to ${sanitizedEmail}.`;
	};

	const signUpWithGoogle = async () => {
		errorMessage = '';
		infoMessage = '';

		if (!isOver16) {
			errorMessage = 'Google sign up is available only for users older than 16.';
			return;
		}
		if (!isGoogleOAuthEnabled) {
			errorMessage = 'Google sign up is not configured yet. Please use email sign up for now.';
			return;
		}

		if (!acceptedTerms) {
			errorMessage = 'Please accept the terms and conditions to continue.';
			return;
		}

		pending = true;
		const socialCallbackParams = new URLSearchParams();
		socialCallbackParams.set('next', nextPath);
		socialCallbackParams.set('postSocial', 'google');
		socialCallbackParams.set('step', String(step));
		const socialCallbackUrl = `/auth/sign-up?${socialCallbackParams.toString()}`;
		const { data, error } = await authClient.signIn.social({
			provider: 'google',
			callbackURL: socialCallbackUrl,
			newUserCallbackURL: socialCallbackUrl,
			requestSignUp: true
		});
		pending = false;

		if (error) {
			errorMessage = error.message ?? 'Failed to start Google sign up.';
			return;
		}

		if (data?.url) {
			await goto(data.url);
		}
	};

	const resendVerificationOtp = async () => {
		if (!email.trim() || resendCooldownSeconds > 0) return;

		pending = true;
		errorMessage = '';
		infoMessage = '';

		const { error } = await authClient.emailOtp.sendVerificationOtp({
			email: email.trim(),
			type: 'email-verification'
		});
		pending = false;

		if (error) {
			errorMessage = error.message ?? 'Failed to send verification code.';
			return;
		}

		clearOtp();
		startResendCooldown();
		infoMessage = 'A new verification code has been sent.';
	};

	const verifyOtp = async () => {
		errorMessage = '';
		infoMessage = '';

		if (!isOtpComplete) {
			errorMessage = 'Enter the complete 6-digit verification code.';
			return;
		}

		pending = true;
		const { error } = await authClient.emailOtp.verifyEmail({
			email: email.trim(),
			otp: otpCode
		});
		pending = false;

		if (error) {
			errorMessage = error.message ?? 'Invalid verification code.';
			return;
		}

		try {
			await completeSignupProfile('email');
		} catch (profileError) {
			errorMessage =
				profileError instanceof Error
					? profileError.message
					: 'Unable to save profile details. Please try again.';
			return;
		}

		await goto(nextPath);
	};

	$effect(() => {
		const sanitized = otpCode.replace(/\D/g, '').slice(0, OTP_LENGTH);
		if (sanitized !== otpCode) {
			otpCode = sanitized;
		}
	});

	$effect(() => {
		if ($session.data) {
			if (page.url.searchParams.get('postSocial') === 'google') {
				void (async () => {
					try {
						await completeSignupProfile('google');
						await goto(nextPath, { replaceState: true });
					} catch (error) {
						errorMessage =
							error instanceof Error
								? error.message
								: 'Unable to finish Google sign up. Please retry.';
					}
				})();
				return;
			}
			void goto(nextPath);
		}
	});
</script>

<FlowShell step={step} total={5}>
	<div class="mx-auto flex w-full max-w-[28.75rem] flex-1 flex-col gap-6">
		<button
			type="button"
			onclick={() => void goBack()}
			class="inline-flex w-fit items-center text-gray-500 transition-colors duration-200 hover:text-gray-700"
			aria-label="Go back"
		>
			<ChevronLeftIcon class="size-7" />
		</button>

		{#if step === 3}
			<div class="flex flex-col gap-5">
				<h1 class="type-step-title text-gray-900">Enter your personal information</h1>

				<DateSelectField
					idPrefix="date-of-birth"
					label="Date of birth"
					required={true}
					includeDay={false}
					months={monthOptions}
					bind:month={birthMonth}
					bind:year={birthYear}
				/>
			</div>

			{#if errorMessage}
				<Alert variant="destructive">
					<AlertTitle>Can’t continue yet</AlertTitle>
					<AlertDescription>{errorMessage}</AlertDescription>
				</Alert>
			{/if}

			<div class="mt-auto pb-2 sm:pb-6">
				<Button
					variant="default"
					size="xl"
					class="h-12 w-full"
					disabled={!canContinuePersonalStep}
					onclick={goToAccountStep}
				>
					Continue
				</Button>
			</div>
		{:else if step === 4}
			<div class="flex flex-col gap-4">
				<h1 class="type-step-title text-gray-900">Enter your account details</h1>

				<div class="flex items-center gap-2 pt-1">
					<Checkbox bind:checked={acceptedTerms} id="terms" />
					<label for="terms" class="cursor-pointer text-sm leading-6 text-gray-600">
						I agree to the
						<a href={termsHref} class="font-medium text-orange-500">Terms and conditions</a>
					</label>
				</div>

				{#if isOver16}
					<Button
						variant="outline"
						size="xl"
						class="h-12 w-full text-black hover:text-black active:text-black"
						disabled={pending}
						onclick={() => void signUpWithGoogle()}
					>
						<Icon icon="logos:google-icon" width="20" height="20" aria-hidden="true" />
						Continue with Google
					</Button>
				{/if}

				<InputField
					id="email"
					label={isMinor ? "Your parent or guardian's email" : 'Email'}
					required={true}
					type="email"
					bind:value={email}
					autocomplete="email"
					placeholder="john.doe@gmail.com"
					hint={isMinor
						? 'We’re excited to get you started, but we need to notify your parent or guardian about your account.'
						: undefined}
					hintClass={isMinor ? 'text-sm leading-6 text-gray-600' : undefined}
				/>

				<InputField
					id="username"
					label={isMinor ? 'Choose a username' : 'Username'}
					required={true}
					bind:value={username}
					autocomplete="username"
					placeholder="Enter your username"
				/>

				<InputField
					id="password"
					label="Password"
					required={true}
					type={showPassword ? 'text' : 'password'}
					bind:value={password}
					autocomplete="new-password"
					placeholder="Enter your password"
					>
						{#snippet trailing()}
						<button
							type="button"
							onclick={() => (showPassword = !showPassword)}
							class="text-gray-500"
							aria-label={showPassword ? 'Hide password' : 'Show password'}
						>
							{#if showPassword}
								<EyeOffIcon class="size-5" />
							{:else}
								<EyeIcon class="size-5" />
							{/if}
						</button>
					{/snippet}
				</InputField>

				<InputField
					id="confirmPassword"
					label="Confirm password"
					required={true}
					type={showConfirmPassword ? 'text' : 'password'}
					bind:value={confirmPassword}
					autocomplete="new-password"
					placeholder="Enter your password again"
				>
					{#snippet trailing()}
						<button
							type="button"
							onclick={() => (showConfirmPassword = !showConfirmPassword)}
							class="text-gray-500"
							aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
						>
							{#if showConfirmPassword}
								<EyeOffIcon class="size-5" />
							{:else}
								<EyeIcon class="size-5" />
							{/if}
						</button>
						{/snippet}
					</InputField>
			</div>

			{#if errorMessage}
				<Alert variant="destructive">
					<AlertTitle>Sign up failed</AlertTitle>
					<AlertDescription>{errorMessage}</AlertDescription>
				</Alert>
			{/if}

			<div class="mt-auto pb-2 sm:pb-6">
				<Button
					variant="default"
					size="xl"
					class="h-12 w-full"
					disabled={pending || !email.trim() || !username.trim() || !password || !confirmPassword}
					onclick={() => void signUp()}
				>
					{pending ? 'Creating account...' : 'Sign up'}
				</Button>
			</div>
		{:else}
			<div class="flex flex-col gap-4">
				<h1 class="type-step-title text-gray-900">Verify your email</h1>
				<p class="text-sm leading-6 text-gray-600">
					Enter the 6-digit verification code sent to
					<span class="font-semibold text-gray-900">{email.trim()}</span>.
				</p>

				<InputOtp bind:value={otpCode} maxlength={OTP_LENGTH} disabled={pending} />

				<Button
					variant="ghost"
					class="h-auto w-fit px-0"
					disabled={pending || resendCooldownSeconds > 0}
					onclick={() => void resendVerificationOtp()}
				>
					{#if resendCooldownSeconds > 0}
						Resend code in {resendCooldownSeconds}s
					{:else}
						Resend code
					{/if}
				</Button>
			</div>

			{#if errorMessage}
				<Alert variant="destructive">
					<AlertTitle>Verification failed</AlertTitle>
					<AlertDescription>{errorMessage}</AlertDescription>
				</Alert>
			{/if}

			{#if infoMessage}
				<Alert>
					<AlertTitle>Check your inbox</AlertTitle>
					<AlertDescription>{infoMessage}</AlertDescription>
				</Alert>
			{/if}

			<div class="mt-auto pb-2 sm:pb-6">
				<Button
					variant="default"
					size="xl"
					class="h-12 w-full"
					disabled={pending || !isOtpComplete}
					onclick={() => void verifyOtp()}
				>
					{pending ? 'Verifying...' : 'Verify email'}
				</Button>
			</div>
		{/if}
	</div>
</FlowShell>
