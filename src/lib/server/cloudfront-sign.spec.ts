import { describe, expect, it } from 'vitest';
import { loadCloudFrontConfigFromEnvRecord } from './cloudfront-sign';

// The signing math itself (policy shape, TTLs, URL params) is covered by media-delivery.spec.ts
// via the re-exports; this spec covers the env-record loader shared between the SvelteKit refresh
// route and the Convex node action.
describe('loadCloudFrontConfigFromEnvRecord', () => {
	const fullEnv = {
		MEDIA_CDN_BASE_URL: 'https://assets.example.org/',
		MEDIA_CLOUDFRONT_PUBLIC_KEY_ID: 'K1234567890',
		MEDIA_CLOUDFRONT_PRIVATE_KEY: '-----BEGIN KEY-----\\nabc\\n-----END KEY-----'
	};

	it('returns null when secure delivery is not configured at all', () => {
		expect(loadCloudFrontConfigFromEnvRecord({})).toBeNull();
		expect(
			loadCloudFrontConfigFromEnvRecord({ MEDIA_CDN_BASE_URL: '  ', OTHER_VAR: 'x' })
		).toBeNull();
	});

	it('throws when only some of the three required vars are set', () => {
		expect(() =>
			loadCloudFrontConfigFromEnvRecord({ MEDIA_CDN_BASE_URL: 'https://assets.example.org' })
		).toThrow('partially configured');
		expect(() =>
			loadCloudFrontConfigFromEnvRecord({
				MEDIA_CDN_BASE_URL: 'https://assets.example.org',
				MEDIA_CLOUDFRONT_PUBLIC_KEY_ID: 'K1234567890'
			})
		).toThrow('partially configured');
	});

	it('normalizes the base URL, unescapes the private key, and applies TTL defaults', () => {
		const config = loadCloudFrontConfigFromEnvRecord(fullEnv);
		expect(config).toMatchObject({
			baseUrl: 'https://assets.example.org',
			publicKeyId: 'K1234567890',
			privateKey: '-----BEGIN KEY-----\nabc\n-----END KEY-----',
			imageUrlTtlSeconds: 300,
			videoMinUrlTtlSeconds: 7200
		});
	});

	it('honors TTL overrides and ignores invalid ones', () => {
		const config = loadCloudFrontConfigFromEnvRecord({
			...fullEnv,
			MEDIA_CLOUDFRONT_IMAGE_URL_TTL_SECONDS: '60',
			MEDIA_CLOUDFRONT_VIDEO_MIN_URL_TTL_SECONDS: 'not-a-number'
		});
		expect(config).toMatchObject({
			imageUrlTtlSeconds: 60,
			videoMinUrlTtlSeconds: 7200
		});
	});
});
