<script lang="ts">
	import { PageHeaderBackButton, PageHeaderTitle } from '$lib/components/app';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import * as FileDropZone from '$lib/components/ui/file-drop-zone';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Switch } from '$lib/components/ui/switch';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Textarea } from '$lib/components/ui/textarea';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { requestSignedMediaUrls } from '$lib/media/signed-media.svelte';
	import {
		createMediaUploadManager,
		describeMediaUploadConstraints,
		mediaUploadPresets,
		type MediaUploadPreset
	} from '$lib/media/upload-manager.svelte';
	import { routes } from '$lib/routes';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { useConvexClient } from 'convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { onDestroy } from 'svelte';

	type UploadStatus = 'pending_upload' | 'processing' | 'ready' | 'failed' | 'canceled';
	type UploadFilter = 'all' | UploadStatus;

	type DeliveryPreview = {
		assetId: Id<'mediaAssets'>;
		signedUrl: string;
		contentType: string | null;
		mediaKind: string | null;
		expiresAt: number;
	};

	type DebugProbe = {
		label: string;
		at: string;
		payload: string;
	};

	const presetConfig = mediaUploadPresets;
	const convexClient = useConvexClient();
	const auth = useAuth();
	const uploadManager = createMediaUploadManager(convexClient, {
		maxRecentRuns: 10
	});

	const uploadsResponse = useStableQuery(api.media.listMyUploads, {});

	let filter = $state<UploadFilter>('all');
	let manualSelectedAssetId = $state<Id<'mediaAssets'> | null>(null);
	let autoFinalize = $state(true);
	let deleteStorageOnCancel = $state(true);
	let pageErrorMessage = $state('');
	let pageSuccessMessage = $state('');
	let deliveryPreviewAssetId = $state<Id<'mediaAssets'> | null>(null);
	let deliveryPreview = $state<DeliveryPreview | null>(null);
	let deliveryPreviewPending = $state(false);
	let deliveryPreviewError = $state('');
	let debugProbePending = $state<string | null>(null);
	let debugProbes = $state<DebugProbe[]>([]);

	let constraintForm = $state<{
		preset: MediaUploadPreset;
		acceptedContentTypes: string;
		maxBytesMb: number;
		enableCompression: boolean;
		enableSafetyScreening: boolean;
	}>({
		preset: 'mixed' as MediaUploadPreset,
		acceptedContentTypes: presetConfig.mixed.acceptedContentTypes.join(', '),
		maxBytesMb: presetConfig.mixed.maxBytesMb,
		enableCompression: true,
		enableSafetyScreening: false
	});

	const parseAcceptedContentTypes = (value: string) =>
		value
			.split(',')
			.map((entry) => entry.trim().toLowerCase())
			.filter(Boolean);

	const formatBytes = (bytes?: number | null) => {
		if (bytes === null || bytes === undefined || Number.isNaN(bytes)) {
			return 'Unknown';
		}

		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
	};

	const formatDateTime = (value?: number | null) => {
		if (!value) return 'Not recorded';
		return new Date(value).toLocaleString();
	};

	const formatSignedExpiry = (value?: number | null) =>
		value ? new Date(value * 1000).toLocaleString() : 'Not recorded';

	const formatDebugPayload = (value: unknown) => JSON.stringify(value, null, 2);

	const isDeliveryVideo = (preview: DeliveryPreview | null) =>
		Boolean(preview && (preview.mediaKind === 'video' || preview.contentType?.startsWith('video/')));

	const isDeliveryImage = (preview: DeliveryPreview | null) =>
		Boolean(preview && (preview.mediaKind === 'image' || preview.contentType?.startsWith('image/')));

	const supportsInlineDeliveryFrame = (preview: DeliveryPreview | null) => {
		const contentType = preview?.contentType?.toLowerCase() ?? '';
		return (
			contentType === 'application/pdf' ||
			contentType.startsWith('text/') ||
			contentType.endsWith('+json') ||
			contentType === 'application/json'
		);
	};

	const clearFeedback = () => {
		pageErrorMessage = '';
		pageSuccessMessage = '';
		uploadManager.clearFeedback();
	};

	const applyPreset = (preset: MediaUploadPreset) => {
		const config = presetConfig[preset];
		constraintForm.preset = preset;
		constraintForm.acceptedContentTypes = config.acceptedContentTypes.join(', ');
		constraintForm.maxBytesMb = config.maxBytesMb;
	};

	const currentAcceptedContentTypes = $derived(parseAcceptedContentTypes(constraintForm.acceptedContentTypes));

	const currentConstraints = $derived.by(() =>
		describeMediaUploadConstraints({
			acceptedContentTypes: currentAcceptedContentTypes,
			maxBytes: Math.max(1, Math.floor((Number(constraintForm.maxBytesMb) || 1) * 1024 * 1024)),
			enableCompression: constraintForm.enableCompression,
			enableSafetyScreening: constraintForm.enableSafetyScreening
		})
	);

	const uploadAccept = $derived(currentConstraints.accept);
	const maxBytesLabel = $derived(formatBytes(currentConstraints.maxBytes));
	const pending = $derived(uploadManager.isUploading);
	const errorMessage = $derived(pageErrorMessage || uploadManager.errorMessage);
	const successMessage = $derived(pageSuccessMessage || uploadManager.successMessage);
	const recentRuns = $derived(uploadManager.recentRuns);
	const uploads = $derived(uploadsResponse.data ?? []);
	const filteredUploads = $derived.by(() =>
		filter === 'all' ? uploads : uploads.filter((upload) => upload.status === filter)
	);
	const selectedAssetId = $derived.by(() => {
		if (
			manualSelectedAssetId &&
			uploads.some((upload) => upload.assetId === manualSelectedAssetId)
		) {
			return manualSelectedAssetId;
		}

		return filteredUploads[0]?.assetId ?? null;
	});
	const selectedAssetResponse = useStableQuery(api.media.getUpload, () =>
		selectedAssetId ? { assetId: selectedAssetId } : 'skip'
	);

	const uploadCounts = $derived.by(() => {
		const counts: Record<UploadFilter, number> = {
			all: uploads.length,
			pending_upload: 0,
			processing: 0,
			ready: 0,
			failed: 0,
			canceled: 0
		};

		for (const upload of uploads) {
			counts[upload.status] += 1;
		}

		return counts;
	});

	const selectedAsset = $derived(
		selectedAssetResponse.data ??
			(selectedAssetId ? uploads.find((upload) => upload.assetId === selectedAssetId) ?? null : null)
	);
	const selectedDeliveryPreview = $derived(
		selectedAsset && deliveryPreview?.assetId === selectedAsset.assetId ? deliveryPreview : null
	);
	const selectedDeliveryPreviewPending = $derived(
		Boolean(selectedAsset && deliveryPreviewAssetId === selectedAsset.assetId && deliveryPreviewPending)
	);
	const selectedDeliveryPreviewError = $derived(
		selectedAsset && deliveryPreviewAssetId === selectedAsset.assetId ? deliveryPreviewError : ''
	);
	const liveDebugState = $derived.by(() => ({
		auth: {
			isLoading: auth.isLoading,
			isAuthenticated: auth.isAuthenticated
		},
		page: {
			filter,
			pending,
			autoFinalize,
			selectedAssetId,
			manualSelectedAssetId
		},
		uploadManager: {
			recentRuns: recentRuns.length,
			lastUploadedAssetId: uploadManager.lastUploadedAssetId
		},
		uploadsQuery: {
			isLoading: uploadsResponse.isLoading,
			error: uploadsResponse.error?.message ?? null,
			count: uploads.length
		},
		selectedQuery: {
			isLoading: selectedAssetResponse.isLoading,
			error: selectedAssetResponse.error?.message ?? null,
			assetId: selectedAsset?.assetId ?? null,
			status: selectedAsset?.status ?? null
		},
		deliveryPreview: {
			pending: selectedDeliveryPreviewPending,
			error: selectedDeliveryPreviewError || null,
			assetId: selectedDeliveryPreview?.assetId ?? null,
			expiresAt: selectedDeliveryPreview?.expiresAt ?? null
		}
	}));

	const selectedAssetJson = $derived(selectedAsset ? JSON.stringify(selectedAsset, null, 2) : '');

	const pushDebugProbe = (label: string, payload: unknown) => {
		debugProbes = [
			{
				label,
				at: new Date().toLocaleString(),
				payload: formatDebugPayload(payload)
			},
			...debugProbes
		].slice(0, 8);
	};

	onDestroy(() => {
		uploadManager.destroy();
	});

	const beginAndUploadFiles = async (files: File[]) => {
		clearFeedback();
		await uploadManager.uploadFiles(files, {
			constraints: currentConstraints,
			autoFinalize,
			onAssetSelected: (assetId) => {
				manualSelectedAssetId = assetId;
			}
		});
	};

	const finalizeAsset = async (assetId: Id<'mediaAssets'>) => {
		clearFeedback();
		manualSelectedAssetId = assetId;
		await uploadManager.finalizeAsset(assetId);
	};

	const retryAsset = async (assetId: Id<'mediaAssets'>) => {
		clearFeedback();
		manualSelectedAssetId = assetId;
		await uploadManager.retryAsset(assetId);
	};

	const cancelAsset = async (assetId: Id<'mediaAssets'>) => {
		clearFeedback();
		manualSelectedAssetId = assetId;
		await uploadManager.cancelAsset(assetId, {
			deleteStorage: deleteStorageOnCancel
		});
	};

	const openSignedAsset = async (assetId: Id<'mediaAssets'>) => {
		clearFeedback();

		try {
			const assets = await requestSignedMediaUrls({
				assetIds: [assetId],
				context: {
					kind: 'owned'
				}
			});
			const asset = assets[0];
			if (!asset) {
				throw new Error('No signed URL is available for this asset yet.');
			}

			window.open(asset.signedUrl, '_blank', 'noopener,noreferrer');
		} catch (error) {
			pageErrorMessage = error instanceof Error ? error.message : 'Unable to open media asset.';
		}
	};

	const loadDeliveryPreview = async (assetId: Id<'mediaAssets'>) => {
		clearFeedback();
		deliveryPreviewAssetId = assetId;
		deliveryPreview = null;
		deliveryPreviewPending = true;
		deliveryPreviewError = '';

		try {
			const assets = await requestSignedMediaUrls({
				assetIds: [assetId],
				context: {
					kind: 'owned'
				}
			});
			const asset = assets[0];
			if (!asset) {
				throw new Error('No signed URL is available for this asset yet.');
			}

			deliveryPreview = {
				assetId,
				signedUrl: asset.signedUrl,
				contentType: asset.contentType,
				mediaKind: asset.mediaKind,
				expiresAt: asset.expiresAt
			};
		} catch (error) {
			deliveryPreview = null;
			deliveryPreviewError =
				error instanceof Error ? error.message : 'Unable to load embedded delivery preview.';
		} finally {
			deliveryPreviewPending = false;
		}
	};

	const probeUploadsSnapshot = async () => {
		debugProbePending = 'uploads';
		try {
			const snapshot = await convexClient.query(api.media.listMyUploads, {});
			pushDebugProbe('Uploads snapshot', {
				count: snapshot.length,
				uploads: snapshot.map((upload) => ({
					assetId: upload.assetId,
					status: upload.status,
					updatedAt: upload.updatedAt
				}))
			});
		} catch (error) {
			pushDebugProbe('Uploads snapshot error', {
				message: error instanceof Error ? error.message : 'Unknown error'
			});
		} finally {
			debugProbePending = null;
		}
	};

	const probeSelectedSnapshot = async () => {
		if (!selectedAssetId) return;
		debugProbePending = 'selected';
		try {
			const snapshot = await convexClient.query(api.media.getUpload, {
				assetId: selectedAssetId
			});
			pushDebugProbe('Selected asset snapshot', snapshot);
		} catch (error) {
			pushDebugProbe('Selected asset snapshot error', {
				assetId: selectedAssetId,
				message: error instanceof Error ? error.message : 'Unknown error'
			});
		} finally {
			debugProbePending = null;
		}
	};

	const probeDeliverySnapshot = async () => {
		if (!selectedAsset || selectedAsset.status !== 'ready') return;
		debugProbePending = 'delivery';
		try {
			const assets = await requestSignedMediaUrls({
				assetIds: [selectedAsset.assetId],
				context: {
					kind: 'owned'
				}
			});
			pushDebugProbe('Signed delivery snapshot', assets);
		} catch (error) {
			pushDebugProbe('Signed delivery snapshot error', {
				assetId: selectedAsset.assetId,
				message: error instanceof Error ? error.message : 'Unknown error'
			});
		} finally {
			debugProbePending = null;
		}
	};
</script>

<PageHeaderBackButton fallbackHref={routes.settings} />
<PageHeaderTitle title="Media Upload Test" />

<div class="flex flex-col gap-6 pb-8">
	{#if errorMessage}
		<Alert variant="destructive">
			<AlertTitle>Media test action failed</AlertTitle>
			<AlertDescription>{errorMessage}</AlertDescription>
		</Alert>
	{/if}

	{#if successMessage}
		<Alert>
			<AlertTitle>Action completed</AlertTitle>
			<AlertDescription>{successMessage}</AlertDescription>
		</Alert>
	{/if}

	<Card>
			<CardHeader class="flex flex-col gap-2">
				<CardTitle>ComponentTree</CardTitle>
			<CardDescription>AppShell(route="settings/media-upload-dev")</CardDescription>
			<CardDescription>PageHeaderBackButton(fallbackHref="/settings")</CardDescription>
			<CardDescription>PageHeaderTitle(title="Media Upload Test")</CardDescription>
			<CardDescription>Tabs(value="builder|uploads|detail")</CardDescription>
		</CardHeader>
			<CardContent class="flex flex-wrap gap-2">
				<Badge variant="outline">Existing UI only</Badge>
				<Badge variant="outline">S3 direct upload</Badge>
				<Badge variant="outline">Convex action flow</Badge>
				<Badge variant="outline">Retry / cancel</Badge>
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="flex flex-col gap-2">
				<CardTitle>Debug Console</CardTitle>
				<CardDescription>
					Inspect auth, live query state, and manual backend snapshots while you test the media flow.
				</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-4">
				<div class="flex flex-wrap gap-2">
					<Badge variant="outline">Auth: {auth.isAuthenticated ? 'authenticated' : 'unauthenticated'}</Badge>
					<Badge variant="outline">Auth loading: {auth.isLoading ? 'yes' : 'no'}</Badge>
					<Badge variant="outline">Uploads query: {uploadsResponse.isLoading ? 'loading' : 'settled'}</Badge>
					<Badge variant="outline">
						Selected query: {selectedAssetResponse.isLoading ? 'loading' : 'settled'}
					</Badge>
				</div>

				<div class="flex flex-wrap gap-2">
					<Button
						size="sm"
						variant="outline"
						onclick={() => void probeUploadsSnapshot()}
						disabled={debugProbePending !== null}
					>
						{debugProbePending === 'uploads' ? 'Probing uploads...' : 'Probe uploads snapshot'}
					</Button>
					<Button
						size="sm"
						variant="outline"
						onclick={() => void probeSelectedSnapshot()}
						disabled={!selectedAssetId || debugProbePending !== null}
					>
						{debugProbePending === 'selected' ? 'Probing selected...' : 'Probe selected snapshot'}
					</Button>
					<Button
						size="sm"
						variant="outline"
						onclick={() => void probeDeliverySnapshot()}
						disabled={!selectedAsset || selectedAsset.status !== 'ready' || debugProbePending !== null}
					>
						{debugProbePending === 'delivery' ? 'Probing delivery...' : 'Probe signed delivery'}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						onclick={() => {
							debugProbes = [];
						}}
						disabled={!debugProbes.length}
					>
						Clear probe history
					</Button>
				</div>

				<div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
					<div class="flex flex-col gap-2">
						<p class="text-sm font-medium">Live state</p>
						<pre class="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">{formatDebugPayload(liveDebugState)}</pre>
					</div>
					<div class="flex flex-col gap-2">
						<p class="text-sm font-medium">Probe history</p>
						{#if !debugProbes.length}
							<div class="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
								No probes yet.
							</div>
						{:else}
							<div class="flex flex-col gap-3">
								{#each debugProbes as probe, index (`${probe.label}-${probe.at}-${index}`)}
									<div class="flex flex-col gap-2 rounded-md border border-border p-3">
										<div class="flex flex-wrap items-center gap-2">
											<p class="text-sm font-medium">{probe.label}</p>
											<Badge variant="outline">{probe.at}</Badge>
										</div>
										<pre class="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">{probe.payload}</pre>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</CardContent>
		</Card>

	<div class="flex flex-col gap-6">
		<Card>
			<CardHeader class="flex flex-col gap-2">
				<CardTitle>Upload Builder</CardTitle>
				<CardDescription>
					Create media assets, upload straight to S3, and optionally finalize automatically.
				</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-6">
				<div class="flex flex-col gap-3">
					<Label>Presets</Label>
					<div class="flex flex-wrap gap-2">
						{#each Object.entries(presetConfig) as [presetKey, preset] (presetKey)}
							<Button
								variant={constraintForm.preset === presetKey ? 'default' : 'outline'}
								size="sm"
								onclick={() => applyPreset(presetKey as MediaUploadPreset)}
							>
								{preset.label}
							</Button>
						{/each}
					</div>
				</div>

				<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
					<div class="flex flex-col gap-2 lg:col-span-2">
						<Label for="acceptedContentTypes">Accepted content types</Label>
						<Textarea
							id="acceptedContentTypes"
							rows={3}
							bind:value={constraintForm.acceptedContentTypes}
							placeholder="image/jpeg, image/png"
						/>
					</div>

					<div class="flex flex-col gap-2">
						<Label for="maxBytesMb">Max size (MB)</Label>
						<Input id="maxBytesMb" type="number" min="1" max="250" bind:value={constraintForm.maxBytesMb} />
						<p class="text-xs text-muted-foreground">Current limit: {maxBytesLabel}</p>
					</div>

					<div class="flex flex-col gap-2">
						<Label>Behavior</Label>
						<div class="flex flex-col gap-3 rounded-md border border-border p-3">
							<div class="flex items-center justify-between gap-3">
								<div class="flex flex-col gap-1">
									<p class="text-sm font-medium">Auto-finalize after upload</p>
									<p class="text-xs text-muted-foreground">
										Keep this on for the full happy path, or turn it off to test pending uploads.
									</p>
								</div>
								<Switch bind:checked={autoFinalize} />
							</div>

							<div class="flex items-center justify-between gap-3">
								<div class="flex flex-col gap-1">
									<p class="text-sm font-medium">Compression flag</p>
									<p class="text-xs text-muted-foreground">Pass the shared compression toggle through beginUpload.</p>
								</div>
								<Switch bind:checked={constraintForm.enableCompression} />
							</div>

							<div class="flex items-center justify-between gap-3">
								<div class="flex flex-col gap-1">
									<p class="text-sm font-medium">Safety screening flag</p>
									<p class="text-xs text-muted-foreground">Pass the shared moderation/screening toggle through beginUpload.</p>
								</div>
								<Switch bind:checked={constraintForm.enableSafetyScreening} />
							</div>
						</div>
					</div>
				</div>

				<FileDropZone.Root
					onUpload={beginAndUploadFiles}
					fileCount={0}
					maxFiles={10}
					maxFileSize={currentConstraints.maxBytes}
					accept={uploadAccept || undefined}
					disabled={pending || !currentAcceptedContentTypes.length}
				>
					<FileDropZone.Trigger />
				</FileDropZone.Root>

				<div class="flex flex-col gap-3">
					<div class="flex flex-wrap gap-2">
						<Badge variant="outline">Accept: {uploadAccept || 'None configured'}</Badge>
						<Badge variant="outline">Max size: {maxBytesLabel}</Badge>
						<Badge variant="outline">Auto-finalize: {autoFinalize ? 'On' : 'Off'}</Badge>
					</div>

					{#if recentRuns.length}
						<div class="flex flex-col gap-2 rounded-md border border-border p-3">
							<p class="text-sm font-medium">Recent upload attempts</p>
							<div class="flex flex-col gap-2">
								{#each recentRuns as run (run.id)}
									<div class="flex flex-col gap-1 rounded-md border border-border p-3">
										<div class="flex flex-wrap items-center gap-2">
											<p class="text-sm font-medium">{run.fileName}</p>
											<Badge variant="outline">{run.status}</Badge>
											{#if run.assetId}
												<Badge variant="outline">{run.assetId}</Badge>
											{/if}
											{#if run.status === 'processing'}
												<Badge>Queued for processing</Badge>
											{/if}
										</div>
										{#if run.previewUrl && run.previewKind}
											<div class="overflow-hidden rounded-md border border-border bg-muted/20">
												{#if run.previewKind === 'image'}
													<img
														src={run.previewUrl}
														alt={`Local preview for ${run.fileName}`}
														class="aspect-video w-full bg-background object-contain"
													/>
												{:else if run.previewKind === 'video'}
													<!-- svelte-ignore a11y_media_has_caption -->
													<video
														src={run.previewUrl}
														controls
														muted
														preload="metadata"
														class="aspect-video w-full bg-black object-contain"
													></video>
												{/if}
											</div>
										{/if}
										<p class="text-sm text-muted-foreground">{run.message}</p>
										{#if run.objectKey}
											<p class="break-all text-xs text-muted-foreground">{run.objectKey}</p>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="flex flex-col gap-2">
				<CardTitle>Existing Uploads</CardTitle>
				<CardDescription>
					Inspect the shared status model and run finalize, retry, and cancel against real assets.
				</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-4">
				<Tabs.Root bind:value={filter}>
					<Tabs.List class="flex flex-wrap gap-4">
						<Tabs.Trigger value="all">All ({uploadCounts.all})</Tabs.Trigger>
						<Tabs.Trigger value="pending_upload">Pending ({uploadCounts.pending_upload})</Tabs.Trigger>
						<Tabs.Trigger value="processing">Processing ({uploadCounts.processing})</Tabs.Trigger>
						<Tabs.Trigger value="ready">Ready ({uploadCounts.ready})</Tabs.Trigger>
						<Tabs.Trigger value="failed">Failed ({uploadCounts.failed})</Tabs.Trigger>
						<Tabs.Trigger value="canceled">Canceled ({uploadCounts.canceled})</Tabs.Trigger>
					</Tabs.List>
				</Tabs.Root>

				<div class="flex items-center justify-between gap-3 rounded-md border border-border p-3">
					<div class="flex flex-col gap-1">
						<p class="text-sm font-medium">Delete storage when canceling</p>
						<p class="text-xs text-muted-foreground">
							Turn this off to test cancel semantics without deleting the raw object.
						</p>
					</div>
					<Switch bind:checked={deleteStorageOnCancel} />
				</div>

				{#if uploadsResponse.isLoading}
					<p class="text-sm text-muted-foreground">Loading uploads...</p>
				{:else if uploadsResponse.error}
					<Alert variant="destructive">
						<AlertTitle>Unable to load uploads</AlertTitle>
						<AlertDescription>{uploadsResponse.error.message}</AlertDescription>
					</Alert>
				{:else if !filteredUploads.length}
					<p class="text-sm text-muted-foreground">No uploads match the current filter yet.</p>
				{:else}
					<div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
						{#each filteredUploads as upload (upload.assetId)}
							<Card>
								<CardHeader class="flex flex-col gap-2">
									<div class="flex flex-wrap items-center gap-2">
										<CardTitle class="text-base">{upload.originalFilename ?? 'Untitled upload'}</CardTitle>
										<Badge variant="outline">{upload.status}</Badge>
										<Badge variant="outline">{upload.storageProvider}</Badge>
									</div>
									<CardDescription>{upload.assetId}</CardDescription>
								</CardHeader>
								<CardContent class="flex flex-col gap-4">
									<div class="flex flex-col gap-1 text-sm text-muted-foreground">
										<p>Content type: {upload.contentType ?? upload.clientContentType ?? 'Unknown'}</p>
										<p>Size: {formatBytes(upload.sizeBytes ?? upload.clientSizeBytes)}</p>
										<p>Updated: {formatDateTime(upload.updatedAt)}</p>
									</div>

									<div class="flex flex-wrap gap-2">
										<Button size="sm" variant="outline" onclick={() => (manualSelectedAssetId = upload.assetId)}>
											View detail
										</Button>
										{#if upload.actions.canFinalize}
											<Button size="sm" onclick={() => void finalizeAsset(upload.assetId)}>
												Finalize
											</Button>
										{/if}
										{#if upload.actions.canRetry}
											<Button size="sm" variant="secondary" onclick={() => void retryAsset(upload.assetId)}>
												Retry
											</Button>
										{/if}
										{#if upload.actions.canCancel}
											<Button size="sm" variant="destructive" onclick={() => void cancelAsset(upload.assetId)}>
												Cancel
											</Button>
										{/if}
										{#if upload.status === 'ready'}
											<Button
												size="sm"
												variant="ghost"
												onclick={() => void openSignedAsset(upload.assetId)}
											>
												Open file
											</Button>
										{/if}
									</div>

									{#if upload.lastFailure}
										<div class="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/5 p-3">
											<p class="text-sm font-medium text-destructive">{upload.lastFailure.code}</p>
											<p class="text-sm text-muted-foreground">{upload.lastFailure.message}</p>
										</div>
									{/if}
								</CardContent>
							</Card>
						{/each}
					</div>
				{/if}
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="flex flex-col gap-2">
				<CardTitle>Selected Upload Detail</CardTitle>
				<CardDescription>
					Use this panel to inspect the provider-neutral asset contract returned by the shared media API.
				</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-4">
				{#if selectedAssetResponse.isLoading && selectedAssetId}
					<p class="text-sm text-muted-foreground">Loading selected upload...</p>
				{:else if selectedAssetResponse.error}
					<Alert variant="destructive">
						<AlertTitle>Unable to load selected upload</AlertTitle>
						<AlertDescription>{selectedAssetResponse.error.message}</AlertDescription>
					</Alert>
				{:else if selectedAsset}
					<div class="flex flex-wrap gap-2">
						<Badge variant="outline">{selectedAsset.assetId}</Badge>
							<Badge variant="outline">{selectedAsset.status}</Badge>
							{#if selectedAsset.mediaKind}
								<Badge variant="outline">{selectedAsset.mediaKind}</Badge>
							{/if}
						</div>

					<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
						<div class="flex flex-col gap-2 rounded-md border border-border p-3">
							<p class="text-sm font-medium">Storage references</p>
							<p class="break-all text-sm text-muted-foreground">
								Raw: {selectedAsset.sourceBucket ?? 'n/a'} / {selectedAsset.sourceObjectKey ?? 'n/a'}
							</p>
							<p class="break-all text-sm text-muted-foreground">
								Processed: {selectedAsset.processedBucket ?? 'n/a'} / {selectedAsset.processedObjectKey ?? 'n/a'}
							</p>
							{#if selectedAsset.status === 'ready'}
								<div class="flex flex-wrap gap-2">
									<Button
										size="sm"
										variant="outline"
										onclick={() => void openSignedAsset(selectedAsset.assetId)}
									>
										Open ready file
									</Button>
									<Button
										size="sm"
										variant="secondary"
										onclick={() => void loadDeliveryPreview(selectedAsset.assetId)}
										disabled={selectedDeliveryPreviewPending}
									>
										{selectedDeliveryPreviewPending && selectedAsset.assetId !== selectedDeliveryPreview?.assetId
											? 'Loading preview...'
											: selectedDeliveryPreview
												? 'Refresh embedded preview'
												: 'Load embedded preview'}
									</Button>
								</div>
							{/if}
						</div>

						<div class="flex flex-col gap-2 rounded-md border border-border p-3">
							<p class="text-sm font-medium">Lifecycle</p>
							<p class="text-sm text-muted-foreground">Created: {formatDateTime(selectedAsset.createdAt)}</p>
							<p class="text-sm text-muted-foreground">Uploaded: {formatDateTime(selectedAsset.uploadCompletedAt)}</p>
							<p class="text-sm text-muted-foreground">Ready: {formatDateTime(selectedAsset.readyAt)}</p>
							<p class="text-sm text-muted-foreground">Failed: {formatDateTime(selectedAsset.failedAt)}</p>
							<p class="text-sm text-muted-foreground">Canceled: {formatDateTime(selectedAsset.canceledAt)}</p>
						</div>
					</div>

					<Separator />

					{#if selectedAsset.status === 'ready'}
						<div class="flex flex-col gap-3">
							<p class="text-sm font-medium">Embedded delivery preview</p>
							<div class="overflow-hidden rounded-md border border-border bg-muted/20">
								{#if selectedDeliveryPreviewPending && !selectedDeliveryPreview}
									<div class="flex aspect-video items-center justify-center p-4">
										<p class="text-sm text-muted-foreground">Loading signed delivery preview...</p>
									</div>
								{:else if selectedDeliveryPreview}
									{#if isDeliveryVideo(selectedDeliveryPreview)}
										<!-- svelte-ignore a11y_media_has_caption -->
										<video
											src={selectedDeliveryPreview.signedUrl}
											controls
											preload="metadata"
											class="aspect-video w-full bg-black object-contain"
										></video>
									{:else if isDeliveryImage(selectedDeliveryPreview)}
										<img
											src={selectedDeliveryPreview.signedUrl}
											alt={selectedAsset.originalFilename ?? 'Delivered media asset'}
											class="aspect-video w-full bg-background object-contain"
										/>
									{:else if supportsInlineDeliveryFrame(selectedDeliveryPreview)}
										<iframe
											src={selectedDeliveryPreview.signedUrl}
											title={selectedAsset.originalFilename ?? 'Delivered media asset'}
											class="aspect-video w-full bg-background"
										></iframe>
									{:else}
										<div class="flex aspect-video flex-col items-center justify-center gap-3 p-4 text-center">
											<p class="text-sm text-muted-foreground">
												Inline delivery preview is not configured for
												{selectedDeliveryPreview.contentType ?? 'this file type'}.
											</p>
											<Button
												size="sm"
												variant="outline"
												onclick={() => void openSignedAsset(selectedAsset.assetId)}
											>
												Open file in new tab
											</Button>
										</div>
									{/if}
								{:else}
									<div class="flex aspect-video items-center justify-center p-4">
										<p class="text-sm text-muted-foreground">
											Load an embedded preview to verify signed delivery in-page.
										</p>
									</div>
								{/if}
							</div>

							{#if selectedDeliveryPreview}
								<div class="flex flex-wrap gap-2">
									<Badge variant="outline">Signed delivery loaded</Badge>
									<Badge variant="outline">
										Expires: {formatSignedExpiry(selectedDeliveryPreview.expiresAt)}
									</Badge>
								</div>
							{/if}

							{#if selectedDeliveryPreviewError}
								<p class="text-sm text-destructive">{selectedDeliveryPreviewError}</p>
							{/if}
						</div>

						<Separator />
					{/if}

					<div class="flex flex-col gap-2">
						<p class="text-sm font-medium">Raw payload</p>
						<pre class="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">{selectedAssetJson}</pre>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">Select an upload from the list above to inspect its full payload.</p>
				{/if}
			</CardContent>
		</Card>
	</div>
</div>
