<script lang="ts">
	import { browser } from '$app/environment';
	import { onDestroy } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { MAPBOX_STYLE_URL, type MapboxCoordinates } from '$lib/maps/mapbox';
	import 'mapbox-gl/dist/mapbox-gl.css';

	type ClubMarker = {
		id: string;
		name: string;
		location: string | null;
		coordinates: MapboxCoordinates;
	};

	type Props = {
		accessToken: string;
		clubs: ClubMarker[];
		userCoordinates?: MapboxCoordinates | null;
		selectedClubId?: string | null;
		onSelectClub?: (clubId: string) => void;
		class?: string;
	};

	let {
		accessToken,
		clubs,
		userCoordinates = null,
		selectedClubId = null,
		onSelectClub,
		class: className = ''
	}: Props = $props();

	let container = $state<HTMLDivElement | null>(null);
	let map = $state<import('mapbox-gl').Map | null>(null);
	let clubMarkers = $state<import('mapbox-gl').Marker[]>([]);
	let clubMarkerById = new SvelteMap<string, import('mapbox-gl').Marker>();
	let userMarker = $state<import('mapbox-gl').Marker | null>(null);
	let mapFailed = $state(false);

	const clearClubMarkers = () => {
		for (const marker of clubMarkers) {
			marker.remove();
		}
		clubMarkers = [];
		clubMarkerById = new SvelteMap();
	};

	const destroyMap = () => {
		clearClubMarkers();
		userMarker?.remove();
		userMarker = null;
		map?.remove();
		map = null;
	};

	const flyToClub = (clubId: string | null) => {
		if (!map || !clubId) return;
		const club = clubs.find((item) => item.id === clubId);
		if (!club) return;
		const currentCenter = map.getCenter();
		const longitudeDelta = club.coordinates.longitude - currentCenter.lng;
		const targetBearing = Math.max(-28, Math.min(28, longitudeDelta * 2.4));
		map.stop();
		map.flyTo({
			center: [club.coordinates.longitude, club.coordinates.latitude],
			zoom: 3.5,
			bearing: targetBearing,
			speed: 0.62,
			curve: 1.7,
			easing: (t) => 1 - (1 - t) ** 3,
			essential: true
		});
	};

	const getInitialViewport = () => {
		const width = container?.clientWidth ?? 0;
		const height = container?.clientHeight ?? 0;
		const fallbackWidth = width || 480;
		const fallbackHeight = height || 640;
		const isCompact = fallbackWidth < 640;
		return {
			initialZoom: isCompact ? 0.72 : 0.92,
			singlePointZoom: isCompact ? 0.84 : 1.02,
			maxFitZoom: isCompact ? 0.88 : 1.08,
			padding: {
				top: Math.max(24, Math.round(fallbackHeight * 0.06)),
				right: Math.max(24, Math.round(fallbackWidth * 0.08)),
				bottom: Math.max(136, Math.round(fallbackHeight * 0.24)),
				left: Math.max(24, Math.round(fallbackWidth * 0.08))
			}
		};
	};

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

	const getClubClusterMetrics = () => {
		if (clubs.length === 0) return null;
		const centroid = clubs.reduce(
			(acc, club) => ({
				longitude: acc.longitude + club.coordinates.longitude / clubs.length,
				latitude: acc.latitude + club.coordinates.latitude / clubs.length
			}),
			{ longitude: 0, latitude: 0 }
		);
		const maxDistanceKm = Math.max(
			...clubs.map((club) => haversineDistanceKm(centroid, club.coordinates))
		);
		return { centroid, maxDistanceKm };
	};

	const shouldShowUserMarker = () => {
		if (!userCoordinates || clubs.length === 0) return Boolean(userCoordinates);
		const nearestClubDistanceKm = Math.min(
			...clubs.map((club) => haversineDistanceKm(userCoordinates, club.coordinates))
		);
		return nearestClubDistanceKm <= 1200;
	};

	const fitToData = async (mapboxgl: typeof import('mapbox-gl').default) => {
		if (!map) return;
		const viewport = getInitialViewport();
		const clusterMetrics = getClubClusterMetrics();
		const clubPoints = clubs.map(
			(club) => [club.coordinates.longitude, club.coordinates.latitude] as [number, number]
		);
		const points =
			clubPoints.length > 0
				? clubPoints
				: userCoordinates
					? [[userCoordinates.longitude, userCoordinates.latitude] as [number, number]]
					: [];
		if (points.length === 0) {
			map.easeTo({
				center: [5.2913, 52.1326],
				zoom: viewport.initialZoom,
				essential: true
			});
			return;
		}
		if (points.length === 1) {
			map.easeTo({
				center: points[0],
				zoom: viewport.singlePointZoom,
				padding: viewport.padding,
				essential: true
			});
			return;
		}
		if (clusterMetrics && clusterMetrics.maxDistanceKm <= 450) {
			map.easeTo({
				center: [clusterMetrics.centroid.longitude, clusterMetrics.centroid.latitude],
				zoom: viewport.maxFitZoom + 0.22,
				padding: viewport.padding,
				duration: 1200,
				essential: true
			});
			return;
		}
		const bounds = new mapboxgl.LngLatBounds(points[0], points[0]);
		for (const point of points.slice(1)) bounds.extend(point);
		map.fitBounds(bounds, {
			padding: viewport.padding,
			maxZoom: viewport.maxFitZoom,
			duration: 1200,
			essential: true
		});
	};

	const syncMarkers = async () => {
		if (!map) return;
		const mapboxglModule = await import('mapbox-gl');
		const mapboxgl = mapboxglModule.default;

		clearClubMarkers();
		for (const club of clubs) {
			const selected = club.id === selectedClubId;
			const marker = new mapboxgl.Marker({
				color: selected ? '#ea580c' : '#f97316',
				scale: selected ? 1.16 : 1
			})
				.setLngLat([club.coordinates.longitude, club.coordinates.latitude])
				.addTo(map);
			const element = marker.getElement();
			element.setAttribute('aria-label', `Select ${club.name}`);
			element.setAttribute('role', 'button');
			element.classList.add('cursor-pointer');
			element.onclick = () => onSelectClub?.(club.id);
			clubMarkers = [...clubMarkers, marker];
			clubMarkerById.set(club.id, marker);
		}

		userMarker?.remove();
		userMarker = null;
		if (userCoordinates && shouldShowUserMarker()) {
			userMarker = new mapboxgl.Marker({
				color: '#f97316',
				scale: 0.94
			})
				.setLngLat([userCoordinates.longitude, userCoordinates.latitude])
				.addTo(map);
			userMarker.getElement().setAttribute('aria-label', 'Your location');
		}
	};

	const initializeMap = async () => {
		if (!browser || !container || !accessToken || map || mapFailed) return;
		const mapboxglModule = await import('mapbox-gl');
		const mapboxgl = mapboxglModule.default;
		mapboxgl.accessToken = accessToken;

		try {
			map = new mapboxgl.Map({
				container,
				style: MAPBOX_STYLE_URL,
				center: userCoordinates
					? [userCoordinates.longitude, userCoordinates.latitude]
					: [4.9041, 52.3676],
				zoom: getInitialViewport().initialZoom,
				attributionControl: true
			});
			map.getContainer().style.background = 'transparent';
			map.getCanvas().style.background = 'transparent';
			map.setProjection('globe');
			map.on('style.load', () => {
				map?.setFog({
					color: 'rgba(255, 215, 187, 1)',
					'high-color': 'rgba(255, 215, 187, 1)',
					'horizon-blend': 0.08,
					'space-color': 'rgba(255, 215, 187, 1)',
					'star-intensity': 0
				});
			});

			map.on('dragstart', () => {
			});
			map.on('pitchstart', () => {
			});
			map.on('rotate', () => {
			});

			await syncMarkers();
			await fitToData(mapboxgl);
		} catch {
			mapFailed = true;
			destroyMap();
		}
	};

	onDestroy(() => {
		destroyMap();
	});

	$effect(() => {
		void accessToken;
		void container;
		if (!accessToken || !container) return;
		void initializeMap();
	});

	$effect(() => {
		void clubs;
		void userCoordinates;
		if (!map) return;
		void syncMarkers();
	});

	$effect(() => {
		void clubs;
		void userCoordinates;
		void selectedClubId;
		if (!map || selectedClubId) return;

		let cancelled = false;
		void import('mapbox-gl').then((mapboxglModule) => {
			if (cancelled) return;
			void fitToData(mapboxglModule.default);
		});

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		void selectedClubId;
		if (map) {
			void syncMarkers();
		}
		if (selectedClubId) {
			flyToClub(selectedClubId);
		}
	});
</script>

{#if mapFailed}
	<div class="rounded-3xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
		The club map could not be loaded right now.
	</div>
{:else}
	<div
		bind:this={container}
		class={`h-full w-full overflow-hidden rounded-[2.75rem] border border-orange-200 bg-[#FFD7BB] shadow-[0_22px_50px_rgba(243,115,53,0.16)] ${className}`}
		role="img"
		aria-label="Rotating globe map of public clubs"
	></div>
{/if}

<style>
	:global(.mapboxgl-map),
	:global(.mapboxgl-canvas-container),
	:global(.mapboxgl-canvas) {
		background: #ffd7bb !important;
	}
</style>
