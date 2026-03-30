<script lang="ts">
	import { browser } from '$app/environment';
	import { env } from '$env/dynamic/public';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import PublicClubMap from '$lib/components/app/public-club-map.svelte';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { api } from '$convex/_generated/api';
	import { routes } from '$lib/routes';
	import { fetchMapboxLocationSuggestions, type MapboxCoordinates } from '$lib/maps/mapbox';

	const PUBLIC_MAPBOX_ACCESS_TOKEN = env.PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';
	const clubsResponse = useStableQuery(api.clubs.listPublicClubs, {});

	type ClubListItem = NonNullable<typeof clubsResponse.data>[number];

	let userCoordinates = $state<MapboxCoordinates | null>(null);
	let selectedClubCode = $state<string | null>(null);
	let carousel = $state<HTMLDivElement | null>(null);
	let cardRefs = $state<Record<string, HTMLDivElement | null>>({});
	const resolvedCoordinatesByCode = new SvelteMap<string, MapboxCoordinates>();
	const coordinateLookupsInFlight = new SvelteSet<string>();
	let isDraggingCarousel = $state(false);
	let dragStartX = 0;
	let dragStartScrollLeft = 0;
	let shouldScrollSelectedCardIntoView = $state(false);
	let carouselSelectionFrame = 0;

	const haversineDistanceKm = (from: MapboxCoordinates, to: MapboxCoordinates) => {
		const earthRadiusKm = 6371;
		const toRadians = (value: number) => (value * Math.PI) / 180;
		const latDelta = toRadians(to.latitude - from.latitude);
		const lonDelta = toRadians(to.longitude - from.longitude);
		const lat1 = toRadians(from.latitude);
		const lat2 = toRadians(to.latitude);
		const a =
			Math.sin(latDelta / 2) ** 2 +
			Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDelta / 2) ** 2;
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
		return resolvedCoordinatesByCode.get(club.code ?? '') ?? null;
	};

	let clubs = $derived(clubsResponse.data ?? []);
	let visibleClubs = $derived.by(() => {
		const enriched = clubs.map((club) => {
			const coordinates = getClubCoordinates(club);
			const distanceKm =
				userCoordinates && coordinates ? haversineDistanceKm(userCoordinates, coordinates) : null;
			return {
				...club,
				coordinates,
				distanceKm
			};
		});

		return enriched.sort((a, b) => {
			if (a.distanceKm !== null && b.distanceKm !== null) {
				return a.distanceKm - b.distanceKm;
			}
			if (a.distanceKm !== null) return -1;
			if (b.distanceKm !== null) return 1;
			return b.createdAt - a.createdAt;
		});
	});

	let mapClubs = $derived(
		visibleClubs
			.filter((club) => club.code && club.coordinates)
			.map((club) => ({
				id: club.id,
				name: club.name,
				code: club.code as string,
				location: club.location,
				coordinates: club.coordinates as MapboxCoordinates
			}))
	);

	const requestUserLocation = async () => {
		if (!browser || !navigator.geolocation) return;

		try {
			const position = await new Promise<GeolocationPosition>((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(resolve, reject, {
					enableHighAccuracy: true,
					timeout: 10000,
					maximumAge: 5 * 60 * 1000
				});
			});
			userCoordinates = {
				longitude: position.coords.longitude,
				latitude: position.coords.latitude
			};
		} catch (error) {
			userCoordinates = null;
			void error;
		}
	};

	const focusClub = (clubCode: string) => {
		shouldScrollSelectedCardIntoView = true;
		selectedClubCode = clubCode;
	};

	const getClubDetailsPath = (clubCode: string) => `${routes.onboardingJoinClub}/${clubCode}`;

	const selectClub = async (clubCode: string) => {
		selectedClubCode = clubCode;
		await goto(getClubDetailsPath(clubCode));
	};

	const handleCarouselPointerDown = (event: PointerEvent) => {
		if (!carousel || event.pointerType === 'touch') return;
		isDraggingCarousel = true;
		dragStartX = event.clientX;
		dragStartScrollLeft = carousel.scrollLeft;
		carousel.setPointerCapture(event.pointerId);
	};

	const handleCarouselPointerMove = (event: PointerEvent) => {
		if (!carousel || !isDraggingCarousel) return;
		const deltaX = event.clientX - dragStartX;
		carousel.scrollLeft = dragStartScrollLeft - deltaX;
	};

	const handleCarouselPointerUp = (event: PointerEvent) => {
		if (!carousel || !isDraggingCarousel) return;
		isDraggingCarousel = false;
		if (carousel.hasPointerCapture(event.pointerId)) {
			carousel.releasePointerCapture(event.pointerId);
		}
	};

	const syncSelectedClubFromCarousel = () => {
		if (!carousel || visibleClubs.length === 0) return;
		const carouselCenter = carousel.scrollLeft + carousel.clientWidth / 2;
		let nearestClubCode: string | null = null;
		let nearestDistance = Number.POSITIVE_INFINITY;

		for (const club of visibleClubs) {
			const node = cardRefs[club.code ?? club.id];
			if (!node || !club.code) continue;
			const cardCenter = node.offsetLeft + node.offsetWidth / 2;
			const distance = Math.abs(cardCenter - carouselCenter);
			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearestClubCode = club.code;
			}
		}

		if (nearestClubCode && nearestClubCode !== selectedClubCode) {
			shouldScrollSelectedCardIntoView = false;
			selectedClubCode = nearestClubCode;
		}
	};

	const handleCarouselScroll = () => {
		if (!browser) return;
		if (carouselSelectionFrame) {
			cancelAnimationFrame(carouselSelectionFrame);
		}
		carouselSelectionFrame = requestAnimationFrame(() => {
			carouselSelectionFrame = 0;
			syncSelectedClubFromCarousel();
		});
	};

	onMount(() => {
		void requestUserLocation();
		return () => {
			if (carouselSelectionFrame) {
				cancelAnimationFrame(carouselSelectionFrame);
			}
		};
	});

	$effect(() => {
		if (!PUBLIC_MAPBOX_ACCESS_TOKEN) return;
		const currentClubs = clubs;
		for (const club of currentClubs) {
			if (!club.code || !club.location || getClubCoordinates(club)) continue;
			if (coordinateLookupsInFlight.has(club.code)) continue;
			coordinateLookupsInFlight.add(club.code);
			void fetchMapboxLocationSuggestions({
				query: club.location,
				accessToken: PUBLIC_MAPBOX_ACCESS_TOKEN,
				limit: 1,
				language: 'en'
			})
				.then((results) => {
					const match = results[0];
					if (!match) return;
					resolvedCoordinatesByCode.set(club.code as string, {
						longitude: match.longitude,
						latitude: match.latitude
					});
				})
				.finally(() => {
					coordinateLookupsInFlight.delete(club.code as string);
				});
		}
	});

	$effect(() => {
		if (!browser || !selectedClubCode) return;
		if (!shouldScrollSelectedCardIntoView) return;
		const node = cardRefs[selectedClubCode];
		node?.scrollIntoView({
			behavior: 'smooth',
			inline: 'center',
			block: 'nearest'
		});
		shouldScrollSelectedCardIntoView = false;
	});

	$effect(() => {
		if (!browser || selectedClubCode || visibleClubs.length === 0) return;
		const firstClubCode = visibleClubs.find((club) => club.code)?.code ?? null;
		if (!firstClubCode) return;
		selectedClubCode = firstClubCode;
	});
</script>

<FlowShell
	step={1}
	total={5}
	showAccountLink={false}
	showSideIllustration={true}
	showProgressBar={false}
	edgeToEdgePanel={true}
>
	<div class="flex w-full flex-1 min-h-0 flex-col bg-[#ffd7bb]">
		{#if PUBLIC_MAPBOX_ACCESS_TOKEN}
			<div class="relative flex min-h-full flex-1 flex-col overflow-hidden">
				<a
					href={routes.onboardingJoinClub}
					class="absolute left-4 top-4 z-20 inline-flex w-fit items-center text-gray-500 transition-colors duration-200 hover:text-gray-700"
					aria-label="Go back"
				>
					<ChevronLeftIcon class="size-7" />
				</a>

				<div class="relative flex flex-1 pb-28 pt-0">
					<PublicClubMap
						accessToken={PUBLIC_MAPBOX_ACCESS_TOKEN}
						clubs={mapClubs}
						{userCoordinates}
						{selectedClubCode}
						onSelectClub={focusClub}
						class="min-h-full rounded-none border-0 bg-transparent shadow-none"
					/>
				</div>

				{#if visibleClubs.length > 0}
					<div class="pointer-events-none absolute inset-x-0 bottom-4 z-20">
						<div
							bind:this={carousel}
							role="group"
							aria-label="Public clubs carousel"
							class="pointer-events-auto flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
							class:cursor-grab={!isDraggingCarousel}
							class:cursor-grabbing={isDraggingCarousel}
							onscroll={handleCarouselScroll}
							onpointerdown={handleCarouselPointerDown}
							onpointermove={handleCarouselPointerMove}
							onpointerup={handleCarouselPointerUp}
							onpointercancel={handleCarouselPointerUp}
							onlostpointercapture={handleCarouselPointerUp}
						>
							<div class="w-18 shrink-0 snap-center"></div>
							{#each visibleClubs as club (club.id)}
								<div
									bind:this={cardRefs[club.code ?? club.id]}
									class="h-[9.75rem] w-[15.5rem] shrink-0 snap-center text-left"
								>
									<Card
										class="h-full rounded-2xl border-0 bg-white/96 shadow-[0_16px_32px_rgba(15,23,42,0.16)]"
									>
										<CardContent class="flex h-full flex-col justify-between gap-3 p-4">
											<div class="flex items-start gap-3">
												<div class="min-w-0">
													<p class="truncate text-base font-semibold text-gray-900">{club.name}</p>
													{#if club.location}
														<p class="mt-1 line-clamp-2 min-h-[2.5rem] overflow-hidden text-ellipsis text-xs leading-5 text-gray-600">
															{club.location}
														</p>
													{/if}
												</div>
											</div>

											<div class="flex items-center justify-end">
												{#if club.code}
													<button
														type="button"
														class="inline-flex items-center rounded-full bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-200 hover:bg-orange-600"
														onpointerdown={(event) => event.stopPropagation()}
														onpointerup={(event) => event.stopPropagation()}
														onclick={(event) => {
															event.stopPropagation();
															if (club.code) {
																void selectClub(club.code);
															}
														}}
													>
														Select club
													</button>
												{/if}
											</div>
										</CardContent>
									</Card>
								</div>
							{/each}
							<div class="w-18 shrink-0 snap-center"></div>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</FlowShell>
