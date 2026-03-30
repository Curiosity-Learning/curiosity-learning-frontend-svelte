import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { createCloudFrontSignedUrl, getMediaDeliveryTtlSeconds } from './media-delivery';

const { privateKey } = generateKeyPairSync('rsa', {
	modulusLength: 1024
});

const config = {
	baseUrl: 'https://assets.example.org',
	publicKeyId: 'K1234567890',
	privateKey: privateKey.export({ format: 'pem', type: 'pkcs1' }).toString(),
	imageUrlTtlSeconds: 300,
	videoMinUrlTtlSeconds: 7200
};

describe('media delivery helpers', () => {
	it('uses the short image TTL by default', () => {
		expect(
			getMediaDeliveryTtlSeconds(config, {
				mediaKind: 'image',
				contentType: 'image/png',
				durationSeconds: null
			})
		).toBe(300);
	});

	it('uses the greater of the video minimum or 3x duration for videos', () => {
		expect(
			getMediaDeliveryTtlSeconds(config, {
				mediaKind: 'video',
				contentType: 'video/mp4',
				durationSeconds: 800
			})
		).toBe(7200);

		expect(
			getMediaDeliveryTtlSeconds(config, {
				mediaKind: 'video',
				contentType: 'video/mp4',
				durationSeconds: 3000
			})
		).toBe(9000);
	});

	it('creates a signed CloudFront URL for a single object', () => {
		const delivery = createCloudFrontSignedUrl(config, {
			objectKey: 'production/media-assets/owners/user/assets/asset/raw/r1/example.png',
			mediaKind: 'image',
			contentType: 'image/png'
		});

		const url = new URL(delivery.signedUrl);
		expect(url.origin).toBe('https://assets.example.org');
		expect(url.pathname).toBe(
			'/production/media-assets/owners/user/assets/asset/raw/r1/example.png'
		);
		expect(url.searchParams.get('Key-Pair-Id')).toBe('K1234567890');
		expect(url.searchParams.get('Policy')).toBeTruthy();
		expect(url.searchParams.get('Signature')).toBeTruthy();
		expect(delivery.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
	});
});
