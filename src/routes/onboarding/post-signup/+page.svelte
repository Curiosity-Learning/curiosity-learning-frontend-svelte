<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import * as FileDropZone from '$lib/components/ui/file-drop-zone';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import { InputField } from '$lib/components/app/form';
	import { getUsernameValidationError, normalizeUsername } from '$lib/auth/username';
	import { createDebouncedLookup } from '$lib/forms/debounced-lookup';
	import { _, t } from '$lib/i18n';
	import { createMediaField } from '$lib/media/media-field.svelte';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { api } from '$convex/_generated/api';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const auth = useAuth();
	const convexClient = useConvexClient();
	const profileImageField = createMediaField(convexClient, 'profileImage', {
		mode: 'immediate'
	});
	const profileResponse = useStableQuery(api.profiles.getMe, () =>
		auth.isAuthenticated ? {} : 'skip'
	);
	const POST_SIGNUP_PENDING_KEY = 'cl_post_signup_pending_v1';

	const parseStep = (value: string | null): 1 | 2 => (value === '2' ? 2 : 1);
	const resolveCompletionNextPath = (path: string) => {
		if (path.startsWith('/onboarding/join-club/')) {
			return '/';
		}
		return path;
	};

	const extractPendingClubCodeFromPath = (path: string) => {
		if (!path.startsWith('/onboarding/join-club/')) return undefined;
		const rawCode = path.slice('/onboarding/join-club/'.length).split(/[?#/]/)[0] ?? '';
		const normalizedCode = rawCode.trim().toUpperCase();
		return /^[A-Z0-9]{6}$/.test(normalizedCode) ? normalizedCode : undefined;
	};

	let step = $state<1 | 2>(parseStep(page.url.searchParams.get('step')));
	let username = $state('');
	let agreedAll = $state(false);
	let pending = $state(false);
	let usernamePrefilled = $state(false);
	let usernameTouched = $state(false);
	let usernameAvailability = $state<
		'idle' | 'invalid' | 'checking' | 'available' | 'taken' | 'error'
	>('idle');
	let usernameAvailabilityMessage = $state('');
	let formErrorMessage = $state('');
	let completionRedirected = $state(false);

	let rawNextPath = $derived(page.url.searchParams.get('next') ?? '/');
	let nextPath = $derived(rawNextPath.startsWith('/') ? rawNextPath : '/');
	let completionNextPath = $derived(resolveCompletionNextPath(nextPath));
	const pledgesResponse = useStableQuery(api.pledges.listActive, () =>
		auth.isAuthenticated ? {} : 'skip'
	);
	const usernameLookup = createDebouncedLookup<boolean>(300);
	const pledgeItems = $derived(pledgesResponse.data ?? []);
	let selfPath = $derived.by(() => {
		const params = new SvelteURLSearchParams();
		if (completionNextPath !== '/') {
			params.set('next', completionNextPath);
		}
		if (step === 2) {
			params.set('step', '2');
		}
		const query = params.toString();
		return query.length > 0 ? `/onboarding/post-signup?${query}` : '/onboarding/post-signup';
	});

	const syncStepInUrl = (targetStep: 1 | 2) => {
		if (!browser) return;
		const url = new URL(window.location.href);
		if (targetStep === 1) {
			url.searchParams.delete('step');
		} else {
			url.searchParams.set('step', '2');
		}
		const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
		const next = `${url.pathname}${url.search}${url.hash}`;
		if (current !== next) {
			history.replaceState(history.state, '', next);
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
	let awaitingSignupSession = $derived(
		!auth.isLoading && !auth.isAuthenticated && isPostSignupPending()
	);

	onDestroy(() => {
		usernameLookup.stop();
		profileImageField.destroy();
	});

	let persistedProfileImageUrl = $derived.by(() => {
		const profileImageAssetId = profileResponse.data?.profileImageMediaAssetId ?? null;
		if (profileImageAssetId && data.initialProfileImage?.assetId === profileImageAssetId) {
			return data.initialProfileImage.signedUrl;
		}

		if (profileImageAssetId) {
			return null;
		}

		return null;
	});
	let profileImageNeedsReady = $derived(
		profileImageField.hasUploadedAsset && !profileImageField.isReady
	);
	let profileImageError = $derived(
		profileImageField.phase === 'failed' ? profileImageField.errorMessage : ''
	);
	let initialUsername = $derived(profileResponse.data?.username?.trim().toLowerCase() ?? '');
	let usernameFieldError = $derived(
		usernameTouched || normalizeUsername(username) ? usernameAvailabilityMessage : ''
	);
	let usernameFieldHint = $derived.by(() => {
		if (usernameAvailability === 'checking') return t('auth.signUp.checkingUsername');
		if (usernameAvailability === 'available' && normalizeUsername(username) !== initialUsername) {
			return t('auth.signUp.usernameAvailable');
		}
		return '';
	});
	let usernameUnavailable = $derived(
		usernameAvailability === 'invalid' ||
			usernameAvailability === 'checking' ||
			usernameAvailability === 'taken' ||
			usernameAvailability === 'error'
	);
	let nextDisabled = $derived(
		pending ||
			profileImageField.isBusy ||
			profileImageNeedsReady ||
			!username.trim() ||
			usernameUnavailable ||
			Boolean(profileImageError)
	);

	$effect(() => {
		if (usernamePrefilled) return;
		if (!profileResponse.data) return;
		usernamePrefilled = true;
		if (!username.trim()) {
			username = profileResponse.data.username ?? '';
		}
	});

	$effect(() => {
		const normalized = normalizeUsername(username);
		usernameLookup.stop();
		usernameAvailabilityMessage = '';

		if (!normalized) {
			usernameAvailability = 'idle';
			return;
		}

		const validationError = getUsernameValidationError(normalized);
		if (validationError) {
			usernameAvailability = 'invalid';
			usernameAvailabilityMessage = validationError;
			return;
		}

		if (normalized === initialUsername) {
			usernameAvailability = 'available';
			return;
		}

		usernameLookup.schedule({
			key: normalized,
			onStart: () => {
				usernameAvailability = 'checking';
			},
			lookup: () =>
				convexClient.query(api.profiles.checkUsernameAvailability, {
					username: normalized
				}),
			onSuccess: (available) => {
				usernameAvailability = available ? 'available' : 'taken';
				usernameAvailabilityMessage = available ? '' : t('auth.signUp.usernameTaken');
			},
			onError: () => {
				usernameAvailability = 'error';
				usernameAvailabilityMessage = t('auth.signUp.usernameCheckFailed');
			}
		});
	});

	$effect(() => {
		if (completionRedirected) return;
		if (isPostSignupPending()) return;
		if (!profileResponse.data?.firstLoginCompleted) return;
		completionRedirected = true;
		clearPostSignupPending();
		void goto(completionNextPath, { replaceState: true });
	});

	$effect(() => {
		if (auth.isLoading) return;
		if (auth.isAuthenticated) return;
		if (isPostSignupPending()) return;
		const next = encodeURIComponent(selfPath);
		void goto(`/auth/sign-in?next=${next}`, { replaceState: true });
	});

	const uploadProfileImage = async (files: File[]) => {
		formErrorMessage = '';
		try {
			await profileImageField.selectFiles(files);
		} catch (error) {
			formErrorMessage =
				error instanceof Error
					? error.message
					: t('onboarding.postSignup.profileImageUploadFailedDescription');
		}
	};

	const saveProfileAndContinue = async () => {
		usernameTouched = true;
		formErrorMessage = '';
		const normalizedUsername = normalizeUsername(username);
		const validationError = getUsernameValidationError(normalizedUsername);
		if (validationError) {
			usernameAvailability = normalizedUsername ? 'invalid' : 'idle';
			usernameAvailabilityMessage = validationError;
			return;
		}
		if (usernameAvailability === 'checking') {
			formErrorMessage = t('auth.signUp.waitForUsernameCheck');
			return;
		}
		if (usernameAvailability === 'taken') {
			usernameAvailabilityMessage = t('auth.signUp.usernameTaken');
			return;
		}
		if (usernameAvailability === 'error') {
			formErrorMessage = t('auth.signUp.usernameCheckFailed');
			return;
		}

		pending = true;
		try {
			await profileImageField.ensureUploaded();
			if (profileImageField.hasUploadedAsset && !profileImageField.isReady) {
				throw new Error(
					profileImageField.errorMessage ||
						t('onboarding.postSignup.profileImageUploadFailedDescription')
				);
			}
			await profileImageField.persistAttached(async (assetId) => {
				await convexClient.mutation(api.profiles.updateMe, {
					username: normalizedUsername,
					profileImageMediaAssetId: assetId ?? undefined
				});
			});
			step = 2;
			syncStepInUrl(2);
		} catch (error) {
			let errorMessage = t('onboarding.postSignup.saveProfileFailedDescription');
			if (error instanceof Error) {
				const message = error.message;
				const match = message.match(/ConvexError:\s*(.+?)(?:\s+at\s+|$)/);
				errorMessage = match ? match[1] : message;
			}
			formErrorMessage = errorMessage;
		} finally {
			pending = false;
		}
	};

	const completeOnboarding = async () => {
		formErrorMessage = '';
		if (!agreedAll) {
			formErrorMessage = t('onboarding.postSignup.confirmationRequiredDescription');
			return;
		}

		pending = true;
		try {
			const pendingClubCode =
				profileResponse.data?.pendingClubCode?.trim().toUpperCase() ??
				extractPendingClubCodeFromPath(nextPath);
			if (pendingClubCode) {
				const result = await convexClient.mutation(api.clubs.joinClubWithCode, {
					code: pendingClubCode
				});
				if (!result.ok) {
					formErrorMessage =
						result.error === 'rate_limited'
							? t('onboarding.joinClub.rateLimited')
							: t('onboarding.joinClubDetails.invalidDescription');
					return;
				}
				if (browser) {
					try {
						localStorage.setItem('cl_last_club_id', result.clubId);
					} catch {
						// Ignore storage errors.
					}
				}
				clearPostSignupPending();
				await goto(`/club/${result.clubId}`, { replaceState: true });
				return;
			}

			await convexClient.mutation(api.profiles.updateMe, {
				firstLoginCompleted: true
			});
			clearPostSignupPending();
			await goto(completionNextPath, { replaceState: true });
		} catch (error) {
			formErrorMessage =
				error instanceof Error
					? error.message
					: t('onboarding.postSignup.finishOnboardingFailedDescription');
		} finally {
			pending = false;
		}
	};
</script>

{#if awaitingSignupSession}
	<div class="app-texture-background flex min-h-screen items-center justify-center px-4">
		<div class="mx-auto flex w-full max-w-[22rem] flex-col items-center gap-4 text-center">
			<div
				class="inline-flex size-14 items-center justify-center rounded-full bg-orange-50 text-orange-500"
			>
				<LoaderCircleIcon class="size-7 animate-spin" />
			</div>
			<h1 class="text-[2rem] leading-[2.5rem] font-bold text-gray-900">
				{$_('onboarding.postSignup.restoringTitle')}
			</h1>
			<p class="text-base leading-7 text-gray-600">
				{$_('onboarding.postSignup.restoringDescription')}
			</p>
		</div>
	</div>
{:else}
	<FlowShell
		{step}
		total={2}
		showAccountLink={false}
		showProgressBar={false}
		showSideIllustration={true}
	>
		<div class="mx-auto flex w-full max-w-[28.75rem] flex-1 flex-col gap-6">
			{#if step === 1}
				<div class="flex flex-col gap-5">
					<h1 class="type-step-title text-gray-900">{$_('onboarding.postSignup.profileTitle')}</h1>

					<InputField
						id="username"
						label={$_('onboarding.postSignup.usernameLabel')}
						required={true}
						bind:value={username}
						autocomplete="username"
						placeholder={$_('onboarding.postSignup.usernamePlaceholder')}
						hint={usernameFieldHint}
						hintClass={usernameAvailability === 'available' ? 'text-emerald-700' : undefined}
						error={usernameFieldError}
					/>

					<div class="flex flex-col gap-3">
						<p class="type-field-label text-gray-900">
							{$_('onboarding.postSignup.profileImageLabel')}
						</p>
						<FileDropZone.Root
							accept={profileImageField.accept}
							maxFiles={1}
							fileCount={0}
							maxFileSize={profileImageField.maxBytes}
							disabled={profileImageField.isBusy || pending}
							onUpload={uploadProfileImage}
						>
							<div class="flex items-center gap-3">
								<div
									class="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-200 bg-gray-100"
								>
									{#if profileImageField.localPreviewUrl}
										<img
											src={profileImageField.localPreviewUrl}
											alt={$_('onboarding.postSignup.profilePreviewAlt')}
											class="size-full object-cover"
										/>
									{:else if persistedProfileImageUrl}
										<img
											src={persistedProfileImageUrl}
											alt={$_('onboarding.postSignup.profilePreviewAlt')}
											class="size-full object-cover"
										/>
									{:else}
										<span class="text-xs font-semibold text-gray-500">{$_('common.noImage')}</span>
									{/if}
								</div>
								<div class="flex min-w-0 flex-1 flex-col gap-2">
									<FileDropZone.Trigger class="contents">
										<div
											class="flex min-h-20 items-center justify-between gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-left text-gray-600 transition-all hover:cursor-pointer hover:bg-orange-50"
										>
											<div class="flex min-w-0 flex-col gap-1">
												<p class="text-sm font-semibold text-gray-900">
													{#if profileImageField.phase === 'processing'}
														Processing image...
													{:else if profileImageField.isBusy}
														{$_('onboarding.postSignup.uploadingImage')}
													{:else if profileImageField.isReady}
														Image uploaded
													{:else}
														{$_('onboarding.postSignup.dropOrChooseImage')}
													{/if}
												</p>
												<p class="type-sm text-gray-500">
													{#if profileImageField.phase === 'processing'}
														Hang tight while we finish preparing your profile picture.
													{:else if profileImageField.isReady}
														Your profile picture is ready.
													{:else}
														{$_('onboarding.postSignup.imageRequirements')}
													{/if}
												</p>
											</div>
											<div
												class="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-primary shadow-xs"
											>
												{#if profileImageField.isBusy}
													<LoaderCircleIcon class="size-3.5 animate-spin" />
												{/if}
												<span>
													{#if profileImageField.phase === 'processing'}
														Processing
													{:else if profileImageField.isBusy}
														{$_('onboarding.postSignup.uploading')}
													{:else if profileImageField.isReady}
														Ready
													{:else}
														{$_('common.browse')}
													{/if}
												</span>
											</div>
										</div>
									</FileDropZone.Trigger>
								</div>
							</div>
						</FileDropZone.Root>
						{#if profileImageError}
							<p class="type-body-compact text-red-700">{profileImageError}</p>
						{:else if profileImageField.phase === 'processing'}
							<p class="type-body-compact text-gray-600">Processing your image before you can continue.</p>
						{:else if profileImageField.isReady}
							<p class="type-body-compact text-emerald-700">Profile picture uploaded and ready.</p>
						{/if}
					</div>
				</div>
			{:else}
				<div class="flex flex-col gap-5">
					<h1 class="type-step-title text-gray-900">{$_('onboarding.postSignup.pledgesTitle')}</h1>
					<p class="type-body text-gray-600">
						{$_('onboarding.postSignup.pledgesDescription')}
					</p>

					<div class="flex flex-col gap-3">
						{#if pledgeItems.length > 0}
							{#each pledgeItems as item (item._id)}
								<details class="group rounded-lg border border-gray-200 bg-white">
									<summary
										class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3"
									>
										<span class="type-body-bold text-gray-900">{item.title}</span>
										<ChevronDownIcon
											class="size-4 shrink-0 text-gray-500 transition-transform group-open:rotate-180"
										/>
									</summary>
									<div class="flex flex-col gap-3 px-4 pb-4">
										<p class="type-body text-gray-600">{item.description}</p>
										{#if item.bullets.length > 0}
											<ul class="type-body list-disc space-y-1 pl-5 text-gray-600">
												{#each item.bullets as bullet, bulletIndex (bulletIndex)}
													<li>{bullet}</li>
												{/each}
											</ul>
										{/if}
									</div>
								</details>
							{/each}
						{:else if !pledgesResponse.data}
							<div
								class="type-body-compact rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-600"
							>
								{$_('onboarding.postSignup.pledgesLoading')}
							</div>
						{:else}
							<div
								class="type-body-compact rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-600"
							>
								{$_('onboarding.postSignup.pledgesEmpty')}
							</div>
						{/if}
					</div>

					<div class="flex items-center gap-2 pt-1">
						<Checkbox bind:checked={agreedAll} id="agree-all-post-signup" />
						<label
							for="agree-all-post-signup"
							class="type-body cursor-pointer text-gray-600"
						>
							{$_('onboarding.postSignup.agreeAll')}
						</label>
					</div>
				</div>
			{/if}

			{#if formErrorMessage}
				<Alert variant="destructive">
					<AlertTitle>
						{step === 1
							? $_('onboarding.postSignup.saveProfileFailedTitle')
							: $_('onboarding.postSignup.finishOnboardingFailedTitle')}
					</AlertTitle>
					<AlertDescription>{formErrorMessage}</AlertDescription>
				</Alert>
			{/if}

			<div class="mt-auto pb-2 sm:pb-6">
				{#if step === 1}
					<Button
						variant="default"
						size="xl"
						class="h-12 w-full"
						disabled={nextDisabled}
						onclick={() => void saveProfileAndContinue()}
					>
						{pending ? $_('common.saving') : $_('common.next')}
					</Button>
				{:else}
					<Button
						variant="default"
						size="xl"
						class="h-12 w-full"
						disabled={pending || !agreedAll}
						onclick={() => void completeOnboarding()}
					>
						{pending ? $_('common.finishing') : $_('common.next')}
					</Button>
				{/if}
			</div>
		</div>
	</FlowShell>
{/if}

<style>
	details > summary::-webkit-details-marker {
		display: none;
	}
</style>
