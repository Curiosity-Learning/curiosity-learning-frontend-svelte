import { createSign } from 'node:crypto';

const DEFAULT_COOKIE_TTL_SECONDS = 300;

type MediaDeliveryConfig = {
	baseUrl: string;
	publicKeyId: string;
	privateKey: string;
	cookieDomain: string;
	cookieTtlSeconds: number;
};

type CookieValue = {
	name: 'CloudFront-Policy' | 'CloudFront-Signature' | 'CloudFront-Key-Pair-Id';
	value: string;
};

const trimToUndefined = (value?: string | null) => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
};

const parsePositiveInteger = (value?: string, fallback = DEFAULT_COOKIE_TTL_SECONDS) => {
	if (!value) {
		return fallback;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toCloudFrontSafeBase64 = (value: string) =>
	Buffer.from(value)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/=/g, '_')
		.replace(/\//g, '~');

const signPolicy = (policy: string, privateKey: string) =>
	createSign('RSA-SHA1')
		.update(policy)
		.sign(privateKey, 'base64')
		.replace(/\+/g, '-')
		.replace(/=/g, '_')
		.replace(/\//g, '~');

const encodeObjectKey = (objectKey: string) =>
	objectKey
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/');

const normalizePrivateKey = (value: string) => value.replace(/\\n/g, '\n');

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

const buildResourcePattern = (baseUrl: string) => `${normalizeBaseUrl(baseUrl)}/*`;

const buildPolicy = ({ resourcePattern, expiresAt }: { resourcePattern: string; expiresAt: number }) =>
	JSON.stringify({
		Statement: [
			{
				Resource: resourcePattern,
				Condition: {
					DateLessThan: {
						'AWS:EpochTime': expiresAt
					}
				}
			}
		]
	});

export const loadMediaDeliveryConfigOrNull = (): MediaDeliveryConfig | null => {
	const baseUrl = trimToUndefined(process.env.MEDIA_CDN_BASE_URL);
	const publicKeyId = trimToUndefined(process.env.MEDIA_CLOUDFRONT_PUBLIC_KEY_ID);
	const privateKey = trimToUndefined(process.env.MEDIA_CLOUDFRONT_PRIVATE_KEY);
	const cookieDomain = trimToUndefined(process.env.MEDIA_CLOUDFRONT_COOKIE_DOMAIN);

	if (!baseUrl && !publicKeyId && !privateKey && !cookieDomain) {
		return null;
	}

	if (!baseUrl || !publicKeyId || !privateKey || !cookieDomain) {
		throw new Error(
			'Secure media delivery is partially configured. MEDIA_CDN_BASE_URL, MEDIA_CLOUDFRONT_PUBLIC_KEY_ID, MEDIA_CLOUDFRONT_PRIVATE_KEY, and MEDIA_CLOUDFRONT_COOKIE_DOMAIN must be set together.'
		);
	}

	return {
		baseUrl: normalizeBaseUrl(baseUrl),
		publicKeyId,
		privateKey: normalizePrivateKey(privateKey),
		cookieDomain,
		cookieTtlSeconds: parsePositiveInteger(
			trimToUndefined(process.env.MEDIA_CLOUDFRONT_COOKIE_TTL_SECONDS)
		)
	};
};

export const createCloudFrontSignedCookies = (config: MediaDeliveryConfig) => {
	const expiresAt = Math.floor(Date.now() / 1000) + config.cookieTtlSeconds;
	const policy = buildPolicy({
		resourcePattern: buildResourcePattern(config.baseUrl),
		expiresAt
	});

	const cookieValues: CookieValue[] = [
		{
			name: 'CloudFront-Policy',
			value: toCloudFrontSafeBase64(policy)
		},
		{
			name: 'CloudFront-Signature',
			value: signPolicy(policy, config.privateKey)
		},
		{
			name: 'CloudFront-Key-Pair-Id',
			value: config.publicKeyId
		}
	];

	return {
		expiresAt,
		cookieValues
	};
};

export const buildMediaCdnUrl = ({
	baseUrl,
	objectKey
}: {
	baseUrl: string;
	objectKey: string;
}) => `${normalizeBaseUrl(baseUrl)}/${encodeObjectKey(objectKey)}`;
