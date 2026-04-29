import type { DropdownOption } from '$lib/components/app/form';

export const MAPBOX_STYLE_URL = 'mapbox://styles/ronberlinski/cmnb0lhyb004801sjb11783r0';
export const MAPBOX_GEOCODING_LIMIT = 6;

export type MapboxCoordinates = {
	longitude: number;
	latitude: number;
};

export type MapboxLocationOption = DropdownOption & MapboxCoordinates;

type MapboxFeature = {
	properties?: {
		name?: string;
		full_address?: string;
		place_formatted?: string;
		coordinates?: {
			longitude?: number;
			latitude?: number;
		};
	};
	geometry?: {
		coordinates?: [number, number];
	};
};

type MapboxForwardResponse = {
	features?: MapboxFeature[];
};

const normalizeLabel = (feature: MapboxFeature) => {
	const properties = feature.properties ?? {};
	const fullAddress = properties.full_address?.trim();
	if (fullAddress) return fullAddress;

	const parts = [properties.name, properties.place_formatted]
		.map((part) => part?.trim())
		.filter((part): part is string => Boolean(part));

	if (parts.length === 0) return null;

	const deduped = parts.filter(
		(part, index) => parts.findIndex((value) => value.toLowerCase() === part.toLowerCase()) === index
	);
	return deduped.join(', ');
};

const resolveCoordinates = (feature: MapboxFeature): MapboxCoordinates | null => {
	const coords = feature.properties?.coordinates;
	if (
		typeof coords?.longitude === 'number' &&
		Number.isFinite(coords.longitude) &&
		typeof coords.latitude === 'number' &&
		Number.isFinite(coords.latitude)
	) {
		return {
			longitude: coords.longitude,
			latitude: coords.latitude
		};
	}

	const geometryCoordinates = feature.geometry?.coordinates;
	if (
		Array.isArray(geometryCoordinates) &&
		geometryCoordinates.length >= 2 &&
		Number.isFinite(geometryCoordinates[0]) &&
		Number.isFinite(geometryCoordinates[1])
	) {
		return {
			longitude: geometryCoordinates[0],
			latitude: geometryCoordinates[1]
		};
	}

	return null;
};

const parseForwardResponse = (payload: MapboxForwardResponse): MapboxLocationOption[] => {
	const seen = new Set<string>();
	const features = Array.isArray(payload.features) ? payload.features : [];
	const options: MapboxLocationOption[] = [];

	for (const feature of features) {
		const label = normalizeLabel(feature);
		const coordinates = resolveCoordinates(feature);
		if (!label || !coordinates) continue;
		const key = label.trim().toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		options.push({
			label,
			value: label,
			longitude: coordinates.longitude,
			latitude: coordinates.latitude
		});
		if (options.length >= MAPBOX_GEOCODING_LIMIT) break;
	}

	return options;
};

export const fetchMapboxLocationSuggestions = async (args: {
	query: string;
	accessToken: string;
	signal?: AbortSignal;
	language?: string;
	limit?: number;
}) => {
	const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
	url.searchParams.set('q', args.query);
	url.searchParams.set('access_token', args.accessToken);
	url.searchParams.set('autocomplete', 'true');
	url.searchParams.set('limit', String(args.limit ?? MAPBOX_GEOCODING_LIMIT));
	url.searchParams.set(
		'types',
		'country,region,postcode,district,place,locality,neighborhood,address'
	);
	if (args.language) {
		url.searchParams.set('language', args.language);
	}

	const response = await fetch(url.toString(), {
		signal: args.signal
	});
	if (!response.ok) {
		throw new Error('Unable to fetch location suggestions');
	}

	const payload = (await response.json()) as MapboxForwardResponse;
	return parseForwardResponse(payload);
};

export const fetchMapboxLocationFromCoordinates = async (args: {
	coordinates: MapboxCoordinates;
	accessToken: string;
	signal?: AbortSignal;
	language?: string;
}) => {
	const url = new URL('https://api.mapbox.com/search/geocode/v6/reverse');
	url.searchParams.set('longitude', String(args.coordinates.longitude));
	url.searchParams.set('latitude', String(args.coordinates.latitude));
	url.searchParams.set('access_token', args.accessToken);
	url.searchParams.set('limit', '1');
	url.searchParams.set(
		'types',
		'country,region,postcode,district,place,locality,neighborhood,address'
	);
	if (args.language) {
		url.searchParams.set('language', args.language);
	}

	const response = await fetch(url.toString(), {
		signal: args.signal
	});
	if (!response.ok) {
		throw new Error('Unable to resolve current location');
	}

	const payload = (await response.json()) as MapboxForwardResponse;
	return parseForwardResponse(payload)[0] ?? null;
};
