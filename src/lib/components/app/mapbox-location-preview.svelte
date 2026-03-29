<script lang="ts">
	import { browser } from '$app/environment';
	import { onDestroy } from 'svelte';
	import { MAPBOX_STYLE_URL, type MapboxCoordinates } from '$lib/maps/mapbox';
	import { cn } from '$lib/utils';
	import 'mapbox-gl/dist/mapbox-gl.css';

	type Props = {
		accessToken: string;
		coordinates: MapboxCoordinates | null;
		label?: string;
		styleUrl?: string;
		class?: string;
	};

	let {
		accessToken,
		coordinates,
		label = 'Selected location',
		styleUrl = MAPBOX_STYLE_URL,
		class: className
	}: Props = $props();

	let container = $state<HTMLDivElement | null>(null);
	let map = $state<import('mapbox-gl').Map | null>(null);
	let marker = $state<import('mapbox-gl').Marker | null>(null);
	let mapFailed = $state(false);

	const destroyMap = () => {
		marker?.remove();
		marker = null;
		map?.remove();
		map = null;
	};

	const initializeMap = async () => {
		if (!browser || !container || !coordinates || !accessToken || map || mapFailed) return;

		try {
			const mapboxglModule = await import('mapbox-gl');
			const mapboxgl = mapboxglModule.default;
			mapboxgl.accessToken = accessToken;

			map = new mapboxgl.Map({
				container,
				style: styleUrl,
				center: [coordinates.longitude, coordinates.latitude],
				zoom: 10.5,
				attributionControl: true
			});
			map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

			marker = new mapboxgl.Marker({
				color: '#f97316'
			})
				.setLngLat([coordinates.longitude, coordinates.latitude])
				.addTo(map);
		} catch {
			mapFailed = true;
			destroyMap();
		}
	};

	onDestroy(() => {
		destroyMap();
	});

	$effect(() => {
		if (!browser) return;

		if (!accessToken || !coordinates || !container) {
			destroyMap();
			return;
		}

		if (!map) {
			void initializeMap();
			return;
		}

		marker?.setLngLat([coordinates.longitude, coordinates.latitude]);
		map.easeTo({
			center: [coordinates.longitude, coordinates.latitude],
			zoom: Math.max(map.getZoom(), 10.5),
			duration: 700
		});
	});
</script>

<div class={cn('flex flex-col gap-2', className)}>
	<div class="flex items-center justify-between gap-3">
		<p class="text-sm leading-6 font-medium text-gray-900">Map preview</p>
		<p class="truncate text-xs text-gray-500">{label}</p>
	</div>

	{#if mapFailed}
		<div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
			The map preview could not be loaded right now.
		</div>
	{:else}
		<div
			bind:this={container}
			class="h-56 w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-sm"
			role="img"
			aria-label={`Map preview for ${label}`}
		></div>
	{/if}
</div>
