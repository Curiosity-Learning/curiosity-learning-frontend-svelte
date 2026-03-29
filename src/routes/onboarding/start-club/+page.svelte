<script lang="ts">
	import { browser } from '$app/environment';
	import { env } from '$env/dynamic/public';
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteMap, SvelteURLSearchParams } from 'svelte/reactivity';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import * as FileDropZone from '$lib/components/ui/file-drop-zone';
	import { Button } from '$lib/components/ui/button';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import { uploadMediaAsset } from '$lib/auth/upload-media-asset';
	import MapboxLocationPreview from '$lib/components/app/mapbox-location-preview.svelte';
	import {
		DropdownField,
		InputField,
		TextareaField,
		type DropdownOption
	} from '$lib/components/app/form';
	import {
		MAPBOX_GEOCODING_LIMIT,
		MAPBOX_STYLE_URL,
		fetchMapboxLocationSuggestions,
		type MapboxCoordinates,
		type MapboxLocationOption
	} from '$lib/maps/mapbox';
	import { routes } from '$lib/routes';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { useConvexClient } from 'convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';

	const auth = useAuth();
	const convexClient = useConvexClient();
	const PUBLIC_MAPBOX_ACCESS_TOKEN = env.PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';
	const LOCATION_AUTOCOMPLETE_MIN_CHARS = 2;
	const ABOUT_CHARACTER_LIMIT = 500;
	const LOCATION_AUTOCOMPLETE_DEBOUNCE_MS = 280;
	const START_CLUB_DRAFT_STORAGE_KEY = 'cl_start_club_draft_v1';
	const CLUB_VIDEO_ACCEPTED_CONTENT_TYPES = [
		'video/mp4',
		'video/quicktime',
		'video/webm',
		'video/x-m4v'
	];
	const CLUB_VIDEO_MAX_BYTES = 100 * FileDropZone.MEGABYTE;

	type StartClubDraft = {
		location: string;
		locationLongitude: number | null;
		locationLatitude: number | null;
		userRole: string;
		about: string;
		referralSource: string;
		referralOther: string;
		step: 1 | 2;
		updatedAt: number;
	};

	let step = $derived<1 | 2>(page.url.searchParams.get('step') === '2' ? 2 : 1);

	let location = $state('');
	let locationSuggestions = $state<MapboxLocationOption[]>([]);
	let locationLookupPending = $state(false);
	let locationLookupError = $state('');
	let selectedLocationCoordinates = $state<MapboxCoordinates | null>(null);
	let userRole = $state('');
	let about = $state('');
	let referralSource = $state('');
	let referralOther = $state('');
	let videoFileName = $state('');
	let videoStorageId = $state<Id<'_storage'> | null>(null);
	let videoUploadPending = $state(false);
	let localVideoPreviewUrl = $state<string | null>(null);
	let previewVideoLoadFailed = $state(false);
	let pending = $state(false);
	let errorMessage = $state('');
	let hydratedDraft = $state(false);
	const rememberedLocationCoordinates = new SvelteMap<string, MapboxCoordinates>();

	const roleOptions: DropdownOption[] = [
		{ label: 'Teacher', value: 'Teacher' },
		{ label: 'Parent', value: 'Parent' },
		{ label: 'Student', value: 'Student' },
		{ label: 'Community organizer', value: 'Community organizer' },
		{ label: 'Mentor', value: 'Mentor' },
		{ label: 'Other', value: 'Other' }
	];

	const referralOptions: DropdownOption[] = [
		{ label: 'Instagram', value: 'Instagram' },
		{ label: 'LinkedIn', value: 'LinkedIn' },
		{ label: 'Facebook', value: 'Facebook' },
		{ label: 'YouTube', value: 'YouTube' },
		{ label: 'X (Twitter)', value: 'X (Twitter)' },
		{ label: 'Friend or family', value: 'Friend or family' },
		{ label: 'School or teacher', value: 'School or teacher' },
		{ label: 'Event or workshop', value: 'Event or workshop' },
		{ label: 'Other', value: 'Other' }
	];

	let aboutCharacterCount = $derived(about.length);
	let canContinueStepOne = $derived(
		location.trim().length > 0 && userRole.trim().length > 0 && about.trim().length > 0
	);

	const readStartClubDraft = (): StartClubDraft | null => {
		if (!browser) return null;
		try {
			const raw = sessionStorage.getItem(START_CLUB_DRAFT_STORAGE_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as Partial<StartClubDraft>;
			if (!parsed || typeof parsed !== 'object') return null;
			return {
				location: typeof parsed.location === 'string' ? parsed.location : '',
				locationLongitude:
					typeof parsed.locationLongitude === 'number' && Number.isFinite(parsed.locationLongitude)
						? parsed.locationLongitude
						: null,
				locationLatitude:
					typeof parsed.locationLatitude === 'number' && Number.isFinite(parsed.locationLatitude)
						? parsed.locationLatitude
						: null,
				userRole: typeof parsed.userRole === 'string' ? parsed.userRole : '',
				about: typeof parsed.about === 'string' ? parsed.about : '',
				referralSource: typeof parsed.referralSource === 'string' ? parsed.referralSource : '',
				referralOther: typeof parsed.referralOther === 'string' ? parsed.referralOther : '',
				step: parsed.step === 2 ? 2 : 1,
				updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
			};
		} catch {
			return null;
		}
	};

	const writeStartClubDraft = () => {
		if (!browser) return;
		const draft: StartClubDraft = {
			location,
			locationLongitude: selectedLocationCoordinates?.longitude ?? null,
			locationLatitude: selectedLocationCoordinates?.latitude ?? null,
			userRole,
			about,
			referralSource,
			referralOther,
			step,
			updatedAt: Date.now()
		};
		try {
			sessionStorage.setItem(START_CLUB_DRAFT_STORAGE_KEY, JSON.stringify(draft));
		} catch {
			// Ignore storage errors.
		}
	};

	const clearStartClubDraft = () => {
		if (!browser) return;
		try {
			sessionStorage.removeItem(START_CLUB_DRAFT_STORAGE_KEY);
		} catch {
			// Ignore storage errors.
		}
	};

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

	let hasValidUploadedVideo = $derived(
		Boolean(videoStorageId && localVideoPreviewUrl && !previewVideoLoadFailed)
	);

	let locationLookupTimer: ReturnType<typeof setTimeout> | null = null;
	let locationLookupAbortController: AbortController | null = null;
	let locationLookupVersion = 0;

	const clearLocationLookupResources = () => {
		if (locationLookupTimer) {
			clearTimeout(locationLookupTimer);
			locationLookupTimer = null;
		}
		if (locationLookupAbortController) {
			locationLookupAbortController.abort();
			locationLookupAbortController = null;
		}
	};

	onDestroy(() => {
		revokeLocalVideoPreview();
		clearLocationLookupResources();
	});

	$effect(() => {
		if (!browser || hydratedDraft) return;
		hydratedDraft = true;
		const draft = readStartClubDraft();
		if (!draft) return;
		if (!location.trim() && draft.location) {
			location = draft.location;
		}
		if (
			selectedLocationCoordinates === null &&
			typeof draft.locationLongitude === 'number' &&
			typeof draft.locationLatitude === 'number'
		) {
			selectedLocationCoordinates = {
				longitude: draft.locationLongitude,
				latitude: draft.locationLatitude
			};
			if (draft.location.trim()) {
				rememberedLocationCoordinates.set(draft.location.trim().toLowerCase(), selectedLocationCoordinates);
			}
		}
		if (!userRole.trim() && draft.userRole) {
			userRole = draft.userRole;
		}
		if (!about.trim() && draft.about) {
			about = draft.about;
		}
		if (!referralSource && draft.referralSource) {
			referralSource = draft.referralSource;
		}
		if (!referralOther && draft.referralOther) {
			referralOther = draft.referralOther;
		}
	});

	$effect(() => {
		writeStartClubDraft();
	});

	$effect(() => {
		if (referralSource === 'Other') return;
		if (!referralOther) return;
		referralOther = '';
	});

	$effect(() => {
		if (step !== 1) {
			clearLocationLookupResources();
			locationSuggestions = [];
			locationLookupPending = false;
			locationLookupError = '';
			return;
		}

		const query = location.trim();
		clearLocationLookupResources();
		locationLookupError = '';

		if (query.length < LOCATION_AUTOCOMPLETE_MIN_CHARS) {
			locationSuggestions = [];
			locationLookupPending = false;
			return;
		}

		const nextVersion = ++locationLookupVersion;
		locationLookupPending = true;
		locationLookupTimer = setTimeout(async () => {
			if (!PUBLIC_MAPBOX_ACCESS_TOKEN) {
				if (nextVersion === locationLookupVersion) {
					locationSuggestions = [];
					locationLookupPending = false;
				}
				return;
			}

			const controller = new AbortController();
			locationLookupAbortController = controller;

			try {
				const payload = await fetchMapboxLocationSuggestions({
					query,
					accessToken: PUBLIC_MAPBOX_ACCESS_TOKEN,
					signal: controller.signal,
					language: browser ? navigator.language.split('-')[0] ?? 'en' : 'en',
					limit: MAPBOX_GEOCODING_LIMIT
				});
				if (nextVersion !== locationLookupVersion) return;
				locationSuggestions = payload;
				locationLookupError = '';
				for (const suggestion of payload) {
					rememberedLocationCoordinates.set(suggestion.value.trim().toLowerCase(), {
						longitude: suggestion.longitude,
						latitude: suggestion.latitude
					});
				}
			} catch (error) {
				if (nextVersion !== locationLookupVersion) return;
				if (error instanceof DOMException && error.name === 'AbortError') return;
				locationSuggestions = [];
				locationLookupError =
					error instanceof Error ? error.message : 'Unable to fetch location suggestions';
			} finally {
				if (nextVersion === locationLookupVersion) {
					locationLookupPending = false;
				}
			}
		}, LOCATION_AUTOCOMPLETE_DEBOUNCE_MS);
	});

	$effect(() => {
		const normalizedLocation = location.trim().toLowerCase();
		if (!normalizedLocation) {
			selectedLocationCoordinates = null;
			return;
		}

		const remembered = rememberedLocationCoordinates.get(normalizedLocation);
		if (remembered) {
			selectedLocationCoordinates = remembered;
			return;
		}

		selectedLocationCoordinates = null;
	});

	const uploadClubVideo = async (files: File[]) => {
		const file = files[0];
		if (!file) return;

		videoFileName = file.name;
		videoStorageId = null;
		previewVideoLoadFailed = false;
		revokeLocalVideoPreview();
		localVideoPreviewUrl = URL.createObjectURL(file);

		if (!auth.isAuthenticated) {
			errorMessage = 'Please sign in first, then upload the club video.';
			revokeLocalVideoPreview();
			videoFileName = '';
			return;
		}

		videoUploadPending = true;
		errorMessage = '';
		try {
			const uploadedAsset = await uploadMediaAsset(convexClient, file, {
				acceptedContentTypes: CLUB_VIDEO_ACCEPTED_CONTENT_TYPES,
				maxBytes: CLUB_VIDEO_MAX_BYTES,
				enableCompression: true,
				enableSafetyScreening: true
			});
			if (!uploadedAsset.storageId) {
				throw new Error('Video upload could not be finalized.');
			}

			videoStorageId = uploadedAsset.storageId;
		} catch (error) {
			videoStorageId = null;
			revokeLocalVideoPreview();
			videoFileName = '';
			errorMessage = error instanceof Error ? error.message : 'Unable to upload video right now.';
		} finally {
			videoUploadPending = false;
		}
	};

	const submitStartClub = async () => {
		errorMessage = '';

		if (auth.isLoading) {
			errorMessage = 'Checking your session. Please try again.';
			return;
		}

		if (!auth.isAuthenticated) {
			const params = new SvelteURLSearchParams();
			params.set('next', '/onboarding/start-club?step=2');
			params.set('forceSignup', '1');
			await goto(`/auth/sign-up?${params.toString()}`);
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
				locationLatitude: selectedLocationCoordinates?.latitude,
				locationLongitude: selectedLocationCoordinates?.longitude,
				videoStorageId: videoStorageId ?? undefined,
				meetingDay: undefined,
				meetingTime: undefined
			});
			clearStartClubDraft();
			await goto(result?.clubId ? routes.clubHome(result.clubId) : '/');
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unable to submit your application.';
		} finally {
			pending = false;
		}
	};
</script>

<FlowShell
	step={step}
	total={5}
	showAccountLink={false}
	showSideIllustration={true}
	desktopContentScrollable={false}
>
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
		</div>
	{/snippet}

	<div class="mx-auto flex w-full max-w-[28.75rem] flex-1 flex-col gap-6">

		{#if step === 1}
			<div class="flex flex-col gap-5">
				<h1 class="type-step-title text-gray-900">Add application details</h1>

				<DropdownField
					id="location"
					label="Where do you want to start a Curiosity Club?"
					required={true}
					bind:value={location}
					options={locationSuggestions.map(({ label, value }) => ({ label, value }))}
					loading={locationLookupPending}
					placeholder="Search for location..."
					filterOptions={false}
					emptyMessage={location.trim().length >= LOCATION_AUTOCOMPLETE_MIN_CHARS
						? 'No locations found.'
						: 'Type at least 2 characters.'}
					hint={PUBLIC_MAPBOX_ACCESS_TOKEN
						? 'Search for a city, town, or address with Mapbox geocoding.'
						: 'Add PUBLIC_MAPBOX_ACCESS_TOKEN to .env.local to enable Mapbox geocoding and map preview.'}
				/>

				{#if locationLookupError}
					<p class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
						{locationLookupError}
					</p>
				{/if}

				{#if PUBLIC_MAPBOX_ACCESS_TOKEN && selectedLocationCoordinates}
					<MapboxLocationPreview
						accessToken={PUBLIC_MAPBOX_ACCESS_TOKEN}
						coordinates={selectedLocationCoordinates}
						label={location.trim()}
						styleUrl={MAPBOX_STYLE_URL}
					/>
				{/if}

				<DropdownField
					id="role"
					label="I am a..."
					required={true}
					bind:value={userRole}
					options={roleOptions}
					placeholder="Select an option"
					searchable={false}
					allowCustomValue={false}
				/>

				<div class="flex flex-col gap-2">
					<TextareaField
						id="about"
						label="Who are you?"
						required={true}
						bind:value={about}
						rows={5}
						maxlength={ABOUT_CHARACTER_LIMIT}
						overlayText={`${aboutCharacterCount}/${ABOUT_CHARACTER_LIMIT}`}
						placeholder="Tell us a bit about yourself..."
					/>
					<p class="text-sm leading-6 text-gray-500">Why do you want to do this? Why are you a right fit? What do you want to learn? Any related previous experiences? Links to previous experiences?</p>
				</div>

				<DropdownField
					id="referral"
					label="How did you find out about us?"
					bind:value={referralSource}
					options={referralOptions}
					placeholder="Select an option"
					searchable={false}
					allowCustomValue={false}
				/>

				{#if referralSource === 'Other'}
					<InputField
						id="referral-other"
						label="Please specify"
						bind:value={referralOther}
						placeholder="Tell us how you found us"
					/>
				{/if}
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
					<FileDropZone.Root
						accept={CLUB_VIDEO_ACCEPTED_CONTENT_TYPES.join(',')}
						maxFiles={1}
						fileCount={0}
						maxFileSize={CLUB_VIDEO_MAX_BYTES}
						disabled={videoUploadPending || pending || auth.isLoading}
						onUpload={uploadClubVideo}
					>
						<FileDropZone.Trigger class="contents">
							<div
									class="grid min-h-36 place-items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-center text-gray-600 transition-all hover:cursor-pointer hover:bg-orange-50"
								>
									<div class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-primary shadow-xs">
										{videoUploadPending ? 'Uploading' : 'Browse'}
									</div>
									<p class="text-base leading-7 font-medium text-gray-700">
										{videoUploadPending ? 'Uploading your video...' : 'Drag and drop or choose a video'}
									</p>
									<p class="text-sm text-gray-500">MP4, MOV, WEBM, or M4V up to 100 MB.</p>
									{#if videoFileName}
										<p class="max-w-full truncate text-sm text-gray-500">{videoFileName}</p>
									{/if}
									{#if videoUploadPending}
										<p class="text-xs font-semibold text-primary">Uploading video...</p>
									{:else if videoStorageId}
										<p class="text-xs font-semibold text-emerald-600">Video uploaded</p>
									{/if}
								</div>
						</FileDropZone.Trigger>
					</FileDropZone.Root>
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
					disabled={pending || videoUploadPending || auth.isLoading}
					onclick={() => void submitStartClub()}
				>
					{pending
						? 'Submitting...'
						: videoUploadPending
							? 'Uploading video...'
							: auth.isAuthenticated
								? 'Submit application'
								: 'Proceed to sign up'}
				</Button>
			</div>
		{/if}
	</div>
</FlowShell>
