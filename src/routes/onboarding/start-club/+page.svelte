<script lang="ts">
	import { browser } from '$app/environment';
	import { env } from '$env/dynamic/public';
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import * as FileDropZone from '$lib/components/ui/file-drop-zone';
	import { Button } from '$lib/components/ui/button';
	import { Field, FieldError, FieldLabel } from '$lib/components/ui/field';
	import { PageHeaderBackButton, PageHeaderTitle } from '$lib/components/app';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import { _, t } from '$lib/i18n';
	import LocationAutocompleteField from '$lib/components/app/location-autocomplete-field.svelte';
	import { createMediaField } from '$lib/media/media-field.svelte';
	import {
		DropdownField,
		InputField,
		TextareaField,
		type DropdownOption
	} from '$lib/components/app/form';
	import {
		MAPBOX_STYLE_URL,
		type MapboxCoordinates
	} from '$lib/maps/mapbox';
	import { routes } from '$lib/routes';
	import { navigateBack } from '$lib/navigation/back';
	import { api } from '$convex/_generated/api';
	import { useConvexClient } from 'convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';

	const auth = useAuth();
	const convexClient = useConvexClient();
	const incompleteApplicationResponse = useStableQuery(
		api.clubApplications.getMyIncompleteApplication,
		() => (auth.isAuthenticated ? {} : 'skip')
	);
	const clubVideoField = createMediaField(convexClient, 'clubVideo', {
		mode: 'immediate'
	});
	const PUBLIC_MAPBOX_ACCESS_TOKEN = env.PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';
	const ABOUT_CHARACTER_LIMIT = 500;
	const START_CLUB_DRAFT_STORAGE_KEY = 'cl_start_club_draft_v1';
	type EstimatedLocation = {
		label: string;
		coordinates: MapboxCoordinates | null;
	};
	let isAppNewClubFlow = $derived(page.url.pathname.startsWith(routes.newClubStart));
	let startClubPath = $derived(isAppNewClubFlow ? routes.newClubStart : routes.onboardingStartClub);
	let startClubVideoPath = $derived(
		isAppNewClubFlow ? routes.newClubStartVideo : routes.onboardingStartClubVideo
	);
	let startClubDonePath = $derived(isAppNewClubFlow ? routes.newClub : routes.noClub);
	let startClubBackPath = $derived(isAppNewClubFlow ? routes.newClub : routes.onboardingGetStarted);
	let contentClass = $derived(
		isAppNewClubFlow
			? 'flex w-full flex-col gap-6'
			: 'mx-auto flex w-full max-w-[28.75rem] flex-1 flex-col gap-6'
	);
	let defaultLocation = $derived(
		((page.data as { estimatedLocation?: EstimatedLocation | null }).estimatedLocation ?? null)
	);
	let actionClass = $derived(isAppNewClubFlow ? 'pb-0' : 'mt-auto pb-2 sm:pb-6');

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
	let startClubHeaderBackPath = $derived(step === 2 ? routes.newClubStart : routes.newClub);

	let location = $state('');
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
	let hydratedIncompleteApplication = $state(false);

	const ROLE_VALUE_ALIASES: Record<string, string> = {
		teacher: 'teacher',
		parent: 'parent',
		student: 'student',
		'community organizer': 'community_organizer',
		community_organizer: 'community_organizer',
		mentor: 'mentor',
		'awesome person wanting to start a curiosity club': 'awesome_person_start_club',
		awesome_person_start_club: 'awesome_person_start_club',
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
		{
			label: $_('onboarding.startClub.roles.awesomePersonStartClub'),
			value: 'awesome_person_start_club'
		},
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

	const startClubApplicationDraft = () => {
		const normalizedLocation = location.trim();
		return {
			description: about.trim() || undefined,
			location: normalizedLocation || undefined,
			locationLatitude: selectedLocationCoordinates?.latitude,
			locationLongitude: selectedLocationCoordinates?.longitude,
			applicantRole: userRole || undefined,
			referralSource: referralSource || undefined,
			referralOther: referralOther.trim() || undefined
		};
	};

	const saveIncompleteApplication = async () => {
		await convexClient.mutation(api.clubApplications.saveIncompleteApplication, startClubApplicationDraft());
	};

	const goBack = async () => {
		errorMessage = '';
		if (step === 2) {
			await goto(startClubPath, { replaceState: true });
			return;
		}
		await navigateBack({ fallbackHref: startClubBackPath });
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
			params.set('next', startClubVideoPath);
			params.set('forceSignup', '1');
			await goto(`/auth/sign-up?${params.toString()}`);
			return;
		}
		try {
			await saveIncompleteApplication();
			await goto(startClubVideoPath);
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : t('onboarding.startClub.submitFailure');
		}
	};

	let hasValidUploadedVideo = $derived(
		Boolean(clubVideoField.localPreviewUrl && !previewVideoLoadFailed)
	);
	let hasReadyVideo = $derived(clubVideoField.isReady);
	let videoUploadError = $derived(
		clubVideoField.phase === 'failed' ? clubVideoField.errorMessage : ''
	);
	let videoError = $derived(
		videoTouched && !clubVideoField.selectedFile && !clubVideoField.assetId
			? t('onboarding.startClub.videoRequired')
			: videoUploadError
	);

	onDestroy(() => {
		clubVideoField.destroy();
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
		if (!hydratedDraft) return;
		writeStartClubDraft();
	});

	$effect(() => {
		if (!hydratedDraft || hydratedIncompleteApplication) return;
		const application = incompleteApplicationResponse.data;
		if (!application) return;
		hydratedIncompleteApplication = true;
		if (!location.trim() && application.location) {
			location = application.location;
		}
		if (
			selectedLocationCoordinates === null &&
			typeof application.locationLongitude === 'number' &&
			typeof application.locationLatitude === 'number'
		) {
			selectedLocationCoordinates = {
				longitude: application.locationLongitude,
				latitude: application.locationLatitude
			};
		}
		if (!userRole.trim() && application.applicantRole) {
			userRole = normalizeOptionValue(application.applicantRole, ROLE_VALUE_ALIASES);
		}
		if (!about.trim() && application.description) {
			about = application.description;
		}
		if (!referralSource && application.referralSource) {
			referralSource = normalizeOptionValue(application.referralSource, REFERRAL_VALUE_ALIASES);
		}
		if (!referralOther && application.referralOther) {
			referralOther = application.referralOther;
		}
	});

	$effect(() => {
		if (auth.isLoading) return;
		if (auth.isAuthenticated) return;
		if (step !== 2) return;
		writeStartClubDraft();
		const params = new SvelteURLSearchParams();
		params.set('next', startClubVideoPath);
		params.set('forceSignup', '1');
		void goto(`/auth/sign-up?${params.toString()}`, { replaceState: true });
	});

	$effect(() => {
		if (referralSource === 'other') return;
		if (!referralOther) return;
		referralOther = '';
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
			params.set('next', startClubVideoPath);
			params.set('forceSignup', '1');
			await goto(`/auth/sign-up?${params.toString()}`);
			return;
		}

		if (!hasReadyVideo) {
			return;
		}

		pending = true;
		try {
			const normalizedLocation = location.trim();
			const generatedName = normalizedLocation
				? `${normalizedLocation} Curiosity Club`
				: 'Curiosity Club';
			const result = await clubVideoField.persistAttached((assetId) =>
				convexClient.mutation(api.clubApplications.submitApplication, {
					name: generatedName.slice(0, 100),
					...startClubApplicationDraft(),
					videoMediaAssetId: assetId ?? undefined,
				})
			);
			if (!result) {
				throw new Error(t('onboarding.startClub.submitFailure'));
			}
			clearStartClubDraft();
			await goto(startClubDonePath);
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : t('onboarding.startClub.submitFailure');
		} finally {
			pending = false;
		}
	};
</script>

{#if isAppNewClubFlow}
	<PageHeaderBackButton fallbackHref={startClubHeaderBackPath} />
	<PageHeaderTitle
		title={step === 2 ? $_('onboarding.startClub.videoTitle') : $_('onboarding.startClub.title')}
	/>
{/if}

<FlowShell
	{step}
	total={5}
	showAccountLink={false}
	showSideIllustration={true}
	desktopContentScrollable={false}
	appFrame={isAppNewClubFlow}
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

	<div class={contentClass}>
		{#if step === 1}
			<div class="flex flex-col gap-5">
				{#if !isAppNewClubFlow}
					<h1 class="type-step-title text-gray-900">{$_('onboarding.startClub.title')}</h1>
				{/if}

				<LocationAutocompleteField
					id="location"
					label={$_('onboarding.startClub.locationLabel')}
					required={true}
					bind:value={location}
					bind:coordinates={selectedLocationCoordinates}
					{defaultLocation}
					accessToken={PUBLIC_MAPBOX_ACCESS_TOKEN}
					placeholder={$_('onboarding.startClub.locationPlaceholder')}
					emptyMessage={$_('onboarding.startClub.locationEmptyFound')}
					lookupFailureMessage={$_('onboarding.startClub.locationLookupFailure')}
					showPreview={true}
					previewStyleUrl={MAPBOX_STYLE_URL}
				/>

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
						hint={$_('onboarding.startClub.aboutHelp')}
						bind:value={about}
						rows={5}
						maxlength={ABOUT_CHARACTER_LIMIT}
						overlayText={`${aboutCharacterCount}/${ABOUT_CHARACTER_LIMIT}`}
						placeholder={$_('onboarding.startClub.aboutPlaceholder')}
					/>
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

			<div class={actionClass}>
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
				{#if !isAppNewClubFlow}
					<h1 class="type-step-title text-gray-900">{$_('onboarding.startClub.videoTitle')}</h1>
				{/if}
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
									{#if clubVideoField.isBusy}
										<LoaderCircleIcon class="mr-1 inline size-3.5 animate-spin" />
									{/if}
									{#if clubVideoField.phase === 'processing'}
										Processing
									{:else if clubVideoField.isBusy}
										{$_('onboarding.startClub.uploading')}
									{:else if clubVideoField.isReady}
										Ready
									{:else}
										{$_('common.browse')}
									{/if}
								</div>
								<p class="text-base leading-7 font-medium text-gray-700">
									{#if clubVideoField.phase === 'processing'}
										Processing video...
									{:else if clubVideoField.isBusy}
										{$_('onboarding.startClub.videoUploading')}
									{:else if clubVideoField.isReady}
										Video uploaded and ready
									{:else}
										{$_('onboarding.startClub.videoDropPrompt')}
									{/if}
								</p>
								<p class="text-sm text-gray-500">
									{#if clubVideoField.phase === 'processing'}
										Hang tight while we finish preparing your video.
									{:else if clubVideoField.isReady}
										Your video is ready to submit.
									{:else}
										{$_('onboarding.startClub.videoRequirements')}
									{/if}
								</p>
								{#if clubVideoField.selectedFileName}
									<p class="max-w-full truncate text-sm text-gray-500">
										{clubVideoField.selectedFileName}
									</p>
								{/if}
								{#if clubVideoField.isBusy}
									<p class="text-xs font-semibold text-primary">
										{$_('onboarding.startClub.videoUploadingStatus')}
									</p>
								{:else if clubVideoField.isReady}
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

			<div class={actionClass}>
				<Button
					variant="default"
					size="xl"
					class="h-12 w-full"
					disabled={!hasReadyVideo || pending || clubVideoField.isBusy || auth.isLoading}
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
