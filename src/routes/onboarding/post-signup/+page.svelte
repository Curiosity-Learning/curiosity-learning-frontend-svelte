<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import * as FileDropZone from '$lib/components/ui/file-drop-zone';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { showGlobalSnackbar } from '$lib/components/app/snackbar';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import { InputField } from '$lib/components/app/form';
	import { _, t } from '$lib/i18n';
	import { uploadMediaAsset } from '$lib/auth/upload-media-asset';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';

	const auth = useAuth();
	const convexClient = useConvexClient();
	const profileResponse = useStableQuery(api.profiles.getMe, () => (auth.isAuthenticated ? {} : 'skip'));
	const POST_SIGNUP_PENDING_KEY = 'cl_post_signup_pending_v1';
	const PROFILE_IMAGE_ACCEPTED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
	const PROFILE_IMAGE_MAX_BYTES = 10 * FileDropZone.MEGABYTE;

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
	let profileImageStorageId = $state<Id<'_storage'> | null>(null);
	let localProfilePreviewUrl = $state<string | null>(null);
	let profileImageUploading = $state(false);
	let pending = $state(false);
	let usernamePrefilled = $state(false);
	let completionRedirected = $state(false);
	let pledgesSeedRequested = $state(false);
	let pledgesSeeding = $state(false);

	let rawNextPath = $derived(page.url.searchParams.get('next') ?? '/');
	let nextPath = $derived(rawNextPath.startsWith('/') ? rawNextPath : '/');
	let completionNextPath = $derived(resolveCompletionNextPath(nextPath));
	const pledgesResponse = useStableQuery(api.pledges.listActive, () => (auth.isAuthenticated ? {} : 'skip'));
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

	const revokeProfilePreview = () => {
		if (!localProfilePreviewUrl) return;
		URL.revokeObjectURL(localProfilePreviewUrl);
		localProfilePreviewUrl = null;
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
	let awaitingSignupSession = $derived(!auth.isLoading && !auth.isAuthenticated && isPostSignupPending());

	onDestroy(() => {
		revokeProfilePreview();
	});

	$effect(() => {
		if (usernamePrefilled) return;
		if (!profileResponse.data) return;
		usernamePrefilled = true;
		if (!username.trim()) {
			username = profileResponse.data.username ?? '';
		}
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

	$effect(() => {
		if (!auth.isAuthenticated) return;
		if (pledgesSeedRequested || pledgesSeeding) return;
		const pledges = pledgesResponse.data;
		if (!pledges) return;
		if (pledges.length > 0) return;
		pledgesSeedRequested = true;
		pledgesSeeding = true;

		void convexClient
			.mutation(api.pledges.seedDefaults, {})
			.catch((error) => {
				showGlobalSnackbar({
					title: t('onboarding.postSignup.loadPledgesFailedTitle'),
					description: error instanceof Error ? error.message : t('onboarding.postSignup.loadPledgesFailedDescription')
				});
			})
			.finally(() => {
				pledgesSeeding = false;
			});
	});

	const normalizeUsername = (value: string) => value.trim().toLowerCase();

	const uploadProfileImage = async (files: File[]) => {
		const file = files[0];
		if (!file) return;

		revokeProfilePreview();
		localProfilePreviewUrl = URL.createObjectURL(file);
		profileImageUploading = true;

		try {
			const uploadedAsset = await uploadMediaAsset(convexClient, file, {
				acceptedContentTypes: PROFILE_IMAGE_ACCEPTED_CONTENT_TYPES,
				maxBytes: PROFILE_IMAGE_MAX_BYTES,
				enableCompression: true,
				enableSafetyScreening: true
			});
			if (!uploadedAsset.storageId) {
				throw new Error(t('onboarding.postSignup.profileImageFinalizeFailure'));
			}

			profileImageStorageId = uploadedAsset.storageId;
			showGlobalSnackbar({
				title: t('onboarding.postSignup.profileImageUploadedTitle')
			});
		} catch (error) {
			profileImageStorageId = null;
			revokeProfilePreview();
			showGlobalSnackbar({
				title: t('onboarding.postSignup.profileImageUploadFailedTitle'),
				description: error instanceof Error ? error.message : t('onboarding.postSignup.profileImageUploadFailedDescription')
			});
		} finally {
			profileImageUploading = false;
		}
	};

	const saveProfileAndContinue = async () => {
		const normalizedUsername = normalizeUsername(username);
		if (!normalizedUsername) {
			showGlobalSnackbar({
				title: t('onboarding.postSignup.usernameRequiredTitle')
			});
			return;
		}

		pending = true;
		try {
			await convexClient.mutation(api.profiles.updateMe, {
				username: normalizedUsername,
				profileImageStorageId: profileImageStorageId ?? undefined
			});
			step = 2;
			syncStepInUrl(2);
		} catch (error) {
			showGlobalSnackbar({
				title: t('onboarding.postSignup.saveProfileFailedTitle'),
				description: error instanceof Error ? error.message : t('onboarding.postSignup.saveProfileFailedDescription')
			});
		} finally {
			pending = false;
		}
	};

	const completeOnboarding = async () => {
		if (!agreedAll) {
			showGlobalSnackbar({
				title: t('onboarding.postSignup.confirmationRequiredTitle'),
				description: t('onboarding.postSignup.confirmationRequiredDescription')
			});
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
			showGlobalSnackbar({
				title: t('onboarding.postSignup.finishOnboardingFailedTitle'),
				description: error instanceof Error ? error.message : t('onboarding.postSignup.finishOnboardingFailedDescription')
			});
		} finally {
			pending = false;
		}
	};
</script>

{#if awaitingSignupSession}
	<div class="flex min-h-screen items-center justify-center bg-white px-4">
		<div class="mx-auto flex w-full max-w-[22rem] flex-col items-center gap-4 text-center">
			<div class="inline-flex size-14 items-center justify-center rounded-full bg-orange-50 text-orange-500">
				<LoaderCircleIcon class="size-7 animate-spin" />
			</div>
			<h1 class="text-[2rem] leading-[2.5rem] font-bold text-gray-900">{$_('onboarding.postSignup.restoringTitle')}</h1>
			<p class="text-base leading-7 text-gray-600">
				{$_('onboarding.postSignup.restoringDescription')}
			</p>
		</div>
	</div>
{:else}
	<FlowShell
		step={step}
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
				/>

				<div class="flex flex-col gap-3">
					<p class="type-field-label text-gray-900">{$_('onboarding.postSignup.profileImageLabel')}</p>
					<FileDropZone.Root
						accept={PROFILE_IMAGE_ACCEPTED_CONTENT_TYPES.join(',')}
						maxFiles={1}
						fileCount={0}
						maxFileSize={PROFILE_IMAGE_MAX_BYTES}
						disabled={profileImageUploading || pending}
						onUpload={uploadProfileImage}
					>
						<div class="flex items-center gap-3">
							<div
								class="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-200 bg-gray-100"
							>
								{#if localProfilePreviewUrl}
									<img src={localProfilePreviewUrl} alt={$_('onboarding.postSignup.profilePreviewAlt')} class="size-full object-cover" />
								{:else if profileResponse.data?.coverPhotoUrl}
									<img
										src={profileResponse.data.coverPhotoUrl}
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
													{profileImageUploading ? $_('onboarding.postSignup.uploadingImage') : $_('onboarding.postSignup.dropOrChooseImage')}
												</p>
												<p class="text-xs text-gray-500">{$_('onboarding.postSignup.imageRequirements')}</p>
											</div>
											<div class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-primary shadow-xs">
												{profileImageUploading ? $_('onboarding.postSignup.uploading') : $_('common.browse')}
											</div>
										</div>
								</FileDropZone.Trigger>
							</div>
						</div>
					</FileDropZone.Root>
				</div>
			</div>
		{:else}
			<div class="flex flex-col gap-5">
				<h1 class="type-step-title text-gray-900">{$_('onboarding.postSignup.pledgesTitle')}</h1>
				<p class="text-sm leading-6 text-gray-600">
					{$_('onboarding.postSignup.pledgesDescription')}
				</p>

				<div class="flex flex-col gap-3">
					{#if pledgeItems.length > 0}
						{#each pledgeItems as item (item._id)}
							<details class="group rounded-lg border border-gray-200 bg-white">
								<summary
									class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3"
								>
									<span class="text-sm leading-6 font-bold text-gray-900">{item.title}</span>
									<ChevronDownIcon
										class="size-4 shrink-0 text-gray-500 transition-transform group-open:rotate-180"
									/>
								</summary>
								<div class="flex flex-col gap-3 px-4 pb-4">
									<p class="text-sm leading-6 text-gray-600">{item.description}</p>
									{#if item.bullets.length > 0}
										<ul class="list-disc space-y-1 pl-5 text-sm leading-6 text-gray-600">
											{#each item.bullets as bullet, bulletIndex (bulletIndex)}
												<li>{bullet}</li>
											{/each}
										</ul>
									{/if}
								</div>
							</details>
						{/each}
					{:else if pledgesSeeding || !pledgesResponse.data}
						<div class="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
							{$_('onboarding.postSignup.pledgesLoading')}
						</div>
					{:else}
						<div class="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
							{$_('onboarding.postSignup.pledgesEmpty')}
						</div>
					{/if}
				</div>

				<div class="flex items-center gap-2 pt-1">
					<Checkbox bind:checked={agreedAll} id="agree-all-post-signup" />
					<label for="agree-all-post-signup" class="cursor-pointer text-sm leading-6 text-gray-600">
						{$_('onboarding.postSignup.agreeAll')}
					</label>
				</div>
			</div>
			{/if}

			<div class="mt-auto pb-2 sm:pb-6">
				{#if step === 1}
					<Button
						variant="default"
						size="xl"
						class="h-12 w-full"
						disabled={pending || profileImageUploading || !username.trim()}
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
