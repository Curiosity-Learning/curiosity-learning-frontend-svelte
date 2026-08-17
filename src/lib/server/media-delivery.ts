import { env } from '$env/dynamic/private';
import { loadCloudFrontConfigFromEnvRecord } from './cloudfront-sign';

// The CloudFront signing core lives in cloudfront-sign.ts (shared with the Convex node action
// clubApplicationsNode.ts, which loads the same config from the Convex deployment's process.env).
// This module only binds it to SvelteKit's dynamic private env, and re-exports the core so
// existing imports (signed-media.ts, specs) keep working.
export {
	buildMediaCdnUrl,
	createCloudFrontSignedUrl,
	getMediaDeliveryTtlSeconds,
	type MediaDeliveryConfig,
	type MediaDeliveryDescriptor
} from './cloudfront-sign';

export const loadMediaDeliveryConfigOrNull = () => loadCloudFrontConfigFromEnvRecord(env);
