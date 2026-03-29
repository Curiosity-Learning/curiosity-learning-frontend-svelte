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
	import { routes } from '$lib/routes';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';

	type UploadStatus = 'pending_upload' | 'processing' | 'ready' | 'failed' | 'canceled';
	type UploadFilter = 'all' | UploadStatus;
	type UploadPreset = 'images' | 'videos' | 'mixed';

	type UploadDescriptor = {
		provider: string;
		method: 'PUT' | 'POST';
		url: string;
		headers?: Record<string, string>;
		fields?: Record<string, string>;
		objectKey: string;
		uploadToken?: string;
	};

	type UploadRun = {
		id: string;
		fileName: string;
		assetId?: Id<'mediaAssets'>;
		status:
			| 'starting'
			| 'uploading'
			| 'waiting_to_finalize'
			| 'finalizing'
			| 'completed'
			| 'failed';
		message: string;
		objectKey?: string;
	};

	const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
	const VIDEO_CONTENT_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];

	const presetConfig: Record<
		UploadPreset,
		{
			label: string;
			acceptedContentTypes: string[];
			maxBytesMb: number;
		}
	> = {
		images: {
			label: 'Images',
			acceptedContentTypes: IMAGE_CONTENT_TYPES,
			maxBytesMb: 20
		},
		videos: {
			label: 'Videos',
			acceptedContentTypes: VIDEO_CONTENT_TYPES,
			maxBytesMb: 250
		},
		mixed: {
			label: 'Mixed media',
			acceptedContentTypes: [...IMAGE_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES],
			maxBytesMb: 250
		}
	};

	const convexClient = useConvexClient();

	const uploadsResponse = useStableQuery(api.media.listMyUploads, {});

	let filter = $state<UploadFilter>('all');
	let manualSelectedAssetId = $state<Id<'mediaAssets'> | null>(null);
	let pending = $state(false);
	let autoFinalize = $state(true);
	let deleteStorageOnCancel = $state(true);
	let errorMessage = $state('');
	let successMessage = $state('');
	let recentRuns = $state<UploadRun[]>([]);

	let constraintForm = $state({
		preset: 'mixed' as UploadPreset,
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

	const applyPreset = (preset: UploadPreset) => {
		const config = presetConfig[preset];
		constraintForm.preset = preset;
		constraintForm.acceptedContentTypes = config.acceptedContentTypes.join(', ');
		constraintForm.maxBytesMb = config.maxBytesMb;
	};

	const currentAcceptedContentTypes = $derived(parseAcceptedContentTypes(constraintForm.acceptedContentTypes));

	const currentConstraints = $derived.by(() => ({
		acceptedContentTypes: currentAcceptedContentTypes,
		maxBytes: Math.max(1, Math.floor((Number(constraintForm.maxBytesMb) || 1) * 1024 * 1024)),
		enableCompression: constraintForm.enableCompression,
		enableSafetyScreening: constraintForm.enableSafetyScreening
	}));

	const uploadAccept = $derived(currentAcceptedContentTypes.join(','));
	const maxBytesLabel = $derived(formatBytes(currentConstraints.maxBytes));
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

	const selectedAssetJson = $derived(selectedAsset ? JSON.stringify(selectedAsset, null, 2) : '');

	const pushRun = (run: UploadRun) => {
		recentRuns = [run, ...recentRuns].slice(0, 10);
	};

	const patchRun = (id: string, patch: Partial<UploadRun>) => {
		recentRuns = recentRuns.map((run) => (run.id === id ? { ...run, ...patch } : run));
	};

	const compactWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

	const truncate = (value: string, maxLength = 240) =>
		value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

	const buildUploadFailureMessage = async (response: Response) => {
		const suffix = response.statusText ? ` ${response.statusText}` : '';
		const rawBody = compactWhitespace(await response.text());
		const xmlCode = rawBody.match(/<Code>([^<]+)<\/Code>/)?.[1];
		const xmlMessage = rawBody.match(/<Message>([^<]+)<\/Message>/)?.[1];
		const xmlRequestId = rawBody.match(/<RequestId>([^<]+)<\/RequestId>/)?.[1];
		const detail =
			[xmlCode, xmlMessage, xmlRequestId ? `RequestId ${xmlRequestId}` : null]
				.filter(Boolean)
				.join(' | ') || truncate(rawBody);

		return detail
			? `Upload failed (${response.status}${suffix}): ${detail}`
			: `Upload failed (${response.status}${suffix})`;
	};

	const normalizeUploadErrorMessage = (error: unknown) => {
		if (error instanceof Error) {
			if (error instanceof TypeError) {
				return `${error.message}. The browser did not get a usable S3 response. Check bucket CORS, the presigned URL region, and network access to S3.`;
			}

			return error.message;
		}

		return 'Upload failed.';
	};

	const uploadFileToDescriptor = async (file: File, upload: UploadDescriptor) => {
		if (upload.method === 'POST') {
			const formData = new FormData();
			for (const [key, value] of Object.entries(upload.fields ?? {})) {
				formData.append(key, value);
			}
			formData.append('file', file);

			const response = await fetch(upload.url, {
				method: 'POST',
				body: formData
			});

			if (!response.ok) {
				throw new Error(await buildUploadFailureMessage(response));
			}

			return;
		}

		const response = await fetch(upload.url, {
			method: upload.method,
			headers: {
				...(upload.headers ?? {}),
				...(!upload.headers?.['content-type'] && file.type ? { 'content-type': file.type } : {})
			},
			body: file
		});

		if (!response.ok) {
			throw new Error(await buildUploadFailureMessage(response));
		}
	};

	const beginAndUploadFiles = async (files: File[]) => {
		if (!currentAcceptedContentTypes.length) {
			errorMessage = 'Add at least one accepted content type before uploading.';
			return;
		}

		pending = true;
		errorMessage = '';
		successMessage = '';

		try {
			for (const file of files) {
				const runId = crypto.randomUUID();
				pushRun({
					id: runId,
					fileName: file.name,
					status: 'starting',
					message: 'Creating upload session...'
				});

				try {
					const beginResult = await convexClient.action(api.media.beginUpload, {
						constraints: currentConstraints,
						originalFilename: file.name,
						clientContentType: file.type || undefined,
						clientSizeBytes: file.size
					});

					patchRun(runId, {
						assetId: beginResult.asset.assetId,
						objectKey: beginResult.upload.objectKey,
						status: 'uploading',
						message: `Uploading ${file.name} to ${beginResult.upload.provider}...`
					});

					await uploadFileToDescriptor(file, beginResult.upload as UploadDescriptor);
					manualSelectedAssetId = beginResult.asset.assetId;

					if (autoFinalize) {
						patchRun(runId, {
							status: 'finalizing',
							message: 'Upload complete. Finalizing asset...'
						});
						await convexClient.action(api.media.finalizeUpload, {
							assetId: beginResult.asset.assetId
						});
						patchRun(runId, {
							status: 'completed',
							message: 'Upload finalized and queued for processing.'
						});
					} else {
						patchRun(runId, {
							status: 'waiting_to_finalize',
							message: 'Binary upload finished. Use Finalize to start processing.'
						});
					}
				} catch (error) {
					const message = normalizeUploadErrorMessage(error);
					errorMessage = message;
					patchRun(runId, {
						status: 'failed',
						message
					});
				}
			}

			successMessage = autoFinalize
				? 'Upload batch completed. Review processing state below.'
				: 'Upload batch sent. Finalize pending uploads when you are ready.';
		} finally {
			pending = false;
		}
	};

	const finalizeAsset = async (assetId: Id<'mediaAssets'>) => {
		errorMessage = '';
		successMessage = '';
		try {
			manualSelectedAssetId = assetId;
			await convexClient.action(api.media.finalizeUpload, { assetId });
			successMessage = 'Upload finalized and queued for processing.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unable to finalize upload.';
		}
	};

	const retryAsset = async (assetId: Id<'mediaAssets'>) => {
		errorMessage = '';
		successMessage = '';
		try {
			manualSelectedAssetId = assetId;
			await convexClient.mutation(api.media.retryProcessing, { assetId });
			successMessage = 'Retry queued.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unable to retry processing.';
		}
	};

	const cancelAsset = async (assetId: Id<'mediaAssets'>) => {
		errorMessage = '';
		successMessage = '';
		try {
			manualSelectedAssetId = assetId;
			await convexClient.action(api.media.cancelUpload, {
				assetId,
				deleteStorage: deleteStorageOnCancel
			});
			successMessage = deleteStorageOnCancel
				? 'Upload canceled and storage cleaned up.'
				: 'Upload canceled without deleting storage.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unable to cancel upload.';
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
								onclick={() => applyPreset(presetKey as UploadPreset)}
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
										</div>
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
										{#if upload.fileUrl}
											<Button
												size="sm"
												variant="ghost"
												href={routes.mediaAsset(upload.assetId)}
												target="_blank"
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
							{#if selectedAsset.fileUrl}
								<Button
									size="sm"
									variant="outline"
									href={routes.mediaAsset(selectedAsset.assetId)}
									target="_blank"
								>
									Open ready file
								</Button>
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
