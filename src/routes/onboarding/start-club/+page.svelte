<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Button } from '$lib/components/ui/button';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import {
		InputField,
		SelectField,
		TextareaField,
		type SelectOption
	} from '$lib/components/app/form';
	import { authClient } from '$lib/auth-client';
	import { routes } from '$lib/routes';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { useConvexClient } from 'convex-svelte';

	const session = authClient.useSession();
	const convexClient = useConvexClient();

	let step = $derived<1 | 2>(page.url.searchParams.get('step') === '2' ? 2 : 1);

	let location = $state('');
	let userRole = $state('');
	let about = $state('');
	let referral = $state('');
	let videoFileName = $state('');
	let videoStorageId = $state<Id<'_storage'> | null>(null);
	let videoUploadPending = $state(false);
	let localVideoPreviewUrl = $state<string | null>(null);
	let previewVideoLoadFailed = $state(false);
	let pending = $state(false);
	let errorMessage = $state('');

	const roleOptions: SelectOption[] = [
		{ label: 'Teacher', value: 'Teacher' },
		{ label: 'Parent', value: 'Parent' },
		{ label: 'Student', value: 'Student' },
		{ label: 'Community organizer', value: 'Community organizer' },
		{ label: 'Mentor', value: 'Mentor' },
		{ label: 'Other', value: 'Other' }
	];

	let canContinueStepOne = $derived(
		location.trim().length > 0 && userRole.trim().length > 0 && about.trim().length > 0
	);

	const goBack = async () => {
		errorMessage = '';
		if (step === 2) {
			await goto('/onboarding/start-club', { replaceState: true });
			return;
		}
		await goto('/onboarding/get-started');
	};

	const goToStepTwo = async () => {
		errorMessage = '';
		if (!canContinueStepOne) {
			errorMessage = 'Please complete all required fields before continuing.';
			return;
		}
		await goto('/onboarding/start-club?step=2');
	};

	const revokeLocalVideoPreview = () => {
		if (!localVideoPreviewUrl) return;
		URL.revokeObjectURL(localVideoPreviewUrl);
		localVideoPreviewUrl = null;
	};

	const isValidVideoFile = (file: File) => file.type.startsWith('video/');

	let hasValidUploadedVideo = $derived(
		Boolean(videoStorageId && localVideoPreviewUrl && !previewVideoLoadFailed)
	);

	onDestroy(() => {
		revokeLocalVideoPreview();
	});

	const handleVideoFile = async (event: Event) => {
		const target = event.currentTarget as HTMLInputElement;
		const file = target.files?.[0];
		videoFileName = file?.name ?? '';
		videoStorageId = null;
		previewVideoLoadFailed = false;
		if (!file) return;
		if (!isValidVideoFile(file)) {
			errorMessage = 'Please choose a valid video file.';
			target.value = '';
			videoFileName = '';
			return;
		}

		revokeLocalVideoPreview();
		localVideoPreviewUrl = URL.createObjectURL(file);

		if (!$session.data) {
			errorMessage = 'Please sign in first, then upload the club video.';
			return;
		}

		videoUploadPending = true;
		errorMessage = '';
		try {
			const uploadUrl = await convexClient.mutation(api.media.generateUploadUrl, {});
			const uploadResponse = await fetch(uploadUrl, {
				method: 'POST',
				headers: file.type ? { 'Content-Type': file.type } : undefined,
				body: file
			});
			if (!uploadResponse.ok) {
				throw new Error('Video upload failed');
			}
			const uploadResult = (await uploadResponse.json()) as { storageId?: Id<'_storage'> };
			if (!uploadResult.storageId) {
				throw new Error('Video upload failed');
			}
			videoStorageId = uploadResult.storageId;
		} catch (error) {
			videoStorageId = null;
			errorMessage = error instanceof Error ? error.message : 'Unable to upload video right now.';
		} finally {
			videoUploadPending = false;
			target.value = '';
		}
	};

	const submitStartClub = async () => {
		errorMessage = '';

		if (!$session.data) {
			await goto(`/auth/sign-up?next=${encodeURIComponent('/onboarding/start-club?step=2')}`);
			return;
		}

		pending = true;
		try {
			const normalizedLocation = location.trim();
			const generatedName = normalizedLocation
				? `${normalizedLocation} Curiosity Club`
				: 'Curiosity Club';
			const result = await convexClient.mutation(api.clubs.createClub, {
				name: generatedName.slice(0, 100),
				description: about.trim() || undefined,
				location: normalizedLocation || undefined,
				videoStorageId: videoStorageId ?? undefined,
				meetingDay: undefined,
				meetingTime: undefined
			});
			await goto(result?.clubId ? routes.clubHome(result.clubId) : '/');
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unable to submit your application.';
		} finally {
			pending = false;
		}
	};
</script>

<FlowShell step={step} total={2} showAccountLink={!$session.data} showSideIllustration={true}>
	<div class="mx-auto flex w-full max-w-[28.75rem] flex-1 flex-col gap-6">
		<button
			type="button"
			onclick={() => void goBack()}
			class="inline-flex w-fit items-center text-gray-500 transition-colors duration-200 hover:text-gray-700"
			aria-label="Go back"
		>
			<ChevronLeftIcon class="size-7" />
		</button>

		{#if step === 1}
			<div class="flex flex-col gap-5">
				<h1 class="type-step-title text-gray-900">Add application details</h1>

				<InputField
					id="location"
					label="Where do you want to start a Curiosity Club?"
					required={true}
					bind:value={location}
					placeholder="Search for location..."
				/>

				<SelectField
					id="role"
					label="I am a..."
					required={true}
					bind:value={userRole}
					options={roleOptions}
					placeholder="Select an option"
				/>

				<TextareaField
					id="about"
					label="Who are you?"
					required={true}
					bind:value={about}
					rows={5}
					placeholder="Tell us a bit about yourself..."
					hint="Why do you want to do this? Why are you a right fit? What do you want to learn? Any related previous experiences? Links to previous experiences?"
				/>

				<InputField
					id="referral"
					label="How did you find out about us?"
					bind:value={referral}
					placeholder="LinkedIn or friend.."
				/>
			</div>

			{#if errorMessage}
				<p class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p>
			{/if}

			<div class="mt-auto pb-2 sm:pb-6">
				<Button
					variant="default"
					size="xl"
					class="h-12 w-full"
					disabled={!canContinueStepOne}
					onclick={() => void goToStepTwo()}
				>
					Continue
				</Button>
			</div>
		{:else}
			<div class="flex flex-col gap-5">
				<h1 class="type-step-title text-gray-900">Add video</h1>
				<div class="flex flex-col gap-2">
					<p class="text-[1.125rem] leading-8 font-bold text-gray-900">Upload a 1 min video answering the following:</p>
					<p class="text-base leading-7 text-gray-600">
						Why do you want to start a Curiosity Club? How do you see a Curiosity Club fit in your
						community?
					</p>
				</div>

				<div class="flex flex-col gap-3">
					<p class="text-[1.125rem] leading-8 font-bold text-gray-900">Upload a video from your gallery:</p>
					<label
						for="videoUpload"
						class="grid h-36 cursor-pointer place-items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-gray-600"
					>
						<input id="videoUpload" type="file" accept="video/*" class="hidden" onchange={handleVideoFile} />
						<PlusIcon class="size-8 text-gray-500" />
						<p class="text-base leading-7 font-medium text-gray-700">Upload your video</p>
						{#if videoFileName}
							<p class="text-sm text-gray-500">{videoFileName}</p>
						{/if}
						{#if videoUploadPending}
							<p class="text-xs font-semibold text-orange-500">Uploading video...</p>
						{:else if videoStorageId}
							<p class="text-xs font-semibold text-emerald-600">Video uploaded</p>
						{/if}
					</label>
					{#if hasValidUploadedVideo}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video
							src={localVideoPreviewUrl}
							controls
							preload="metadata"
							class="h-44 w-full rounded-lg border border-gray-200 bg-black object-cover"
							onerror={() => {
								previewVideoLoadFailed = true;
							}}
						></video>
					{/if}
				</div>
			</div>

			{#if errorMessage}
				<p class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p>
			{/if}

			<div class="mt-auto pb-2 sm:pb-6">
				<Button
					variant="default"
					size="xl"
					class="h-12 w-full"
					disabled={pending || videoUploadPending}
					onclick={() => void submitStartClub()}
				>
					{pending
						? 'Submitting...'
						: videoUploadPending
							? 'Uploading video...'
							: $session.data
								? 'Submit application'
								: 'Proceed to sign up'}
				</Button>
			</div>
		{/if}
	</div>
</FlowShell>
