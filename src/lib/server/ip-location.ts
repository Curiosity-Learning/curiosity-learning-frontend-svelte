import type { MapboxCoordinates } from '$lib/maps/mapbox';

export type EstimatedIpLocation = {
	label: string;
	coordinates: MapboxCoordinates | null;
};

const firstHeader = (headers: Headers, names: string[]) => {
	for (const name of names) {
		const value = headers.get(name)?.trim();
		if (value) return value;
	}
	return '';
};

const decodeHeaderValue = (value: string) => {
	try {
		return decodeURIComponent(value.replace(/\+/g, ' ')).trim();
	} catch {
		return value.trim();
	}
};

const parseCoordinate = (value: string) => {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
};

const dedupeParts = (parts: string[]) => {
	const seen = new Set<string>();
	return parts.filter((part) => {
		const key = part.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};

export const getEstimatedIpLocation = (headers: Headers): EstimatedIpLocation | null => {
	const city = decodeHeaderValue(
		firstHeader(headers, ['x-vercel-ip-city', 'cf-ipcity', 'x-appengine-city', 'x-geo-city'])
	);
	const region = decodeHeaderValue(
		firstHeader(headers, [
			'x-vercel-ip-country-region',
			'cf-region',
			'x-appengine-region',
			'x-geo-region'
		])
	);
	const country = decodeHeaderValue(
		firstHeader(headers, ['x-vercel-ip-country', 'cf-ipcountry', 'x-appengine-country', 'x-geo-country'])
	);
	const latitude = parseCoordinate(
		firstHeader(headers, ['x-vercel-ip-latitude', 'x-geo-latitude'])
	);
	const longitude = parseCoordinate(
		firstHeader(headers, ['x-vercel-ip-longitude', 'x-geo-longitude'])
	);

	const label = dedupeParts([city, region, country].filter(Boolean)).join(', ');
	if (!label) return null;

	return {
		label,
		coordinates:
			latitude === null || longitude === null
				? null
				: {
						latitude,
						longitude
					}
	};
};
