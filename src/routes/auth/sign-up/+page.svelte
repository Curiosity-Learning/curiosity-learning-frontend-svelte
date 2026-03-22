<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '@iconify/svelte';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { InputOtp } from '$lib/components/ui/input-otp';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import { DateSelectField, InputField } from '$lib/components/app/form';
	import { showGlobalSnackbar } from '$lib/components/app/snackbar';
	import { authClient } from '$lib/auth-client';
	import { api } from '$convex/_generated/api';
	import { useConvexClient } from 'convex-svelte';
	import successImage from '$lib/assets/images/success.png';

	const session = authClient.useSession();
	const convexClient = useConvexClient();

	const OTP_LENGTH = 6;
	const OTP_RESEND_COOLDOWN_SECONDS = 30;
	const EMAIL_POST_VERIFY_RETRY_DELAY_MS = 500;
	const EMAIL_POST_VERIFY_MAX_ATTEMPTS = 12;
	const SIGNUP_DRAFT_STORAGE_KEY = 'cl_signup_draft_v1';
	const POST_SIGNUP_PENDING_KEY = 'cl_post_signup_pending_v1';

	const parseSignUpStep = (value: string | null): 3 | 4 | 5 => {
		if (value === '5') return 5;
		if (value === '4') return 4;
		return 3;
	};

	const resolvePostSignupNextPath = (path: string) => {
		if (path.startsWith('/onboarding/join-club/')) {
			return '/';
		}
		return path;
	};

	let step = $state<3 | 4 | 5>(parseSignUpStep(page.url.searchParams.get('step')));

	let birthMonth = $state('');
	let birthYear = $state('');

	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let acceptedTerms = $state(false);
	let showPassword = $state(false);
	let showConfirmPassword = $state(false);

	let otpCode = $state('');
	let resendCooldownSeconds = $state(0);
	let cooldownTimer: ReturnType<typeof setInterval> | null = null;
	let awaitingEmailPostVerify = $state(false);
	let completingEmailPostVerify = $state(false);

	let pending = $state(false);
	let googleRedirectPending = $state(false);
	let googlePostSignUpPending = $state(false);
	let errorMessage = $state('');
	let infoMessage = $state('');
	let showSuccessScreen = $state(false);
	let successContinuePending = $state(false);
	let handledGooglePostSignUp = $state(false);
	let hydratedDraft = $state(false);
	let postSignupRedirecting = $state(false);

	let rawNextPath = $derived(page.url.searchParams.get('next') ?? '/');
	let nextPath = $derived(rawNextPath.startsWith('/') ? rawNextPath : '/');
	let existingGoogleAccount = $derived(page.url.searchParams.get('existingGoogleAccount') === '1');
	let isGooglePostSocial = $derived(page.url.searchParams.get('postSocial') === 'google');
	let postSignupNextPath = $derived(resolvePostSignupNextPath(nextPath));
	let forceSignup = $derived(page.url.searchParams.get('forceSignup') === '1');
	let backPath = $derived.by(() => {
		if (nextPath.startsWith('/onboarding/start-club')) return '/onboarding/start-club?step=2';
		if (nextPath.startsWith('/onboarding/join-club/')) return nextPath;
		if (nextPath.startsWith('/onboarding/join-club')) return '/onboarding/join-club';
		return '/onboarding/get-started';
	});
	let signUpPathForCurrentStep = $derived.by(() => {
		const params = new URLSearchParams();
		if (nextPath !== '/') {
			params.set('next', nextPath);
		}
		if (step !== 3) {
			params.set('step', String(step));
		}
		if (forceSignup) {
			params.set('forceSignup', '1');
		}
		const query = params.toString();
		return query.length > 0 ? `/auth/sign-up?${query}` : '/auth/sign-up';
	});
	let verificationCallbackPath = $derived.by(() => {
		const params = new URLSearchParams();
		if (nextPath !== '/') {
			params.set('next', nextPath);
		}
		params.set('step', '5');
		if (forceSignup) {
			params.set('forceSignup', '1');
		}
		return `/auth/sign-up?${params.toString()}`;
	});
	let postSignupPath = $derived.by(() => {
		const params = new URLSearchParams();
		if (postSignupNextPath !== '/') {
			params.set('next', postSignupNextPath);
		}
		const query = params.toString();
		return query.length > 0 ? `/onboarding/post-signup?${query}` : '/onboarding/post-signup';
	});
	let signInPath = $derived.by(() => {
		if (nextPath === '/') {
			return '/auth/sign-in';
		}
		return `/auth/sign-in?next=${encodeURIComponent(nextPath)}`;
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

	const resetEmailPostVerifyState = () => {
		awaitingEmailPostVerify = false;
		completingEmailPostVerify = false;
	};

	onDestroy(() => {
		stopResendCooldown();
	});

	let age = $derived(calculateAge(birthMonth, birthYear));
	let isMinor = $derived(age !== null && age < 13);
	let isOver16 = $derived(age !== null && age > 16);
	let canContinuePersonalStep = $derived(birthMonth.length > 0 && birthYear.length > 0);
	let isOtpComplete = $derived(otpCode.length === OTP_LENGTH);
	let formSubmissionPending = $derived(pending || googleRedirectPending || googlePostSignUpPending);
	let otpSyncInProgress = $derived(pending || awaitingEmailPostVerify || completingEmailPostVerify);
	let showExistingGoogleAccountProcessing = $derived(
		existingGoogleAccount && !showSuccessScreen && !errorMessage && !$session.data
	);
	let showGooglePostSignUpProcessing = $derived(
		isGooglePostSocial && !showSuccessScreen && !errorMessage
	);

	const formatDateOfBirth = (month: string, year: string) => {
		if (!month || !year) return undefined;
		const monthIndex = monthOptions.indexOf(month);
		if (monthIndex < 0) return undefined;
		return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
	};

	const deriveNameFromEmail = (rawEmail: string) => {
		const localPart = rawEmail.trim().split('@')[0] ?? '';
		const normalized = localPart
			.replace(/[._-]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		return normalized.length > 0 ? normalized : 'Learner';
	};

	const isAlreadyExistsError = (message?: string) => {
		const normalized = message?.toLowerCase() ?? '';
		return (
			(normalized.includes('already') &&
				(normalized.includes('exists') || normalized.includes('registered'))) ||
			normalized.includes('duplicate') ||
			normalized.includes('in use')
		);
	};

	const isAlreadyVerifiedError = (message?: string) => {
		const normalized = message?.toLowerCase() ?? '';
		return normalized.includes('already verified');
	};

	type SignupDraft = {
		birthMonth: string;
		birthYear: string;
		email: string;
		acceptedTerms: boolean;
		step: 3 | 4 | 5;
		nextPath: string;
		forceSignup: boolean;
		updatedAt: number;
	};

	const readSignupDraft = (): SignupDraft | null => {
		if (!browser) return null;
		try {
			const raw = sessionStorage.getItem(SIGNUP_DRAFT_STORAGE_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as Partial<SignupDraft>;
			if (!parsed || typeof parsed !== 'object') return null;
			return {
				birthMonth: typeof parsed.birthMonth === 'string' ? parsed.birthMonth : '',
				birthYear: typeof parsed.birthYear === 'string' ? parsed.birthYear : '',
				email: typeof parsed.email === 'string' ? parsed.email : '',
				acceptedTerms: Boolean(parsed.acceptedTerms),
				step: parsed.step === 4 || parsed.step === 5 ? parsed.step : 3,
				nextPath: typeof parsed.nextPath === 'string' ? parsed.nextPath : '/',
				forceSignup: Boolean(parsed.forceSignup),
				updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
			};
		} catch {
			return null;
		}
	};

	const writeSignupDraft = () => {
		if (!browser || showSuccessScreen) return;
		const draft: SignupDraft = {
			birthMonth,
			birthYear,
			email: email.trim(),
			acceptedTerms,
			step,
			nextPath,
			forceSignup,
			updatedAt: Date.now()
		};
		try {
			sessionStorage.setItem(SIGNUP_DRAFT_STORAGE_KEY, JSON.stringify(draft));
		} catch {
			// Ignore storage errors.
		}
	};

	const clearSignupDraft = () => {
		if (!browser) return;
		try {
			sessionStorage.removeItem(SIGNUP_DRAFT_STORAGE_KEY);
		} catch {
			// Ignore storage errors.
		}
	};

	const setPostSignupPending = () => {
		if (!browser) return;
		try {
			sessionStorage.setItem(POST_SIGNUP_PENDING_KEY, '1');
		} catch {
			// Ignore storage errors.
		}
	};

	const clearPostSignupPending = () => {
		if (!browser) return;
		try {
			sessionStorage.removeItem(POST_SIGNUP_PENDING_KEY);
		} catch {
			// Ignore storage errors.
		}
	};

	const isPostSignupPending = () => {
		if (!browser) return false;
		try {
			return sessionStorage.getItem(POST_SIGNUP_PENDING_KEY) === '1';
		} catch {
			return false;
		}
	};

	const completeSignupProfile = async (signUpWith: 'email' | 'google') => {
		await convexClient.mutation(api.auth.completeSignupProfile, {
			signUpWith,
			dateOfBirth: formatDateOfBirth(birthMonth, birthYear),
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

	const sanitizeUrlForHistory = (url: URL) => {
		const query = url.searchParams.toString();
		return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
	};

	const clearPostSocialFromUrl = () => {
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		url.searchParams.delete('postSocial');
		history.replaceState(history.state, '', sanitizeUrlForHistory(url));
	};

	const clearExistingGoogleAccountFromUrl = () => {
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		url.searchParams.delete('existingGoogleAccount');
		history.replaceState(history.state, '', sanitizeUrlForHistory(url));
	};

	const showSuccessAndContinue = () => {
		showSuccessScreen = true;
		successContinuePending = false;
		errorMessage = '';
		infoMessage = '';
		clearSignupDraft();
	};

	const continueFromSuccess = async () => {
		if (successContinuePending) return;
		successContinuePending = true;
		try {
			setPostSignupPending();
			await goto(postSignupPath, { replaceState: true });
		} finally {
			successContinuePending = false;
		}
	};

	const goToAccountDetailsStep = () => {
		errorMessage = '';
		infoMessage = '';
		resetEmailPostVerifyState();
		clearOtp();
		stopResendCooldown();
		step = 4;
		syncStepInUrl(4);
	};

	const goBack = async () => {
		errorMessage = '';
		infoMessage = '';

		if (step === 5) {
			resetEmailPostVerifyState();
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

		const { error } = await authClient.signUp.email({
			name: deriveNameFromEmail(sanitizedEmail),
			email: sanitizedEmail,
			password,
			callbackURL: verificationCallbackPath
		});
		pending = false;

		if (error) {
			const errorText = error.message ?? 'Failed to create account.';

			// Common flow after "Change" from OTP screen: account row already exists but email is not verified yet.
			// Match large-app UX by resending OTP and returning user to verification instead of hard-failing signup.
			if (isAlreadyExistsError(errorText)) {
				pending = true;
				const { error: resendError } = await authClient.emailOtp.sendVerificationOtp({
					email: sanitizedEmail,
					type: 'email-verification'
				});
				pending = false;

				if (!resendError) {
					step = 5;
					syncStepInUrl(5);
					clearOtp();
					resetEmailPostVerifyState();
					startResendCooldown();
					infoMessage = `We sent a new 6-digit verification code to ${sanitizedEmail}.`;
					showGlobalSnackbar({
						title: 'Verification code sent',
						description: 'Please check your inbox for the latest code.'
					});
					return;
				}

				if (isAlreadyVerifiedError(resendError.message) || isAlreadyExistsError(resendError.message)) {
					errorMessage = 'This email is already registered. Please sign in instead.';
					return;
				}

				errorMessage = resendError.message ?? 'Failed to send verification code.';
				return;
			}

			errorMessage = errorText;
			return;
		}

		step = 5;
		syncStepInUrl(5);
		clearOtp();
		resetEmailPostVerifyState();
		infoMessage = `We sent a 6-digit verification code to ${sanitizedEmail}.`;
	};

	const signUpWithGoogle = async () => {
		errorMessage = '';
		infoMessage = '';

		if (!isOver16) {
			errorMessage = 'Google sign up is available only for users older than 16.';
			return;
		}

		if (!acceptedTerms) {
			errorMessage = 'Please accept the terms and conditions to continue.';
			return;
		}

		googleRedirectPending = true;
		const existingAccountParams = new URLSearchParams();
		existingAccountParams.set('next', nextPath);
		existingAccountParams.set('existingGoogleAccount', '1');
		existingAccountParams.set('step', String(step));
		if (forceSignup) {
			existingAccountParams.set('forceSignup', '1');
		}

		const socialCallbackParams = new URLSearchParams();
		socialCallbackParams.set('next', nextPath);
		socialCallbackParams.set('postSocial', 'google');
		socialCallbackParams.set('step', String(step));
		const socialCallbackUrl = `/auth/sign-up?${socialCallbackParams.toString()}`;
		const { data, error } = await authClient.signIn.social({
			provider: 'google',
			callbackURL: `/auth/sign-in?${existingAccountParams.toString()}`,
			newUserCallbackURL: socialCallbackUrl,
			requestSignUp: true
		});

		if (error) {
			googleRedirectPending = false;
			errorMessage = error.message ?? 'Failed to start Google sign up.';
			return;
		}

		if (data?.url) {
			await goto(data.url);
			return;
		}

		googleRedirectPending = false;
		errorMessage = 'Failed to start Google sign up.';
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
		showGlobalSnackbar({
			title: 'Email resent',
			description: "We've resent the email. Please check your inbox."
		});
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
			if (isAlreadyVerifiedError(error.message)) {
				resetEmailPostVerifyState();
				awaitingEmailPostVerify = true;
				infoMessage = 'Email already verified. Finalizing your account...';
				await finalizeEmailPostVerify();
				return;
			}
			errorMessage = error.message ?? 'Invalid verification code.';
			return;
		}

		resetEmailPostVerifyState();
		awaitingEmailPostVerify = true;
		infoMessage = 'Email verified. Finalizing your account...';
		await finalizeEmailPostVerify();
	};

	const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	const ensureSessionAfterOtp = async () => {
		try {
			const existingSession = await authClient.getSession({
				query: { disableCookieCache: true }
			});
			if (existingSession?.data) {
				return true;
			}
		} catch {
			// Continue to explicit sign-in fallback.
		}

		if (!email.trim() || !password) {
			return false;
		}

		const { error } = await authClient.signIn.email({
			email: email.trim(),
			password,
			callbackURL: verificationCallbackPath
		});
		if (error) {
			return false;
		}

		try {
			const postSignInSession = await authClient.getSession({
				query: { disableCookieCache: true }
			});
			return Boolean(postSignInSession?.data);
		} catch {
			return false;
		}
	};

	const finalizeEmailPostVerify = async () => {
		if (!awaitingEmailPostVerify || completingEmailPostVerify || showSuccessScreen) return;
		completingEmailPostVerify = true;
		errorMessage = '';

		try {
			const hasSession = await ensureSessionAfterOtp();
			if (!hasSession) {
				resetEmailPostVerifyState();
				infoMessage = '';
				showGlobalSnackbar({
					title: 'Email verified',
					description: 'Finishing your account is taking longer than expected. Please tap Verify again.'
				});
				errorMessage = 'We verified your email, but could not finish setup yet. Please tap Verify again.';
				return;
			}

			for (let attempt = 0; attempt < EMAIL_POST_VERIFY_MAX_ATTEMPTS; attempt += 1) {
				try {
					await completeSignupProfile('email');
					resetEmailPostVerifyState();
					infoMessage = '';
					showSuccessAndContinue();
					return;
				} catch (profileError) {
					const message =
						profileError instanceof Error
							? profileError.message
							: 'Unable to save profile details. Please try again.';

					if (!message.toLowerCase().includes('unauthenticated')) {
						throw profileError;
					}

					try {
						await authClient.getSession({
							query: { disableCookieCache: true }
						});
					} catch {
						// Keep retrying within capped attempts.
					}
					await delay(EMAIL_POST_VERIFY_RETRY_DELAY_MS);
				}
			}

			resetEmailPostVerifyState();
			errorMessage = 'Session sync is taking too long. Please sign in again and continue.';
			infoMessage = '';
		} catch (profileError) {
			const message =
				profileError instanceof Error
					? profileError.message
					: 'Unable to save profile details. Please try again.';

			resetEmailPostVerifyState();
			errorMessage = message;
			infoMessage = '';
		} finally {
			completingEmailPostVerify = false;
		}
	};

	$effect(() => {
		const sanitized = otpCode.replace(/\D/g, '').slice(0, OTP_LENGTH);
		if (sanitized !== otpCode) {
			otpCode = sanitized;
		}
	});

	$effect(() => {
		if (!browser || hydratedDraft) return;
		hydratedDraft = true;
		const draft = readSignupDraft();
		if (!draft) return;
		if (!email.trim() && draft.email) {
			email = draft.email;
		}
		if (!birthMonth && draft.birthMonth) {
			birthMonth = draft.birthMonth;
		}
		if (!birthYear && draft.birthYear) {
			birthYear = draft.birthYear;
		}
		if (!acceptedTerms && draft.acceptedTerms) {
			acceptedTerms = true;
		}
		if (step === 3 && (draft.step === 4 || draft.step === 5)) {
			step = draft.step;
			syncStepInUrl(draft.step);
		}
	});

	$effect(() => {
		writeSignupDraft();
	});

	$effect(() => {
		if (!browser) return;
		if (postSignupRedirecting) return;
		if (!isPostSignupPending()) return;
		if (!$session.data) {
			clearPostSignupPending();
			return;
		}
		postSignupRedirecting = true;
		void goto(postSignupPath, { replaceState: true }).finally(() => {
			postSignupRedirecting = false;
		});
	});

	$effect(() => {
		if ($session.data) {
			if (existingGoogleAccount) {
				clearExistingGoogleAccountFromUrl();
				showGlobalSnackbar({
					title: 'Account already exists',
					description: 'You already have an account with Google. We signed you in.'
				});
				void goto(nextPath, { replaceState: true });
				return;
			}
			if (isPostSignupPending()) {
				void goto(postSignupPath, { replaceState: true });
				return;
			}
			if (showSuccessScreen) {
				return;
			}
			if (isGooglePostSocial) {
				if (handledGooglePostSignUp) {
					return;
				}
				handledGooglePostSignUp = true;
				googlePostSignUpPending = true;
				void (async () => {
					try {
						await completeSignupProfile('google');
						clearPostSocialFromUrl();
						showSuccessAndContinue();
					} catch (error) {
						clearPostSocialFromUrl();
						errorMessage =
							error instanceof Error
								? error.message
								: 'Unable to finish Google sign up. Please retry.';
					} finally {
						googlePostSignUpPending = false;
					}
				})();
				return;
			}
			if (step === 5 && awaitingEmailPostVerify) {
				void finalizeEmailPostVerify();
				return;
			}
			if (forceSignup) {
				return;
			}
			void goto(nextPath);
		}
	});
</script>

{#if showSuccessScreen}
	<div class="flex min-h-screen items-center justify-center bg-white px-4">
		<div class="mx-auto flex w-full max-w-[22rem] flex-col items-center gap-3 text-center">
			<img src={successImage} alt="Account verification success" class="h-auto w-[11.5rem] object-contain" />
			<h1 class="text-[2rem] leading-[2.5rem] font-bold text-gray-900">Hooray!</h1>
			<p class="text-base leading-7 text-gray-600">
				Your email account has been successfully created and verified.
			</p>
			<Button
				variant="default"
				size="xl"
				class="mt-4 h-12 w-full"
				disabled={successContinuePending}
				onclick={() => void continueFromSuccess()}
			>
				{successContinuePending ? 'Loading...' : 'Next'}
			</Button>
		</div>
	</div>
{:else if showExistingGoogleAccountProcessing}
	<div class="flex min-h-screen items-center justify-center bg-white px-4">
		<div class="mx-auto flex w-full max-w-[22rem] flex-col items-center gap-4 text-center">
			<div class="inline-flex size-14 items-center justify-center rounded-full bg-orange-50 text-orange-500">
				<LoaderCircleIcon class="size-7 animate-spin" />
			</div>
			<h1 class="text-[2rem] leading-[2.5rem] font-bold text-gray-900">Signing you in</h1>
			<p class="text-base leading-7 text-gray-600">
				This Google account already exists. We are continuing with your existing account.
			</p>
		</div>
	</div>
{:else if showGooglePostSignUpProcessing}
	<div class="flex min-h-screen items-center justify-center bg-white px-4">
		<div class="mx-auto flex w-full max-w-[22rem] flex-col items-center gap-4 text-center">
			<div class="inline-flex size-14 items-center justify-center rounded-full bg-orange-50 text-orange-500">
				<LoaderCircleIcon class="size-7 animate-spin" />
			</div>
			<h1 class="text-[2rem] leading-[2.5rem] font-bold text-gray-900">Connecting your Google account</h1>
			<p class="text-base leading-7 text-gray-600">
				Finalizing your signup. This should only take a moment.
			</p>
		</div>
	</div>
{:else}
	<FlowShell step={step} total={5} showSideIllustration={true} showAccountLink={false}>
		{#snippet headerSupplement()}
			<div class="flex items-center justify-between gap-4">
				<button
					type="button"
					onclick={() => void goBack()}
					class="inline-flex w-fit items-center text-gray-500 transition-colors duration-200 hover:text-gray-700"
					aria-label="Go back"
				>
					<ChevronLeftIcon class="size-7" />
				</button>

				<a
					href={signInPath}
					class="hidden items-center gap-2 text-base font-bold text-orange-500 transition-colors duration-200 hover:text-orange-600 sm:inline-flex"
				>
					<span>I have an account</span>
					<ArrowRightIcon class="size-5" />
				</a>
			</div>
		{/snippet}

		<div class="mx-auto flex w-full max-w-[28.75rem] flex-1 flex-col gap-6">
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
							disabled={formSubmissionPending}
							onclick={() => void signUpWithGoogle()}
						>
							{#if googleRedirectPending}
								<LoaderCircleIcon class="size-4 animate-spin" />
								Continuing with Google...
							{:else}
								<Icon icon="logos:google-icon" width="20" height="20" aria-hidden="true" />
								Continue with Google
							{/if}
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
						id="password"
						label="Password"
						required={true}
						type={showPassword ? 'text' : 'password'}
						bind:value={password}
						autocomplete="new-password"
						placeholder="Enter your password"
						inputClass="bg-white"
						>
							{#snippet trailing()}
							<button
								type="button"
								onclick={() => (showPassword = !showPassword)}
								onmousedown={(event) => {
									event.preventDefault();
								}}
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

					<InputField
						id="confirmPassword"
						label="Confirm password"
						required={true}
						type={showConfirmPassword ? 'text' : 'password'}
						bind:value={confirmPassword}
						autocomplete="new-password"
						placeholder="Enter your password again"
						inputClass="bg-white"
					>
						{#snippet trailing()}
							<button
								type="button"
								onclick={() => (showConfirmPassword = !showConfirmPassword)}
								onmousedown={(event) => {
									event.preventDefault();
								}}
								class="inline-flex size-5 cursor-pointer items-center justify-center rounded-sm text-gray-500 transition-colors duration-200 hover:bg-transparent hover:text-gray-700 focus:outline-none focus-visible:outline-none focus-visible:ring-0 active:bg-transparent"
								aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
								aria-pressed={showConfirmPassword}
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
						disabled={formSubmissionPending || !email.trim() || !password || !confirmPassword}
						onclick={() => void signUp()}
					>
						{pending ? 'Creating account...' : 'Sign up'}
					</Button>
				</div>
			{:else}
				<div class="flex flex-col gap-5">
					<div class="flex flex-col gap-1.5">
						<h1 class="type-step-title text-gray-900">Verify your email address</h1>
						<p class="text-sm leading-6 text-gray-500">
							This helps us keep your account secure. We've sent a verification link to:
						</p>
					</div>

					<div class="flex items-center justify-between border-b border-gray-200 pb-3">
						<p class="text-base leading-7 font-bold text-gray-700">{email.trim()}</p>
						<Button
							variant="ghost"
							class="h-auto px-0 py-0 text-sm leading-6 font-bold text-orange-500 hover:bg-transparent hover:text-orange-600 active:bg-transparent"
							disabled={otpSyncInProgress}
							onclick={goToAccountDetailsStep}
						>
							Change
						</Button>
					</div>

					<div class="flex flex-col gap-3">
						<p class="text-sm leading-6 text-gray-500">Please enter your code below:</p>
						<InputOtp
							bind:value={otpCode}
							maxlength={OTP_LENGTH}
							disabled={otpSyncInProgress}
							cellClass={otpSyncInProgress ? 'border-gray-200 bg-gray-100 text-gray-400' : undefined}
						/>
					</div>

					<div class="flex items-center gap-1 text-sm leading-6 text-gray-500">
						<span>Didn't receive your code?</span>
						<Button
							variant="ghost"
							class="h-auto px-0 py-0 text-sm leading-6 font-bold hover:bg-transparent active:bg-transparent"
							disabled={otpSyncInProgress || resendCooldownSeconds > 0}
							onclick={() => void resendVerificationOtp()}
						>
							{#if resendCooldownSeconds > 0}
								<span class="text-gray-400">Resend ({resendCooldownSeconds}s)</span>
							{:else}
								<span class="text-orange-500 hover:text-orange-600">Resend</span>
							{/if}
						</Button>
					</div>
				</div>

				{#if infoMessage && !errorMessage}
					<Alert>
						<AlertDescription>{infoMessage}</AlertDescription>
					</Alert>
				{/if}

				{#if errorMessage}
					<Alert variant="destructive">
						<AlertTitle>Verification failed</AlertTitle>
						<AlertDescription>{errorMessage}</AlertDescription>
					</Alert>
				{/if}

				<div class="mt-auto pb-2 sm:pb-6">
					<Button
						variant="default"
						size="xl"
						class="h-12 w-full"
						disabled={otpSyncInProgress || !isOtpComplete}
						onclick={() => void verifyOtp()}
					>
						{#if otpSyncInProgress}
							<LoaderCircleIcon class="size-4 animate-spin" />
							{awaitingEmailPostVerify || completingEmailPostVerify ? 'Finalizing' : 'Verifying'}
						{:else}
							Verify
						{/if}
					</Button>
				</div>
			{/if}
		</div>
	</FlowShell>
{/if}
