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
	import { Field, FieldError, FieldLabel } from '$lib/components/ui/field';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import { _, t } from '$lib/i18n';
	import MapboxLocationPreview from '$lib/components/app/mapbox-location-preview.svelte';
	import { createMediaField } from '$lib/media/media-field.svelte';
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
	import { useConvexClient } from 'convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';

	const auth = useAuth();
	const convexClient = useConvexClient();
	const clubVideoField = createMediaField(convexClient, 'clubVideo', {
		mode: 'deferred'
	});
	const PUBLIC_MAPBOX_ACCESS_TOKEN = env.PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';
	const LOCATION_AUTOCOMPLETE_MIN_CHARS = 2;
	const ABOUT_CHARACTER_LIMIT = 500;
	const LOCATION_AUTOCOMPLETE_DEBOUNCE_MS = 280;
	const START_CLUB_DRAFT_STORAGE_KEY = 'cl_start_club_draft_v1';

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
	let previewVideoLoadFailed = $state(false);
	let videoTouched = $state(false);
	let pending = $state(false);
	let errorMessage = $state('');
	let hydratedDraft = $state(false);
	const rememberedLocationCoordinates = new SvelteMap<string, MapboxCoordinates>();

	const ROLE_VALUE_ALIASES: Record<string, string> = {
		teacher: 'teacher',
		parent: 'parent',
		student: 'student',
		'community organizer': 'community_organizer',
		community_organizer: 'community_organizer',
		mentor: 'mentor',
		other: 'other'
	};

	const REFERRAL_VALUE_ALIASES: Record<string, string> = {
		instagram: 'instagram',
		linkedin: 'linkedin',
		facebook: 'facebook',
		youtube: 'youtube',
		'x (twitter)': 'x_twitter',
		x_twitter: 'x_twitter',
		'friend or family': 'friend_family',
		friend_family: 'friend_family',
		'school or teacher': 'school_teacher',
		school_teacher: 'school_teacher',
		'event or workshop': 'event_workshop',
		event_workshop: 'event_workshop',
		other: 'other'
	};

	const normalizeOptionValue = (value: string, aliases: Record<string, string>) =>
		aliases[value.trim().toLowerCase()] ?? value.trim().toLowerCase();

	let roleOptions = $derived<DropdownOption[]>([
		{ label: $_('onboarding.startClub.roles.teacher'), value: 'teacher' },
		{ label: $_('onboarding.startClub.roles.parent'), value: 'parent' },
		{ label: $_('onboarding.startClub.roles.student'), value: 'student' },
		{
			label: $_('onboarding.startClub.roles.communityOrganizer'),
			value: 'community_organizer'
		},
		{ label: $_('onboarding.startClub.roles.mentor'), value: 'mentor' },
		{ label: $_('onboarding.startClub.roles.other'), value: 'other' }
	]);

	let referralOptions = $derived<DropdownOption[]>([
		{ label: $_('onboarding.startClub.referrals.instagram'), value: 'instagram' },
		{ label: $_('onboarding.startClub.referrals.linkedin'), value: 'linkedin' },
		{ label: $_('onboarding.startClub.referrals.facebook'), value: 'facebook' },
		{ label: $_('onboarding.startClub.referrals.youtube'), value: 'youtube' },
		{ label: $_('onboarding.startClub.referrals.xTwitter'), value: 'x_twitter' },
		{ label: $_('onboarding.startClub.referrals.friendFamily'), value: 'friend_family' },
		{ label: $_('onboarding.startClub.referrals.schoolTeacher'), value: 'school_teacher' },
		{ label: $_('onboarding.startClub.referrals.eventWorkshop'), value: 'event_workshop' },
		{ label: $_('onboarding.startClub.referrals.other'), value: 'other' }
	]);

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
				userRole:
					typeof parsed.userRole === 'string'
						? normalizeOptionValue(parsed.userRole, ROLE_VALUE_ALIASES)
						: '',
				about: typeof parsed.about === 'string' ? parsed.about : '',
				referralSource:
					typeof parsed.referralSource === 'string'
						? normalizeOptionValue(parsed.referralSource, REFERRAL_VALUE_ALIASES)
						: '',
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
			await goto(routes.onboardingStartClub, { replaceState: true });
			return;
		}
		await goto(routes.onboardingGetStarted);
	};

	const goToStepTwo = async () => {
		errorMessage = '';
		if (!canContinueStepOne) {
			errorMessage = t('auth.signUp.completeRequiredFields');
			return;
		}
		writeStartClubDraft();
		if (auth.isLoading) {
			errorMessage = t('onboarding.startClub.checkingSession');
			return;
		}
		if (!auth.isAuthenticated) {
			const params = new SvelteURLSearchParams();
			params.set('next', routes.onboardingStartClubVideo);
			params.set('forceSignup', '1');
			await goto(`/auth/sign-up?${params.toString()}`);
			return;
		}
		await goto(routes.onboardingStartClubVideo);
	};

	let hasValidUploadedVideo = $derived(
		Boolean(clubVideoField.localPreviewUrl && !previewVideoLoadFailed)
	);
	let hasSelectedVideo = $derived(Boolean(clubVideoField.selectedFile || clubVideoField.assetId));
	let videoError = $derived(
		videoTouched && !hasSelectedVideo ? t('onboarding.startClub.videoRequired') : ''
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
		clubVideoField.destroy();
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
				rememberedLocationCoordinates.set(
					draft.location.trim().toLowerCase(),
					selectedLocationCoordinates
				);
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
		if (auth.isLoading) return;
		if (auth.isAuthenticated) return;
		if (step !== 2) return;
		writeStartClubDraft();
		const params = new SvelteURLSearchParams();
		params.set('next', routes.onboardingStartClubVideo);
		params.set('forceSignup', '1');
		void goto(`/auth/sign-up?${params.toString()}`, { replaceState: true });
	});

	$effect(() => {
		if (referralSource === 'other') return;
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
					language: browser ? (navigator.language.split('-')[0] ?? 'en') : 'en',
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
				locationLookupError = t('onboarding.startClub.locationLookupFailure');
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
		previewVideoLoadFailed = false;
		videoTouched = true;
		errorMessage = '';
		try {
			await clubVideoField.selectFiles(files);
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : t('onboarding.startClub.videoUploadFailure');
		}
	};

	const submitStartClub = async () => {
		errorMessage = '';
		videoTouched = true;

		if (auth.isLoading) {
			errorMessage = t('onboarding.startClub.checkingSession');
			return;
		}

		if (!auth.isAuthenticated) {
			writeStartClubDraft();
			const params = new SvelteURLSearchParams();
			params.set('next', routes.onboardingStartClubVideo);
			params.set('forceSignup', '1');
			await goto(`/auth/sign-up?${params.toString()}`);
			return;
		}

		if (!hasSelectedVideo) {
			return;
		}

		pending = true;
		try {
			await clubVideoField.ensureUploaded();
			if (clubVideoField.hasUploadedAsset && !clubVideoField.isReady) {
				throw new Error(
					clubVideoField.errorMessage || t('onboarding.startClub.videoUploadFailure')
				);
			}
			const normalizedLocation = location.trim();
			const generatedName = normalizedLocation
				? `${normalizedLocation} Curiosity Club`
				: 'Curiosity Club';
			const result = await clubVideoField.persistAttached((assetId) =>
				convexClient.mutation(api.clubApplications.submitApplication, {
					name: generatedName.slice(0, 100),
					description: about.trim() || undefined,
					location: normalizedLocation || undefined,
					locationLatitude: selectedLocationCoordinates?.latitude,
					locationLongitude: selectedLocationCoordinates?.longitude,
					videoMediaAssetId: assetId ?? undefined,
					applicantRole: userRole || undefined,
					referralSource: referralSource || undefined,
					referralOther: referralOther.trim() || undefined
				})
			);
			if (!result) {
				throw new Error(t('onboarding.startClub.submitFailure'));
			}
			clearStartClubDraft();
			await goto(routes.noClub);
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : t('onboarding.startClub.submitFailure');
		} finally {
			pending = false;
		}
	};
</script>

<FlowShell
	{step}
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
				aria-label={$_('common.goBack')}
			>
				<ChevronLeftIcon class="size-7" />
			</button>
		</div>
	{/snippet}

	<div class="mx-auto flex w-full max-w-[28.75rem] flex-1 flex-col gap-6">
		{#if step === 1}
			<div class="flex flex-col gap-5">
				<h1 class="type-step-title text-gray-900">{$_('onboarding.startClub.title')}</h1>

				<DropdownField
					id="location"
					label={$_('onboarding.startClub.locationLabel')}
					required={true}
					bind:value={location}
					options={locationSuggestions.map(({ label, value }) => ({ label, value }))}
					loading={locationLookupPending}
					placeholder={$_('onboarding.startClub.locationPlaceholder')}
					filterOptions={false}
					emptyMessage={location.trim().length >= LOCATION_AUTOCOMPLETE_MIN_CHARS
						? $_('onboarding.startClub.locationEmptyFound')
						: $_('onboarding.startClub.locationEmptyTypeMore')}
					hint={PUBLIC_MAPBOX_ACCESS_TOKEN
						? $_('onboarding.startClub.locationHintEnabled')
						: $_('onboarding.startClub.locationHintMissingToken')}
				/>

				{#if locationLookupError}
					<p
						class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
					>
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
					label={$_('onboarding.startClub.roleLabel')}
					required={true}
					bind:value={userRole}
					options={roleOptions}
					placeholder={$_('onboarding.startClub.rolePlaceholder')}
					searchable={false}
					allowCustomValue={false}
				/>

				<div class="flex flex-col gap-2">
					<TextareaField
						id="about"
						label={$_('onboarding.startClub.aboutLabel')}
						required={true}
						bind:value={about}
						rows={5}
						maxlength={ABOUT_CHARACTER_LIMIT}
						overlayText={`${aboutCharacterCount}/${ABOUT_CHARACTER_LIMIT}`}
						placeholder={$_('onboarding.startClub.aboutPlaceholder')}
					/>
					<p class="text-sm leading-6 text-gray-500">{$_('onboarding.startClub.aboutHelp')}</p>
				</div>

				<DropdownField
					id="referral"
					label={$_('onboarding.startClub.referralLabel')}
					bind:value={referralSource}
					options={referralOptions}
					placeholder={$_('onboarding.startClub.referralPlaceholder')}
					searchable={false}
					allowCustomValue={false}
				/>

				{#if referralSource === 'other'}
					<InputField
						id="referral-other"
						label={$_('onboarding.startClub.referralOtherLabel')}
						bind:value={referralOther}
						placeholder={$_('onboarding.startClub.referralOtherPlaceholder')}
					/>
				{/if}
			</div>

			{#if errorMessage}
				<p class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
					{errorMessage}
				</p>
			{/if}

			<div class="mt-auto pb-2 sm:pb-6">
				<Button
					variant="default"
					size="xl"
					class="h-12 w-full"
					disabled={!canContinueStepOne}
					onclick={() => void goToStepTwo()}
				>
					{$_('onboarding.startClub.continue')}
				</Button>
			</div>
		{:else}
			<div class="flex flex-col gap-5">
				<h1 class="type-step-title text-gray-900">{$_('onboarding.startClub.videoTitle')}</h1>
				<div class="flex flex-col gap-2">
					<p class="text-[1.125rem] leading-8 font-bold text-gray-900">
						{$_('onboarding.startClub.videoPromptTitle')}
					</p>
					<p class="text-base leading-7 text-gray-600">
						{$_('onboarding.startClub.videoPromptDescription')}
					</p>
				</div>

				<Field class="flex flex-col gap-3">
					<FieldLabel
						for="start-club-video"
						required={true}
						class="text-[1.125rem] leading-8 font-bold text-gray-900"
					>
						{$_('onboarding.startClub.videoUploadTitle')}
					</FieldLabel>
					<FileDropZone.Root
						id="start-club-video"
						accept={clubVideoField.accept}
						maxFiles={1}
						fileCount={0}
						maxFileSize={clubVideoField.maxBytes}
						disabled={clubVideoField.isBusy || pending || auth.isLoading}
						aria-invalid={videoError ? 'true' : undefined}
						aria-describedby={videoError ? 'start-club-video-error' : undefined}
						onUpload={uploadClubVideo}
					>
						<FileDropZone.Trigger class="contents">
							<div
								class="grid min-h-36 place-items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-center text-gray-600 transition-all hover:cursor-pointer hover:bg-orange-50"
							>
								<div
									class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-primary shadow-xs"
								>
									{clubVideoField.isBusy
										? $_('onboarding.startClub.uploading')
										: $_('common.browse')}
								</div>
								<p class="text-base leading-7 font-medium text-gray-700">
									{clubVideoField.isBusy
										? $_('onboarding.startClub.videoUploading')
										: $_('onboarding.startClub.videoDropPrompt')}
								</p>
								<p class="text-sm text-gray-500">{$_('onboarding.startClub.videoRequirements')}</p>
								{#if clubVideoField.selectedFileName}
									<p class="max-w-full truncate text-sm text-gray-500">
										{clubVideoField.selectedFileName}
									</p>
								{/if}
								{#if clubVideoField.isBusy}
									<p class="text-xs font-semibold text-primary">
										{$_('onboarding.startClub.videoUploadingStatus')}
									</p>
								{:else if clubVideoField.hasUploadedAsset}
									<p class="text-xs font-semibold text-emerald-600">
										{$_('onboarding.startClub.videoUploadedStatus')}
									</p>
								{/if}
							</div>
						</FileDropZone.Trigger>
					</FileDropZone.Root>
					{#if hasValidUploadedVideo}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video
							src={clubVideoField.localPreviewUrl ?? undefined}
							controls
							preload="metadata"
							class="h-44 w-full rounded-lg border border-gray-200 bg-black object-cover"
							onerror={() => {
								previewVideoLoadFailed = true;
							}}
						></video>
					{/if}
					{#if videoError}
						<FieldError id="start-club-video-error">{videoError}</FieldError>
					{/if}
				</Field>
			</div>

			{#if errorMessage}
				<p class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
					{errorMessage}
				</p>
			{/if}

			<div class="mt-auto pb-2 sm:pb-6">
				<Button
					variant="default"
					size="xl"
					class="h-12 w-full"
					disabled={!hasSelectedVideo || pending || clubVideoField.isBusy || auth.isLoading}
					onclick={() => void submitStartClub()}
				>
					{pending
						? $_('onboarding.startClub.submitting')
						: clubVideoField.isBusy
							? $_('onboarding.startClub.videoUploadingStatus')
							: $_('onboarding.startClub.submitApplication')}
				</Button>
			</div>
		{/if}
	</div>
</FlowShell>
