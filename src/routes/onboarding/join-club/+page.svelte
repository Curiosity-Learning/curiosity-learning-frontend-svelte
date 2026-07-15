<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { env } from '$env/dynamic/public';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import TicketIcon from '@lucide/svelte/icons/ticket';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { PageHeaderBackButton, PageHeaderTitle, ScreenBackButton } from '$lib/components/app';
	import LocationAutocompleteField from '$lib/components/app/location-autocomplete-field.svelte';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import { _, t } from '$lib/i18n';
	import { routes } from '$lib/routes';
	import { navigateBack } from '$lib/navigation/back';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import {
		type MapboxBoundingBox,
		type MapboxCoordinates,
		type MapboxLocationOption
	} from '$lib/maps/mapbox';

	const CODE_LENGTH = 6;
	const JOIN_CLUB_CODE_STORAGE_KEY = 'cl_join_club_code_v1';
	const PUBLIC_MAPBOX_ACCESS_TOKEN = env.PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';
	const SEARCH_RADIUS_KM = 50;
	const AREA_FEATURE_TYPES = new Set(['country', 'region', 'district']);
	// Query param keys used to preserve search state across navigation (CL-711 CEO feedback item
	// 5): opening a club from the results and pressing back must restore the previous search
	// instead of wiping it. Kept in the URL (rather than sessionStorage/snapshot) so the search
	// also survives a refresh or being shared/bookmarked.
	const SEARCH_PARAM_QUERY = 'q';
	const SEARCH_PARAM_LAT = 'lat';
	const SEARCH_PARAM_LNG = 'lng';
	const SEARCH_PARAM_BBOX_MIN_LON = 'bMinLon';
	const SEARCH_PARAM_BBOX_MIN_LAT = 'bMinLat';
	const SEARCH_PARAM_BBOX_MAX_LON = 'bMaxLon';
	const SEARCH_PARAM_BBOX_MAX_LAT = 'bMaxLat';
	const SEARCH_PARAM_FEATURE_TYPE = 'type';
	const convexClient = useConvexClient();
	const clubsResponse = useStableQuery(api.clubs.listPublicClubs, {});

	type ClubListItem = NonNullable<typeof clubsResponse.data>[number];
	type FlowMode = 'location' | 'code';
	type EstimatedLocation = {
		label: string;
		coordinates: MapboxCoordinates | null;
	};

	type SearchState = {
		query: string;
		coordinates: MapboxCoordinates | null;
		location: MapboxLocationOption | null;
	};

	const readSearchStateFromUrl = (url: URL): SearchState => {
		const params = url.searchParams;
		const query = params.get(SEARCH_PARAM_QUERY);
		if (!query) {
			return { query: '', coordinates: null, location: null };
		}

		const latitude = Number(params.get(SEARCH_PARAM_LAT));
		const longitude = Number(params.get(SEARCH_PARAM_LNG));
		if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
			return { query, coordinates: null, location: null };
		}

		const coordinates: MapboxCoordinates = { latitude, longitude };
		const minLongitude = Number(params.get(SEARCH_PARAM_BBOX_MIN_LON));
		const minLatitude = Number(params.get(SEARCH_PARAM_BBOX_MIN_LAT));
		const maxLongitude = Number(params.get(SEARCH_PARAM_BBOX_MAX_LON));
		const maxLatitude = Number(params.get(SEARCH_PARAM_BBOX_MAX_LAT));
		const bbox: MapboxBoundingBox | null =
			Number.isFinite(minLongitude) &&
			Number.isFinite(minLatitude) &&
			Number.isFinite(maxLongitude) &&
			Number.isFinite(maxLatitude)
				? { minLongitude, minLatitude, maxLongitude, maxLatitude }
				: null;
		const featureType = params.get(SEARCH_PARAM_FEATURE_TYPE);

		const location: MapboxLocationOption = {
			label: query,
			value: query,
			longitude,
			latitude,
			bbox,
			featureType
		};

		return { query, coordinates, location };
	};

	const initialSearchState = readSearchStateFromUrl(page.url);

	let mode = $state<FlowMode>('location');
	let codeChars = $state<string[]>(Array.from({ length: CODE_LENGTH }, () => ''));
	let inputRefs: Array<HTMLInputElement | null> = Array.from({ length: CODE_LENGTH }, () => null);
	let validatingCode = $state(false);
	let codeError = $state('');
	let locationQuery = $state(initialSearchState.query);
	let selectedLocationCoordinates = $state<MapboxCoordinates | null>(
		initialSearchState.coordinates
	);
	let selectedLocation = $state<MapboxLocationOption | null>(initialSearchState.location);
	let interestEmail = $state('');
	let interestPending = $state(false);
	let interestMessage = $state('');
	let interestError = $state('');

	let canContinue = $derived(codeChars.every((char) => char.length === 1));
	let joinedCode = $derived(codeChars.join(''));
	let locationSearchStarted = $derived(Boolean(selectedLocationCoordinates));
	let showClubCodeShortcut = $derived(!locationQuery.trim() && !selectedLocationCoordinates);
	let isAppNewClubFlow = $derived(page.url.pathname.startsWith(routes.newClubJoin));
	let joinClubPath = $derived(isAppNewClubFlow ? routes.newClubJoin : routes.onboardingJoinClub);
	let startClubPath = $derived(isAppNewClubFlow ? routes.newClubStart : routes.onboardingStartClub);
	let backPath = $derived(isAppNewClubFlow ? routes.newClub : routes.onboardingGetStarted);
	let contentClass = $derived(
		isAppNewClubFlow
			? 'flex w-full min-w-0 flex-col gap-6'
			: 'mx-auto flex w-full max-w-[28.75rem] min-w-0 flex-1 flex-col gap-8'
	);
	let defaultLocation = $derived(
		(page.data as { estimatedLocation?: EstimatedLocation | null }).estimatedLocation ?? null
	);

	const normalizeCode = (value: string) => value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

	const writeStoredCode = (value: string) => {
		if (!browser) return;
		try {
			if (value) {
				sessionStorage.setItem(JOIN_CLUB_CODE_STORAGE_KEY, value);
				return;
			}
			sessionStorage.removeItem(JOIN_CLUB_CODE_STORAGE_KEY);
		} catch {
			// Ignore storage errors.
		}
	};

	const readStoredCode = () => {
		if (!browser) return '';
		try {
			return normalizeCode(sessionStorage.getItem(JOIN_CLUB_CODE_STORAGE_KEY) ?? '').slice(
				0,
				CODE_LENGTH
			);
		} catch {
			return '';
		}
	};

	const focusInput = (index: number) => {
		if (index < 0 || index >= CODE_LENGTH) return;
		const node = inputRefs[index];
		node?.focus();
		node?.select();
	};

	const showCodeEntry = () => {
		mode = 'code';
		requestAnimationFrame(() => {
			const firstEmptyIndex = codeChars.findIndex((char) => char.length === 0);
			focusInput(firstEmptyIndex >= 0 ? firstEmptyIndex : CODE_LENGTH - 1);
		});
	};

	const goBack = async () => {
		if (mode === 'code') {
			mode = 'location';
			return;
		}
		await navigateBack({ fallbackHref: backPath });
	};

	const fillFrom = (startIndex: number, value: string) => {
		const normalized = normalizeCode(value).slice(0, CODE_LENGTH - startIndex);
		for (let i = 0; i < normalized.length; i += 1) {
			codeChars[startIndex + i] = normalized[i] ?? '';
		}
		const nextIndex = Math.min(startIndex + normalized.length, CODE_LENGTH - 1);
		focusInput(nextIndex);
	};

	const handleInput = (index: number, event: Event) => {
		const target = event.currentTarget as HTMLInputElement;
		const normalized = normalizeCode(target.value);

		if (!normalized) {
			codeChars[index] = '';
			return;
		}

		if (normalized.length === 1) {
			codeChars[index] = normalized;
			if (index < CODE_LENGTH - 1) {
				focusInput(index + 1);
			}
			return;
		}

		fillFrom(index, normalized);
	};

	const handleKeyDown = (index: number, event: KeyboardEvent) => {
		if (event.key === 'Backspace') {
			event.preventDefault();
			if (codeChars[index]) {
				codeChars[index] = '';
				return;
			}
			if (index > 0) {
				codeChars[index - 1] = '';
				focusInput(index - 1);
			}
			return;
		}

		if (event.key === 'ArrowLeft' && index > 0) {
			event.preventDefault();
			focusInput(index - 1);
			return;
		}

		if (event.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
			event.preventDefault();
			focusInput(index + 1);
		}
	};

	const handlePaste = (index: number, event: ClipboardEvent) => {
		const pasted = normalizeCode(event.clipboardData?.getData('text') ?? '');
		if (!pasted) return;
		event.preventDefault();
		fillFrom(index, pasted);
	};

	const continueToPreview = async () => {
		if (!canContinue) return;
		validatingCode = true;
		codeError = '';
		try {
			const rateLimitCheck = await convexClient.mutation(api.clubs.checkClubCodeLookupRateLimit, {
				code: joinedCode
			});
			if (!rateLimitCheck.ok) {
				codeError = t('onboarding.joinClub.rateLimited');
				return;
			}
			const preview = await convexClient.query(api.clubs.getClubPreviewByCode, {
				code: joinedCode
			});
			if (!preview) {
				codeError = t('onboarding.joinClub.notFound');
				return;
			}
			await goto(`${joinClubPath}/${joinedCode}`);
		} catch {
			codeError = t('onboarding.joinClub.validateFailure');
		} finally {
			validatingCode = false;
		}
	};

	const haversineDistanceKm = (from: MapboxCoordinates, to: MapboxCoordinates) => {
		const earthRadiusKm = 6371;
		const toRadians = (value: number) => (value * Math.PI) / 180;
		const latDelta = toRadians(to.latitude - from.latitude);
		const lonDelta = toRadians(to.longitude - from.longitude);
		const lat1 = toRadians(from.latitude);
		const lat2 = toRadians(to.latitude);
		const a =
			Math.sin(latDelta / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDelta / 2) ** 2;
		return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	};

	const getClubCoordinates = (club: ClubListItem): MapboxCoordinates | null => {
		if (
			typeof club.locationLongitude === 'number' &&
			Number.isFinite(club.locationLongitude) &&
			typeof club.locationLatitude === 'number' &&
			Number.isFinite(club.locationLatitude)
		) {
			return {
				longitude: club.locationLongitude,
				latitude: club.locationLatitude
			};
		}
		return null;
	};

	const isInsideBoundingBox = (coordinates: MapboxCoordinates, location: MapboxLocationOption) => {
		const bbox = location.bbox;
		if (!bbox) return false;
		return (
			coordinates.longitude >= bbox.minLongitude &&
			coordinates.longitude <= bbox.maxLongitude &&
			coordinates.latitude >= bbox.minLatitude &&
			coordinates.latitude <= bbox.maxLatitude
		);
	};

	const shouldUseAreaSearch = (location: MapboxLocationOption | null) =>
		Boolean(
			location?.bbox &&
			location.featureType &&
			AREA_FEATURE_TYPES.has(location.featureType.toLowerCase())
		);

	// A club can match a nearby search two ways: it falls within the searched region's bounding
	// box (a country/region/district search), or it's within SEARCH_RADIUS_KM of a specific point.
	// CL-711 CEO feedback item 2: for a region match, the club IS in the area the user searched —
	// showing "66 km away" (the distance to some arbitrary point inside that region) reads as a
	// bug, so region matches show just the city instead of a distance.
	let nearbyClubs = $derived.by(() => {
		if (!selectedLocationCoordinates) return [];
		const locationCoordinates = selectedLocationCoordinates;
		const useAreaSearch = shouldUseAreaSearch(selectedLocation);
		return (clubsResponse.data ?? [])
			.map((club) => {
				const coordinates = getClubCoordinates(club);
				if (!coordinates) return null;
				const distanceKm = haversineDistanceKm(locationCoordinates, coordinates);
				if (useAreaSearch && selectedLocation) {
					if (!isInsideBoundingBox(coordinates, selectedLocation)) return null;
					return {
						id: club.id,
						name: club.name,
						city: club.city,
						distanceKm,
						isRegionMatch: true
					};
				}
				if (distanceKm > SEARCH_RADIUS_KM) return null;
				return {
					id: club.id,
					name: club.name,
					city: club.city,
					distanceKm,
					isRegionMatch: false
				};
			})
			.filter((club): club is NonNullable<typeof club> => Boolean(club))
			.sort((a, b) => a.distanceKm - b.distanceKm);
	});

	const goToClubPreview = async (clubId: string) => {
		await goto(`/clubs/${clubId}`);
	};

	const formatDistance = (distanceKm: number) => {
		if (distanceKm < 1) return 'Less than 1 km away';
		return `${Math.round(distanceKm)} km away`;
	};

	const formatSecondaryLabel = (club: (typeof nearbyClubs)[number]) => {
		if (club.isRegionMatch) return club.city ?? '';
		return formatDistance(club.distanceKm);
	};

	const submitInterest = async () => {
		if (!selectedLocationCoordinates || !interestEmail.trim()) return;
		interestPending = true;
		interestMessage = '';
		interestError = '';
		try {
			await convexClient.mutation(api.clubs.submitClubInterestSignup, {
				email: interestEmail,
				location: locationQuery,
				locationLatitude: selectedLocationCoordinates.latitude,
				locationLongitude: selectedLocationCoordinates.longitude
			});
			interestMessage = t('onboarding.joinClub.interestSuccess');
			interestEmail = '';
		} catch (error) {
			interestError =
				error instanceof Error ? error.message : t('onboarding.joinClub.interestFailure');
		} finally {
			interestPending = false;
		}
	};

	onMount(() => {
		const storedCode = readStoredCode();
		if (storedCode) {
			fillFrom(0, storedCode);
		}
	});

	$effect(() => {
		void joinedCode;
		writeStoredCode(joinedCode);
		codeError = '';
	});

	$effect(() => {
		void selectedLocationCoordinates;
		interestMessage = '';
		interestError = '';
	});

	// CL-711 CEO feedback item 5: keep the current search in the URL so that opening a club from
	// the results and pressing back restores the previous results/query instead of wiping the
	// search. Uses goto with replaceState (not shallow replaceState from $app/navigation): the
	// shallow variant updates location.href but leaves the router's recorded page URL
	// (history.state['sveltekit:pageurl']) at the bare path, so back-navigation restored the
	// URL without params and the search was lost — verified in-browser. replaceState:true keeps
	// typing from spamming history; navigating to a club preview pushes a new entry via goto.
	$effect(() => {
		if (!browser) return;
		const coordinates = selectedLocationCoordinates;
		const location = selectedLocation;
		const query = locationQuery;

		const url = new URL(window.location.href);
		if (coordinates) {
			url.searchParams.set(SEARCH_PARAM_QUERY, query);
			url.searchParams.set(SEARCH_PARAM_LAT, String(coordinates.latitude));
			url.searchParams.set(SEARCH_PARAM_LNG, String(coordinates.longitude));
			if (location?.bbox) {
				url.searchParams.set(SEARCH_PARAM_BBOX_MIN_LON, String(location.bbox.minLongitude));
				url.searchParams.set(SEARCH_PARAM_BBOX_MIN_LAT, String(location.bbox.minLatitude));
				url.searchParams.set(SEARCH_PARAM_BBOX_MAX_LON, String(location.bbox.maxLongitude));
				url.searchParams.set(SEARCH_PARAM_BBOX_MAX_LAT, String(location.bbox.maxLatitude));
			} else {
				url.searchParams.delete(SEARCH_PARAM_BBOX_MIN_LON);
				url.searchParams.delete(SEARCH_PARAM_BBOX_MIN_LAT);
				url.searchParams.delete(SEARCH_PARAM_BBOX_MAX_LON);
				url.searchParams.delete(SEARCH_PARAM_BBOX_MAX_LAT);
			}
			if (location?.featureType) {
				url.searchParams.set(SEARCH_PARAM_FEATURE_TYPE, location.featureType);
			} else {
				url.searchParams.delete(SEARCH_PARAM_FEATURE_TYPE);
			}
		} else {
			url.searchParams.delete(SEARCH_PARAM_QUERY);
			url.searchParams.delete(SEARCH_PARAM_LAT);
			url.searchParams.delete(SEARCH_PARAM_LNG);
			url.searchParams.delete(SEARCH_PARAM_BBOX_MIN_LON);
			url.searchParams.delete(SEARCH_PARAM_BBOX_MIN_LAT);
			url.searchParams.delete(SEARCH_PARAM_BBOX_MAX_LON);
			url.searchParams.delete(SEARCH_PARAM_BBOX_MAX_LAT);
			url.searchParams.delete(SEARCH_PARAM_FEATURE_TYPE);
		}

		const currentUrl = `${window.location.pathname}${window.location.search}`;
		const nextUrl = `${url.pathname}${url.search}`;
		if (currentUrl !== nextUrl) {
			void goto(nextUrl, { replaceState: true, keepFocus: true, noScroll: true });
		}
	});
</script>

{#if isAppNewClubFlow}
	<PageHeaderBackButton fallbackHref={routes.newClub} />
	<PageHeaderTitle title={$_('onboarding.joinClub.title')} />
{/if}

<FlowShell step={1} total={5} showSideIllustration={true} appFrame={isAppNewClubFlow}>
	{#snippet headerSupplement()}
		<div class="flex items-center justify-between gap-4">
			<ScreenBackButton onclick={() => void goBack()} />
		</div>
	{/snippet}
	<div class={contentClass}>
		{#if mode === 'location'}
			<section class="flex flex-col gap-6">
				<div class="flex flex-col gap-2">
					{#if !isAppNewClubFlow}
						<h1 class="type-step-title text-gray-900">{$_('onboarding.joinClub.title')}</h1>
					{/if}
					<p class="text-base leading-7 text-gray-600">
						{$_('onboarding.joinClub.locationDescription')}
					</p>
				</div>

				<LocationAutocompleteField
					id="join-club-location"
					label={$_('onboarding.joinClub.locationLabel')}
					bind:value={locationQuery}
					bind:coordinates={selectedLocationCoordinates}
					bind:selectedLocation
					{defaultLocation}
					accessToken={PUBLIC_MAPBOX_ACCESS_TOKEN}
					placeholder={$_('onboarding.joinClub.locationPlaceholder')}
					emptyMessage={$_('onboarding.joinClub.locationEmptyFound')}
					lookupFailureMessage={$_('onboarding.joinClub.locationLookupFailure')}
				/>

				{#if showClubCodeShortcut}
					<div class="inline-flex w-fit items-center gap-2 text-sm font-semibold text-gray-500">
						<TicketIcon class="size-4 shrink-0" />
						<span>{$_('onboarding.joinClub.haveCode')}</span>
						<Button variant="link" class="text-sm" onclick={showCodeEntry}>
							{$_('onboarding.joinClub.enterHere')}
						</Button>
					</div>
				{/if}
			</section>

			{#if selectedLocationCoordinates}
				<section class="flex flex-col gap-3">
					{#if clubsResponse.isLoading}
						<p
							class="type-body-compact rounded-lg border border-gray-200 bg-white px-4 py-3 text-gray-600"
						>
							{$_('common.loading')}
						</p>
					{:else if nearbyClubs.length > 0}
						<div class="flex flex-col gap-1">
							<h2 class="text-lg font-bold text-gray-900">
								{$_('onboarding.joinClub.nearbyTitle')}
							</h2>
							<p class="type-body-compact text-gray-600">
								{$_('onboarding.joinClub.nearbyDescription')}
							</p>
						</div>
						<div class="flex flex-col gap-2">
							{#each nearbyClubs as club (club.id)}
								<button
									type="button"
									class="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white px-4 py-3 text-left transition-colors duration-200 hover:border-orange-300 hover:bg-orange-50"
									onclick={() => void goToClubPreview(club.id)}
								>
									<span class="min-w-0 truncate text-base font-semibold text-gray-900">
										{club.name}
									</span>
									{#if formatSecondaryLabel(club)}
										<span class="type-caption shrink-0 text-gray-500">
											{formatSecondaryLabel(club)}
										</span>
									{/if}
								</button>
							{/each}
						</div>
					{:else if locationSearchStarted}
						<div class="flex flex-col gap-4">
							<h3 class="type-h6-bold text-gray-900">
								{$_('onboarding.joinClub.noClubsTitle')}
							</h3>
							<p class="type-body text-gray-600">
								{$_('onboarding.joinClub.noClubsDescription')}
							</p>
							<div class="flex flex-col gap-2">
								<label for="join-club-interest-email" class="text-sm font-semibold text-gray-900">
									{$_('onboarding.joinClub.emailLabel')}
								</label>
								<div class="flex gap-2">
									<Input
										id="join-club-interest-email"
										type="email"
										bind:value={interestEmail}
										autocomplete="email"
										class="h-10"
										placeholder={$_('onboarding.joinClub.emailPlaceholder')}
									/>
									<Button
										type="button"
										class="h-10 shrink-0 px-4"
										disabled={interestPending || !interestEmail.trim()}
										onclick={() => void submitInterest()}
									>
										{interestPending ? $_('common.saving') : $_('onboarding.joinClub.emailSubmit')}
									</Button>
								</div>
								{#if interestMessage}
									<p class="type-body-compact text-green-700">{interestMessage}</p>
								{/if}
								{#if interestError}
									<p class="type-body-compact text-red-700">{interestError}</p>
								{/if}
							</div>
							<div class="flex items-center gap-3 text-sm font-semibold text-gray-400">
								<div class="h-px flex-1 bg-gray-200"></div>
								<span>or</span>
								<div class="h-px flex-1 bg-gray-200"></div>
							</div>
							<Button href={startClubPath} variant="outline" class="h-11 w-full">
								{$_('onboarding.joinClub.startClubCta')}
							</Button>
						</div>
					{/if}
				</section>
			{/if}
		{:else}
			<section class="flex flex-col gap-6">
				<div class="flex flex-col gap-2">
					{#if !isAppNewClubFlow}
						<h1 class="type-step-title text-gray-900">{$_('onboarding.joinClub.codeTitle')}</h1>
					{/if}
					<p class="text-base leading-7 text-gray-600">{$_('onboarding.joinClub.description')}</p>
				</div>

				<div class="grid w-full grid-cols-6 gap-1.5 sm:gap-2.5">
					{#each codeChars as char, index (index)}
						<input
							bind:this={inputRefs[index]}
							inputmode="text"
							autocapitalize="characters"
							autocomplete={index === 0 ? 'one-time-code' : 'off'}
							maxlength={6}
							value={char}
							oninput={(event) => handleInput(index, event)}
							onkeydown={(event) => handleKeyDown(index, event)}
							onpaste={(event) => handlePaste(index, event)}
							class={`h-12 w-full min-w-0 rounded-md border bg-input-background px-0 text-center text-lg font-semibold text-gray-900 transition-[border-color,box-shadow] duration-200 outline-none sm:h-14 sm:text-xl ${char ? 'border-orange-500' : 'border-gray-300'} focus:border-orange-500 focus:ring-2 focus:ring-orange-200`}
						/>
					{/each}
				</div>
			</section>

			{#if codeError}
				<p
					class="type-body-compact rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700"
				>
					{codeError}
				</p>
			{/if}

			<div
				class={isAppNewClubFlow
					? 'flex max-w-[28.75rem] flex-col gap-3'
					: 'mt-auto flex flex-col gap-3 pb-2 sm:pb-6'}
			>
				<Button
					variant="default"
					size="xl"
					class="h-14 w-full min-w-0 rounded-md px-4 text-center whitespace-normal"
					disabled={!canContinue || validatingCode}
					onclick={() => void continueToPreview()}
				>
					{validatingCode ? $_('onboarding.joinClub.checking') : $_('onboarding.joinClub.continue')}
				</Button>
			</div>
		{/if}
	</div>
</FlowShell>
