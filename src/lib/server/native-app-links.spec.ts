import { describe, expect, it } from 'vitest';
import { androidAssetLinks, appleAppSiteAssociation } from './native-app-links';

describe('native app link files (CL-819)', () => {
	it('serves nothing until configured', () => {
		expect(appleAppSiteAssociation(undefined)).toBeNull();
		expect(appleAppSiteAssociation(' , ')).toBeNull();
		expect(androidAssetLinks('')).toBeNull();
	});

	it('scopes the iOS association to the sign-in link and /app/ paths', () => {
		expect(appleAppSiteAssociation('TEAM123.org.curiositylearning.spike')).toEqual({
			applinks: {
				details: [
					{
						appIDs: ['TEAM123.org.curiositylearning.spike'],
						components: [{ '/': '/auth/link' }, { '/': '/app/*' }]
					}
				]
			}
		});
	});

	it('lists every Android signing fingerprint for the spike package', () => {
		const links = androidAssetLinks('aa:bb, CC:DD');
		expect(links?.[0]?.target).toEqual({
			namespace: 'android_app',
			package_name: 'org.curiositylearning.spike',
			sha256_cert_fingerprints: ['AA:BB', 'CC:DD']
		});
	});
});
