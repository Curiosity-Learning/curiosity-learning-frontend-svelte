const DEFAULT_UPLOAD_URL_TTL_SECONDS = 900;
const DEFAULT_OBJECT_PREFIX = 'media-assets';
const S3_PROVIDER = 's3';

export type MediaStorageProvider = typeof S3_PROVIDER;

export type MediaUploadDescriptor = {
	provider: MediaStorageProvider;
	method: 'PUT' | 'POST';
	url: string;
	headers?: Record<string, string>;
	fields?: Record<string, string>;
	objectKey: string;
	uploadToken?: string;
};

export type MediaStorageConfig = {
	provider: MediaStorageProvider;
	region: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	endpoint?: string;
	publicBaseUrl?: string;
	forcePathStyle: boolean;
	uploadUrlTtlSeconds: number;
	envPrefix: string;
	objectPrefix: string;
};

type ResolvableAsset = {
	status: string;
	storageProvider?: string | null;
	sourceBucket?: string | null;
	sourceObjectKey?: string | null;
	processedBucket?: string | null;
	processedObjectKey?: string | null;
};

const trimToUndefined = (value?: string | null) => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
};

const requireEnv = (name: string) => {
	const value = trimToUndefined(process.env[name]);
	if (!value) {
		throw new Error(`${name} is not set (Convex environment variable).`);
	}
	return value;
};

const parseBooleanEnv = (value?: string | null) => {
	const normalized = value?.trim().toLowerCase();
	return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const parsePositiveIntegerEnv = (value: string | undefined, fallback: number) => {
	if (!value) {
		return fallback;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const sanitizeSegment = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80) || 'unknown';

const sanitizeFilename = (value?: string | null) => {
	const trimmed = value?.trim();
	if (!trimmed) {
		return 'upload.bin';
	}

	const normalized = trimmed.replace(/[\\/]+/g, '-');
	const lastDot = normalized.lastIndexOf('.');
	const rawBaseName = lastDot > 0 ? normalized.slice(0, lastDot) : normalized;
	const rawExtension = lastDot > 0 ? normalized.slice(lastDot + 1) : '';

	const baseName =
		rawBaseName
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 80) || 'upload';
	const extension = rawExtension
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '')
		.slice(0, 12);

	return extension ? `${baseName}.${extension}` : `${baseName}.bin`;
};

const encodeObjectKey = (objectKey: string) =>
	objectKey
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/');

export const loadMediaStorageConfig = (): MediaStorageConfig => ({
	provider: S3_PROVIDER,
	region: requireEnv('MEDIA_S3_REGION'),
	bucket: requireEnv('MEDIA_S3_BUCKET'),
	accessKeyId: requireEnv('MEDIA_S3_ACCESS_KEY_ID'),
	secretAccessKey: requireEnv('MEDIA_S3_SECRET_ACCESS_KEY'),
	endpoint: trimToUndefined(process.env.MEDIA_S3_ENDPOINT),
	publicBaseUrl: trimToUndefined(process.env.MEDIA_S3_PUBLIC_BASE_URL),
	forcePathStyle: parseBooleanEnv(process.env.MEDIA_S3_FORCE_PATH_STYLE),
	uploadUrlTtlSeconds: parsePositiveIntegerEnv(
		trimToUndefined(process.env.MEDIA_S3_UPLOAD_URL_TTL_SECONDS),
		DEFAULT_UPLOAD_URL_TTL_SECONDS
	),
	envPrefix:
		trimToUndefined(process.env.MEDIA_S3_ENV_PREFIX) ??
		trimToUndefined(process.env.CONVEX_DEPLOYMENT) ??
		trimToUndefined(process.env.NODE_ENV) ??
		'dev',
	objectPrefix: trimToUndefined(process.env.MEDIA_S3_OBJECT_PREFIX) ?? DEFAULT_OBJECT_PREFIX
});

export const loadMediaStorageConfigOrNull = () => {
	try {
		return loadMediaStorageConfig();
	} catch {
		return null;
	}
};

export const buildMediaObjectKey = ({
	envPrefix,
	objectPrefix,
	ownerUserId,
	assetId,
	revision,
	originalFilename
}: {
	envPrefix: string;
	objectPrefix: string;
	ownerUserId: string;
	assetId: string;
	revision: number;
	originalFilename?: string | null;
}) =>
	[
		sanitizeSegment(envPrefix),
		sanitizeSegment(objectPrefix),
		'owners',
		sanitizeSegment(ownerUserId),
		'assets',
		assetId,
		'raw',
		`r${revision}`,
		sanitizeFilename(originalFilename)
	].join('/');

export const resolveMediaObjectUrl = ({
	bucket,
	objectKey,
	config
}: {
	bucket: string;
	objectKey: string;
	config: Pick<MediaStorageConfig, 'endpoint' | 'forcePathStyle' | 'publicBaseUrl' | 'region'>;
}) => {
	const encodedObjectKey = encodeObjectKey(objectKey);
	if (config.publicBaseUrl) {
		const base = config.publicBaseUrl.endsWith('/')
			? config.publicBaseUrl
			: `${config.publicBaseUrl}/`;
		return new URL(encodedObjectKey, base).toString();
	}

	if (config.endpoint) {
		const base = config.endpoint.endsWith('/') ? config.endpoint : `${config.endpoint}/`;
		if (config.forcePathStyle) {
			return new URL(`${encodeURIComponent(bucket)}/${encodedObjectKey}`, base).toString();
		}
		return new URL(encodedObjectKey, `${base.replace('://', `://${bucket}.`)}`).toString();
	}

	return `https://${bucket}.s3.${config.region}.amazonaws.com/${encodedObjectKey}`;
};

export const resolveMediaAssetFileUrl = (asset: ResolvableAsset) => {
	if (asset.status !== 'ready' || asset.storageProvider !== S3_PROVIDER) {
		return null;
	}

	const bucket = asset.processedBucket ?? asset.sourceBucket ?? null;
	const objectKey = asset.processedObjectKey ?? asset.sourceObjectKey ?? null;
	if (!bucket || !objectKey) {
		return null;
	}

	const config = loadMediaStorageConfigOrNull();
	if (!config) {
		return null;
	}

	return resolveMediaObjectUrl({
		bucket,
		objectKey,
		config
	});
};

export const mediaStorageProviderValidatorLiteral = S3_PROVIDER;
