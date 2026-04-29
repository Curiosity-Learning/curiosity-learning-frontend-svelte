<script lang="ts">
	import { browser } from '$app/environment';
	import { onDestroy, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { DropdownField } from '$lib/components/app/form';
	import MapboxLocationPreview from '$lib/components/app/mapbox-location-preview.svelte';
	import {
		MAPBOX_GEOCODING_LIMIT,
		fetchMapboxLocationSuggestions,
		type MapboxCoordinates,
		type MapboxLocationOption
	} from '$lib/maps/mapbox';

	type DefaultLocation = {
		label: string;
		coordinates: MapboxCoordinates | null;
	};

	type Props = {
		id: string;
		value?: string;
		coordinates?: MapboxCoordinates | null;
		defaultLocation?: DefaultLocation | null;
		accessToken?: string;
		label?: string;
		placeholder?: string;
		required?: boolean;
		hint?: string;
		emptyMessage?: string;
		lookupFailureMessage?: string;
		minChars?: number;
		debounceMs?: number;
		language?: string;
		showPreview?: boolean;
		previewStyleUrl?: string;
		class?: string;
	};

	let {
		id,
		value = $bindable(''),
		coordinates = $bindable<MapboxCoordinates | null>(null),
		defaultLocation = null,
		accessToken = '',
		label,
		placeholder,
		required = false,
		hint,
		emptyMessage = 'No locations found.',
		lookupFailureMessage = 'Unable to fetch location suggestions.',
		minChars = 2,
		debounceMs = 280,
		language,
		showPreview = false,
		previewStyleUrl,
		class: className
	}: Props = $props();

	let suggestions = $state<MapboxLocationOption[]>([]);
	let lookupPending = $state(false);
	let lookupError = $state('');
	let lookupTimer: ReturnType<typeof setTimeout> | null = null;
	let lookupAbortController: AbortController | null = null;
	let defaultLocationAbortController: AbortController | null = null;
	let lookupVersion = 0;
	let lastResolvedLocation = '';
	let defaultLocationApplied = false;
	let defaultLocationPending = $state(false);
	const rememberedCoordinates = new SvelteMap<string, MapboxCoordinates>();

	const normalizeLocation = (input: string) => input.trim().toLowerCase();
	const sameCoordinates = (a: MapboxCoordinates | null, b: MapboxCoordinates | null) =>
		a?.longitude === b?.longitude && a?.latitude === b?.latitude;

	const clearLookupResources = () => {
		if (lookupTimer) {
			clearTimeout(lookupTimer);
			lookupTimer = null;
		}
		if (lookupAbortController) {
			lookupAbortController.abort();
			lookupAbortController = null;
		}
	};

	const clearDefaultLocationResources = () => {
		if (defaultLocationAbortController) {
			defaultLocationAbortController.abort();
			defaultLocationAbortController = null;
		}
	};

	onDestroy(() => {
		clearLookupResources();
		clearDefaultLocationResources();
	});

	const resolveSelectedOption = (option: { value: string }) => {
		const match = suggestions.find((suggestion) => suggestion.value === option.value);
		if (!match) return;
		const selectedCoordinates = {
			longitude: match.longitude,
			latitude: match.latitude
		};
		const normalizedLocation = normalizeLocation(match.value);
		rememberedCoordinates.set(normalizedLocation, selectedCoordinates);
		coordinates = selectedCoordinates;
		lastResolvedLocation = normalizedLocation;
		suggestions = [];
		lookupPending = false;
		lookupError = '';
		clearLookupResources();
	};

	$effect(() => {
		const query = value.trim();
		const normalizedQuery = normalizeLocation(query);
		clearLookupResources();
		lookupError = '';

		if (defaultLocationPending) {
			suggestions = [];
			lookupPending = false;
			return;
		}

		if (query.length < minChars) {
			suggestions = [];
			lookupPending = false;
			return;
		}

		if (untrack(() => rememberedCoordinates.has(normalizedQuery))) {
			suggestions = [];
			lookupPending = false;
			return;
		}

		const nextVersion = ++lookupVersion;
		lookupPending = true;
		lookupTimer = setTimeout(async () => {
			if (!accessToken) {
				if (nextVersion === lookupVersion) {
					suggestions = [];
					lookupPending = false;
				}
				return;
			}

			const controller = new AbortController();
			lookupAbortController = controller;

			try {
				const payload = await fetchMapboxLocationSuggestions({
					query,
					accessToken,
					signal: controller.signal,
					language: language ?? (browser ? (navigator.language.split('-')[0] ?? 'en') : 'en'),
					limit: MAPBOX_GEOCODING_LIMIT
				});
				if (nextVersion !== lookupVersion) return;
				suggestions = payload;
				lookupError = '';
				for (const suggestion of payload) {
					rememberedCoordinates.set(normalizeLocation(suggestion.value), {
						longitude: suggestion.longitude,
						latitude: suggestion.latitude
					});
				}
			} catch (error) {
				if (nextVersion !== lookupVersion) return;
				if (error instanceof DOMException && error.name === 'AbortError') return;
				suggestions = [];
				lookupError = lookupFailureMessage;
			} finally {
				if (nextVersion === lookupVersion) {
					lookupPending = false;
				}
			}
		}, debounceMs);
	});

	$effect(() => {
		if (defaultLocationApplied) return;
		const label = defaultLocation?.label?.trim() ?? '';
		if (!label || value.trim()) return;

		defaultLocationApplied = true;
		clearLookupResources();
		clearDefaultLocationResources();
		lookupError = '';
		suggestions = [];
		value = label;

		if (defaultLocation?.coordinates) {
			rememberedCoordinates.set(normalizeLocation(label), defaultLocation.coordinates);
			coordinates = defaultLocation.coordinates;
			lastResolvedLocation = normalizeLocation(label);
			return;
		}

		if (!accessToken || !browser) return;

		defaultLocationPending = true;
		const controller = new AbortController();
		defaultLocationAbortController = controller;

		fetchMapboxLocationSuggestions({
			query: label,
			accessToken,
			signal: controller.signal,
			language: language ?? (navigator.language.split('-')[0] ?? 'en'),
			limit: 1
		})
			.then((payload) => {
				if (controller.signal.aborted) return;
				const match = payload[0];
				if (!match) return;
				const nextCoordinates = {
					longitude: match.longitude,
					latitude: match.latitude
				};
				const normalizedLocation = normalizeLocation(match.value);
				rememberedCoordinates.set(normalizedLocation, nextCoordinates);
				value = match.label;
				coordinates = nextCoordinates;
				lastResolvedLocation = normalizedLocation;
				suggestions = [];
			})
			.catch((error) => {
				if (error instanceof DOMException && error.name === 'AbortError') return;
			})
			.finally(() => {
				if (defaultLocationAbortController === controller) {
					defaultLocationAbortController = null;
				}
				if (!controller.signal.aborted) {
					defaultLocationPending = false;
				}
			});
	});

	$effect(() => {
		const normalizedLocation = normalizeLocation(value);
		if (!normalizedLocation) {
			coordinates = null;
			lastResolvedLocation = '';
			return;
		}

		if (coordinates && !lastResolvedLocation) {
			rememberedCoordinates.set(normalizedLocation, coordinates);
			lastResolvedLocation = normalizedLocation;
			return;
		}

		const remembered = untrack(() => rememberedCoordinates.get(normalizedLocation));
		if (remembered) {
			if (!sameCoordinates(coordinates, remembered)) {
				coordinates = remembered;
			}
			lastResolvedLocation = normalizedLocation;
			return;
		}

		if (coordinates) {
			coordinates = null;
		}
		lastResolvedLocation = '';
	});
</script>

<div class="flex flex-col gap-3">
	<DropdownField
		{id}
		{label}
		{required}
		bind:value
		options={suggestions.map(({ label, value }) => ({ label, value }))}
		loading={lookupPending || defaultLocationPending}
		showInputLoading={false}
		{placeholder}
		filterOptions={false}
		emptyMessage={!lookupPending && value.trim().length >= minChars ? emptyMessage : ''}
		{hint}
		class={className}
		onSelectOption={resolveSelectedOption}
	/>

	{#if lookupError}
		<p class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
			{lookupError}
		</p>
	{/if}

	{#if showPreview && accessToken && coordinates && previewStyleUrl}
		<MapboxLocationPreview
			{accessToken}
			{coordinates}
			label={value.trim()}
			styleUrl={previewStyleUrl}
		/>
	{/if}
</div>
