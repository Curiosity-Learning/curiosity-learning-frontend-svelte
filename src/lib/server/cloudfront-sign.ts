import { createSign } from 'node:crypto';

// Runtime-agnostic CloudFront signed-URL core, extracted from media-delivery.ts so the Convex
// node action (src/convex/clubApplicationsNode.ts) and the SvelteKit refresh route share one
// signing implementation. Nothing here may read environment directly — config comes in via
// loadCloudFrontConfigFromEnvRecord so each runtime supplies its own env source ($env/dynamic
// in SvelteKit, process.env in Convex node actions).

const DEFAULT_IMAGE_URL_TTL_SECONDS = 300;
const DEFAULT_VIDEO_MIN_URL_TTL_SECONDS = 7200;

export type MediaDeliveryConfig = {
	baseUrl: string;
	publicKeyId: string;
	privateKey: string;
	imageUrlTtlSeconds: number;
	videoMinUrlTtlSeconds: number;
};

export type MediaDeliveryDescriptor = {
	signedUrl: string;
	expiresAt: number;
	ttlSeconds: number;
};

export type SignedAssetInput = {
	objectKey: string;
	mediaKind?: string | null;
	contentType?: string | null;
	durationSeconds?: number | null;
};

const trimToUndefined = (value?: string | null) => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
};

const parsePositiveInteger = (value?: string, fallback = DEFAULT_IMAGE_URL_TTL_SECONDS) => {
	if (!value) {
		return fallback;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toCloudFrontSafeBase64 = (value: string) =>
	Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~');

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

const buildPolicy = ({ resourceUrl, expiresAt }: { resourceUrl: string; expiresAt: number }) =>
	JSON.stringify({
		Statement: [
			{
				Resource: resourceUrl,
				Condition: {
					DateLessThan: {
						'AWS:EpochTime': expiresAt
					}
				}
			}
		]
	});

const inferMediaKind = ({
	mediaKind,
	contentType
}: Pick<SignedAssetInput, 'mediaKind' | 'contentType'>) => {
	if (mediaKind === 'image' || mediaKind === 'video') {
		return mediaKind;
	}

	if (contentType?.startsWith('image/')) {
		return 'image';
	}

	if (contentType?.startsWith('video/')) {
		return 'video';
	}

	return 'image';
};

// Builds the delivery config from a plain env record (SvelteKit's $env/dynamic/private or
// Convex's process.env). Returns null when secure delivery is not configured at all, and throws
// when it is only partially configured — a partial config always means a deployment mistake, and
// silently falling back to direct URLs there would 403 anyway.
export const loadCloudFrontConfigFromEnvRecord = (
	env: Record<string, string | undefined>
): MediaDeliveryConfig | null => {
	const baseUrl = trimToUndefined(env.MEDIA_CDN_BASE_URL);
	const publicKeyId = trimToUndefined(env.MEDIA_CLOUDFRONT_PUBLIC_KEY_ID);
	const privateKey = trimToUndefined(env.MEDIA_CLOUDFRONT_PRIVATE_KEY);

	if (!baseUrl && !publicKeyId && !privateKey) {
		return null;
	}

	if (!baseUrl || !publicKeyId || !privateKey) {
		throw new Error(
			'Secure media delivery is partially configured. MEDIA_CDN_BASE_URL, MEDIA_CLOUDFRONT_PUBLIC_KEY_ID, and MEDIA_CLOUDFRONT_PRIVATE_KEY must be set together.'
		);
	}

	return {
		baseUrl: normalizeBaseUrl(baseUrl),
		publicKeyId,
		privateKey: normalizePrivateKey(privateKey),
		imageUrlTtlSeconds: parsePositiveInteger(
			trimToUndefined(env.MEDIA_CLOUDFRONT_IMAGE_URL_TTL_SECONDS),
			DEFAULT_IMAGE_URL_TTL_SECONDS
		),
		videoMinUrlTtlSeconds: parsePositiveInteger(
			trimToUndefined(env.MEDIA_CLOUDFRONT_VIDEO_MIN_URL_TTL_SECONDS),
			DEFAULT_VIDEO_MIN_URL_TTL_SECONDS
		)
	};
};

export const buildMediaCdnUrl = ({ baseUrl, objectKey }: { baseUrl: string; objectKey: string }) =>
	`${normalizeBaseUrl(baseUrl)}/${encodeObjectKey(objectKey)}`;

export const getMediaDeliveryTtlSeconds = (
	config: Pick<MediaDeliveryConfig, 'imageUrlTtlSeconds' | 'videoMinUrlTtlSeconds'>,
	asset: Pick<SignedAssetInput, 'mediaKind' | 'contentType' | 'durationSeconds'>
) => {
	const mediaKind = inferMediaKind(asset);
	if (mediaKind === 'video') {
		const durationTtl =
			typeof asset.durationSeconds === 'number' && asset.durationSeconds > 0
				? Math.ceil(asset.durationSeconds * 3)
				: 0;
		return Math.max(config.videoMinUrlTtlSeconds, durationTtl);
	}

	return config.imageUrlTtlSeconds;
};

export const createCloudFrontSignedUrl = (
	config: MediaDeliveryConfig,
	asset: SignedAssetInput
): MediaDeliveryDescriptor => {
	const resourceUrl = buildMediaCdnUrl({
		baseUrl: config.baseUrl,
		objectKey: asset.objectKey
	});
	const ttlSeconds = getMediaDeliveryTtlSeconds(config, asset);
	const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
	const policy = buildPolicy({
		resourceUrl,
		expiresAt
	});

	const url = new URL(resourceUrl);
	url.searchParams.set('Policy', toCloudFrontSafeBase64(policy));
	url.searchParams.set('Signature', signPolicy(policy, config.privateKey));
	url.searchParams.set('Key-Pair-Id', config.publicKeyId);

	return {
		signedUrl: url.toString(),
		expiresAt,
		ttlSeconds
	};
};
