<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { showGlobalSnackbar } from '$lib/components/app/snackbar';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import { InputField } from '$lib/components/app/form';
	import { authClient } from '$lib/auth-client';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';

	const session = authClient.useSession();
	const auth = useAuth();
	const convexClient = useConvexClient();
	const profileResponse = useStableQuery(api.profiles.getMe, () => ($session.data ? {} : 'skip'));
	const POST_SIGNUP_PENDING_KEY = 'cl_post_signup_pending_v1';

	const parseStep = (value: string | null): 1 | 2 => (value === '2' ? 2 : 1);

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
	let profileImageInput = $state<HTMLInputElement | null>(null);

	let rawNextPath = $derived(page.url.searchParams.get('next') ?? '/');
	let nextPath = $derived(rawNextPath.startsWith('/') ? rawNextPath : '/');
	const pledgesResponse = useStableQuery(api.pledges.listActive, () => (auth.isAuthenticated ? {} : 'skip'));
	const pledgeItems = $derived(pledgesResponse.data ?? []);
	let selfPath = $derived.by(() => {
		const params = new URLSearchParams();
		if (nextPath !== '/') {
			params.set('next', nextPath);
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
		if (!profileResponse.data?.firstLoginCompleted) return;
		completionRedirected = true;
		clearPostSignupPending();
		void goto(nextPath, { replaceState: true });
	});

	$effect(() => {
		if (auth.isLoading) return;
		if (auth.isAuthenticated) return;
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
					title: 'Unable to load pledges',
					description: error instanceof Error ? error.message : 'Please try again.'
				});
			})
			.finally(() => {
				pledgesSeeding = false;
			});
	});

	const normalizeUsername = (value: string) => value.trim().toLowerCase();
	const openProfileImagePicker = () => {
		if (profileImageUploading) return;
		profileImageInput?.click();
	};

	const handleProfileImageInput = async (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		if (!file.type.startsWith('image/')) {
			showGlobalSnackbar({
				title: 'Invalid file type',
				description: 'Please choose an image file.'
			});
			input.value = '';
			return;
		}

		revokeProfilePreview();
		localProfilePreviewUrl = URL.createObjectURL(file);
		profileImageUploading = true;

		try {
			const uploadUrl = await convexClient.mutation(api.media.generateUploadUrl, {});
			const uploadResponse = await fetch(uploadUrl, {
				method: 'POST',
				headers: file.type ? { 'Content-Type': file.type } : undefined,
				body: file
			});
			if (!uploadResponse.ok) {
				throw new Error('Profile image upload failed');
			}
			const uploadResult = (await uploadResponse.json()) as { storageId?: Id<'_storage'> };
			if (!uploadResult.storageId) {
				throw new Error('Profile image upload failed');
			}
			profileImageStorageId = uploadResult.storageId;
			showGlobalSnackbar({
				title: 'Profile image uploaded'
			});
		} catch (error) {
			profileImageStorageId = null;
			showGlobalSnackbar({
				title: 'Unable to upload profile image',
				description: error instanceof Error ? error.message : 'Please try again.'
			});
		} finally {
			profileImageUploading = false;
			input.value = '';
		}
	};

	const saveProfileAndContinue = async () => {
		const normalizedUsername = normalizeUsername(username);
		if (!normalizedUsername) {
			showGlobalSnackbar({
				title: 'Username is required'
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
				title: 'Unable to save profile details',
				description: error instanceof Error ? error.message : 'Please try again.'
			});
		} finally {
			pending = false;
		}
	};

	const completeOnboarding = async () => {
		if (!agreedAll) {
			showGlobalSnackbar({
				title: 'Confirmation required',
				description: 'Please read and accept all pledges before continuing.'
			});
			return;
		}

		pending = true;
		try {
			const pendingClubCode = profileResponse.data?.pendingClubCode?.trim().toUpperCase();
			if (pendingClubCode) {
				const result = await convexClient.mutation(api.clubs.joinClubWithCode, {
					code: pendingClubCode
				});
				clearPostSignupPending();
				await goto(`/club/${result.clubId}`, { replaceState: true });
				return;
			}

			await convexClient.mutation(api.profiles.updateMe, {
				firstLoginCompleted: true
			});
			clearPostSignupPending();
			await goto(nextPath, { replaceState: true });
		} catch (error) {
			showGlobalSnackbar({
				title: 'Unable to finish onboarding',
				description: error instanceof Error ? error.message : 'Please try again.'
			});
		} finally {
			pending = false;
		}
	};
</script>

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
				<h1 class="type-step-title text-gray-900">Set up your profile</h1>

				<InputField
					id="username"
					label="Username"
					required={true}
					bind:value={username}
					autocomplete="username"
					placeholder="Choose your username"
				/>

				<div class="flex flex-col gap-3">
					<p class="type-field-label text-gray-900">Profile image (optional)</p>
					<div class="flex items-center gap-3">
						<div
							class="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-gray-200 bg-gray-100"
						>
							{#if localProfilePreviewUrl}
								<img src={localProfilePreviewUrl} alt="Profile preview" class="size-full object-cover" />
							{:else if profileResponse.data?.coverPhotoUrl}
								<img
									src={profileResponse.data.coverPhotoUrl}
									alt="Profile preview"
									class="size-full object-cover"
								/>
							{:else}
								<span class="text-xs font-semibold text-gray-500">No image</span>
							{/if}
						</div>
						<div class="flex flex-col gap-2">
							<Button
								variant="outline"
								size="sm"
								class="cursor-pointer"
								type="button"
								disabled={profileImageUploading}
								onclick={openProfileImagePicker}
							>
								<UploadIcon class="size-4" />
								{profileImageUploading ? 'Uploading...' : 'Upload image'}
							</Button>
							<input
								id="profile-image-upload"
								type="file"
								accept="image/*"
								class="sr-only"
								bind:this={profileImageInput}
								onchange={(event) => void handleProfileImageInput(event)}
							/>
							<p class="text-xs text-gray-500">PNG, JPG, or WEBP.</p>
						</div>
					</div>
				</div>
			</div>
		{:else}
			<div class="flex flex-col gap-5">
				<h1 class="type-step-title text-gray-900">Read and accept our learning pledges</h1>
				<p class="text-sm leading-6 text-gray-600">
					We are committed to a safe and supportive learning space for every student. Please read
					and accept these pledges.
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
											{#each item.bullets as bullet}
												<li>{bullet}</li>
											{/each}
										</ul>
									{/if}
								</div>
							</details>
						{/each}
					{:else if pledgesSeeding || !pledgesResponse.data}
						<div class="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
							Loading pledge details...
						</div>
					{:else}
						<div class="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
							No pledge details available yet.
						</div>
					{/if}
				</div>

				<div class="flex items-center gap-2 pt-1">
					<Checkbox bind:checked={agreedAll} id="agree-all-post-signup" />
					<label for="agree-all-post-signup" class="cursor-pointer text-sm leading-6 text-gray-600">
						I have read and agree to all points above.
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
					{pending ? 'Saving...' : 'Next'}
				</Button>
			{:else}
				<Button
					variant="default"
					size="xl"
					class="h-12 w-full"
					disabled={pending || !agreedAll}
					onclick={() => void completeOnboarding()}
				>
					{pending ? 'Finishing...' : 'Next'}
				</Button>
			{/if}
		</div>
	</div>
</FlowShell>

<style>
	details > summary::-webkit-details-marker {
		display: none;
	}
</style>
