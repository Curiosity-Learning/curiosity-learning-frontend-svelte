<script lang="ts">
	// The applicant's intro video, shared by the application chat, the review list, and the
	// application detail page (CL-710 CEO review item 2: it's one of the most important parts of an
	// application, so every surface that shows an application shows the video the same way).
	//
	// CL-710 CEO review round 3 (Braga bug): `fallbackUrl` is a direct storage URL that 403s once
	// secure media delivery (CloudFront) is configured, because the bucket is then private. Prefer a
	// signed delivery URL fetched via /api/media/refresh (server-side gated on the application id),
	// falling back to the direct URL (works in local dev, where the bucket is public) if signing
	// isn't available. Nothing renders until the signing request settles, so the browser never
	// wastes a request (and an error state) on the direct URL in CDN-enabled environments.
	// Playback failure is tracked PER URL: the direct URL may fail before the signed URL arrives,
	// and a boolean flag would keep the player hidden after the good URL lands.
	import { requestSignedMediaUrls } from '$lib/media/signed-media.svelte';
	import { cn } from '$lib/utils.js';

	type Props = {
		applicationId: string;
		videoMediaAssetId?: string | null;
		/** Direct storage URL (local dev fallback). */
		fallbackUrl: string | null;
		/** Label above the player; omit to render the player alone. */
		label?: string | null;
		/** Shown when there is no playable video; omit to render nothing in that case. */
		emptyText?: string | null;
		class?: string;
		videoClass?: string;
	};

	let {
		applicationId,
		videoMediaAssetId = null,
		fallbackUrl,
		label = null,
		emptyText = null,
		class: className,
		videoClass = 'h-44 w-full object-cover sm:h-52'
	}: Props = $props();

	let signedUrl = $state<string | null>(null);
	let requestSettled = $state(false);
	let requestKey = $state<string | null>(null);
	let failedUrl = $state<string | null>(null);

	$effect(() => {
		const assetId = videoMediaAssetId;
		const currentApplicationId = applicationId;
		if (!assetId) {
			signedUrl = null;
			requestKey = null;
			requestSettled = true;
			return;
		}

		const nextKey = `${currentApplicationId}:${assetId}`;
		if (requestKey === nextKey) {
			return;
		}
		requestKey = nextKey;
		requestSettled = false;

		void (async () => {
			try {
				const assets = await requestSignedMediaUrls({
					assetIds: [assetId],
					context: { kind: 'club-application', applicationId: currentApplicationId }
				});
				if (requestKey !== nextKey) return;
				signedUrl = assets[0]?.signedUrl ?? null;
			} catch {
				// Secure media delivery isn't configured (local dev) or the request failed — fall back
				// to the direct URL rather than surfacing an error for a nice-to-have.
				if (requestKey !== nextKey) return;
				signedUrl = null;
			} finally {
				if (requestKey === nextKey) {
					requestSettled = true;
				}
			}
		})();
	});

	let videoUrl = $derived(requestSettled ? (signedUrl ?? fallbackUrl ?? null) : null);
	let playable = $derived(Boolean(videoUrl) && failedUrl !== videoUrl);
</script>

{#if playable || emptyText}
	<div class={cn('flex flex-col gap-2', className)}>
		{#if label}
			<p class="type-sm text-muted-foreground">{label}</p>
		{/if}
		{#if playable && videoUrl}
			<div class="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-900">
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					src={videoUrl}
					controls
					preload="metadata"
					class={videoClass}
					onerror={() => {
						failedUrl = videoUrl;
					}}
				></video>
			</div>
		{:else if emptyText}
			<p class="type-sm text-muted-foreground">{emptyText}</p>
		{/if}
	</div>
{/if}
