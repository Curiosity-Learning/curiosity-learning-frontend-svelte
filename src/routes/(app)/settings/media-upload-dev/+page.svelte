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
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { authClient } from '$lib/auth-client';
	import { useConvexClient } from 'convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import type { FunctionReturnType } from 'convex/server';

	type UploadOption = {
		contentType:
			| 'image/jpeg'
			| 'image/png'
			| 'image/webp'
			| 'image/heic'
			| 'image/heif'
			| 'video/mp4'
			| 'video/quicktime'
			| 'video/webm'
			| 'video/x-m4v';
		kind: 'image' | 'video';
	};

	type MediaUploadRow = FunctionReturnType<typeof api.media.listMyUploads>[number];

	const convexClient = useConvexClient();
	const session = authClient.useSession();
	const auth = useAuth();
	const isConvexAuthReady = $derived(!auth.isLoading && auth.isAuthenticated);

	const uploadOptions: UploadOption[] = [
		{ contentType: 'image/jpeg', kind: 'image' },
		{ contentType: 'image/png', kind: 'image' },
		{ contentType: 'image/webp', kind: 'image' },
		{ contentType: 'image/heic', kind: 'image' },
		{ contentType: 'image/heif', kind: 'image' },
		{ contentType: 'video/mp4', kind: 'video' },
		{ contentType: 'video/quicktime', kind: 'video' },
		{ contentType: 'video/webm', kind: 'video' },
		{ contentType: 'video/x-m4v', kind: 'video' }
	];

	const defaultAcceptedContentTypes = uploadOptions.map((option) => option.contentType);
	const mebibyte = 1024 * 1024;

	let pageError = $state('');
	let pageSuccess = $state('');
	let uploadPending = $state(false);
	let uploadQueueLabel = $state('');
	let uploadsLoading = $state(false);
	let uploadsError = $state('');
	let uploads = $state<MediaUploadRow[]>([]);
	let lastUploadsRefreshAt = $state<number | null>(null);
	let debugEvents = $state<string[]>([]);
	let manualDebugSnapshot = $state('');
	let manualDebugPending = $state(false);
	let bootstrappedUploads = false;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;

	let uploadForm = $state({
		acceptedContentTypesText: defaultAcceptedContentTypes.join(', '),
		maxBytesMb: '250',
		maxDurationSeconds: '120',
		enableCompression: true,
		enableSafetyScreening: true
	});

	const acceptedContentTypes = $derived.by(() =>
		[
			...new Set(
				uploadForm.acceptedContentTypesText
					.split(',')
					.map((contentType) => contentType.trim())
					.filter(Boolean)
			)
		]
	);
	const anyVideoSelected = $derived(
		acceptedContentTypes.some((contentType) => contentType.startsWith('video/'))
	);
	const dropZoneAccept = $derived(acceptedContentTypes.join(','));
	const maxBytes = $derived.by(() => {
		const parsed = Number(uploadForm.maxBytesMb);
		if (!Number.isFinite(parsed) || parsed <= 0) {
			return undefined;
		}

		return Math.floor(parsed * mebibyte);
	});
	const queryDebug = $derived.by(() => ({
		betterAuth: {
			isPending: $session.isPending,
			hasSession: Boolean($session.data),
			userEmail: $session.data?.user.email ?? null
		},
		convexAuth: {
			isLoading: auth.isLoading,
			isAuthenticated: auth.isAuthenticated,
			isReady: isConvexAuthReady
		},
		uploads: {
			isLoading: uploadsLoading,
			error: uploadsError || null,
			count: uploads.length,
			lastRefreshAt: lastUploadsRefreshAt ? new Date(lastUploadsRefreshAt).toISOString() : null
		},
		uploadPending,
		uploadQueueLabel
	}));

	const pushDebugEvent = (message: string) => {
		const timestamp = new Date().toLocaleTimeString();
		debugEvents = [`${timestamp} ${message}`, ...debugEvents].slice(0, 30);
	};

	const clearPollTimer = () => {
		if (!pollTimer) {
			return;
		}

		clearTimeout(pollTimer);
		pollTimer = null;
	};

	const scheduleUploadsRefresh = () => {
		if (typeof window === 'undefined') {
			return;
		}

		clearPollTimer();
		pollTimer = setTimeout(() => {
			void refreshUploads({ silent: true, reason: 'poll' });
		}, 3000);
	};

	const refreshUploads = async (options?: { silent?: boolean; reason?: string }) => {
		if (!isConvexAuthReady) {
			uploadsLoading = false;
			uploads = [];
			return;
		}

		const silent = options?.silent ?? false;
		if (!silent) {
			uploadsLoading = true;
			uploadsError = '';
		}

		try {
			const nextUploads = await convexClient.query(api.media.listMyUploads, {});
			uploads = nextUploads;
			lastUploadsRefreshAt = Date.now();
			if (!silent) {
				pushDebugEvent(
					options?.reason
						? `${options.reason}: loaded ${nextUploads.length} uploads`
						: `loaded ${nextUploads.length} uploads`
				);
			}

			if (
				nextUploads.some(
					(upload) => upload.status === 'processing' || upload.status === 'pending_upload'
				)
			) {
				scheduleUploadsRefresh();
			} else {
				clearPollTimer();
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unable to load uploads.';
			uploadsError = message;
			pushDebugEvent(`uploads query failed: ${message}`);
		} finally {
			uploadsLoading = false;
		}
	};

	$effect(() => {
		if (!isConvexAuthReady) {
			bootstrappedUploads = false;
			clearPollTimer();
			return;
		}

		if (bootstrappedUploads) {
			return;
		}

		bootstrappedUploads = true;
		pushDebugEvent('convex auth ready; bootstrapping uploads list');
		void refreshUploads({ reason: 'initial load' });
	});

	$effect(() => {
		return () => {
			clearPollTimer();
		};
	});

	const resetToProjectUpdateDefaults = () => {
		uploadForm = {
			acceptedContentTypesText: defaultAcceptedContentTypes.join(', '),
			maxBytesMb: '250',
			maxDurationSeconds: '120',
			enableCompression: true,
			enableSafetyScreening: true
		};
	};

	const setImageOnlyDefaults = () => {
		uploadForm = {
			...uploadForm,
			acceptedContentTypesText: uploadOptions
				.filter((option) => option.kind === 'image')
				.map((option) => option.contentType)
				.join(', '),
			maxDurationSeconds: ''
		};
	};

	const setVideoOnlyDefaults = () => {
		uploadForm = {
			...uploadForm,
			acceptedContentTypesText: uploadOptions
				.filter((option) => option.kind === 'video')
				.map((option) => option.contentType)
				.join(', '),
			maxDurationSeconds: uploadForm.maxDurationSeconds || '120'
		};
	};

	const toggleCompression = () => {
		uploadForm.enableCompression = !uploadForm.enableCompression;
	};

	const toggleSafetyScreening = () => {
		uploadForm.enableSafetyScreening = !uploadForm.enableSafetyScreening;
	};

	const handleToggleKey = (event: KeyboardEvent, toggle: () => void) => {
		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}

		event.preventDefault();
		toggle();
	};

	const formatBytes = (bytes?: number | null) => {
		if (bytes == null) {
			return 'Unavailable';
		}

		if (bytes < 1024) {
			return `${bytes} B`;
		}

		if (bytes < 1024 * 1024) {
			return `${(bytes / 1024).toFixed(1)} KB`;
		}

		if (bytes < 1024 * 1024 * 1024) {
			return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		}

		return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	};

	const formatDuration = (seconds?: number | null) => {
		if (seconds == null) {
			return 'N/A';
		}

		const minutes = Math.floor(seconds / 60);
		const remainder = Math.floor(seconds % 60);
		return `${minutes}:${remainder.toString().padStart(2, '0')}`;
	};

	const formatDateTime = (value?: number | null) => {
		if (!value) {
			return 'N/A';
		}

		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(value);
	};

	const buildConstraints = () => {
		if (!acceptedContentTypes.length) {
			throw new Error('Choose at least one accepted content type.');
		}

		if (!maxBytes) {
			throw new Error('Enter a valid max upload size in MB.');
		}

		let maxDurationSeconds: number | undefined;
		if (anyVideoSelected && uploadForm.maxDurationSeconds.trim()) {
			const parsed = Number(uploadForm.maxDurationSeconds);
			if (!Number.isFinite(parsed) || parsed <= 0) {
				throw new Error('Enter a valid max duration in seconds.');
			}
			maxDurationSeconds = Math.floor(parsed);
		}

		return {
			acceptedContentTypes: [...acceptedContentTypes],
			maxBytes,
			maxDurationSeconds,
			enableCompression: uploadForm.enableCompression,
			enableSafetyScreening: uploadForm.enableSafetyScreening
		};
	};

	const uploadFiles = async (files: File[]) => {
		pageError = '';
		pageSuccess = '';
		uploadPending = true;
		uploadQueueLabel =
			files.length === 1 ? `Uploading ${files[0].name}...` : `Uploading ${files.length} files...`;
		pushDebugEvent(
			files.length === 1
				? `starting upload for ${files[0].name}`
				: `starting upload batch of ${files.length} files`
		);

		try {
			const constraints = buildConstraints();
			pushDebugEvent(`constraints: ${JSON.stringify(constraints)}`);

			for (const file of files) {
				const beginResult = await convexClient.mutation(api.media.beginUpload, {
					constraints,
					originalFilename: file.name,
					clientContentType: file.type || undefined,
					clientSizeBytes: file.size
				});
				pushDebugEvent(`beginUpload ok for ${file.name}; assetId=${beginResult.asset.assetId}`);
				let finalized = false;

				try {
					const uploadResponse = await fetch(beginResult.uploadUrl, {
						method: 'POST',
						body: file
					});
					pushDebugEvent(`storage upload response for ${file.name}: ${uploadResponse.status}`);

					if (!uploadResponse.ok) {
						throw new Error(`Storage upload failed with status ${uploadResponse.status}.`);
					}

					const uploadPayload = (await uploadResponse.json()) as {
						storageId?: Id<'_storage'>;
					};

					if (!uploadPayload.storageId) {
						throw new Error('Storage upload did not return a storage id.');
					}
					pushDebugEvent(
						`storage upload produced storageId=${uploadPayload.storageId} for ${file.name}`
					);

					await convexClient.mutation(api.media.finalizeUpload, {
						assetId: beginResult.asset.assetId,
						storageId: uploadPayload.storageId
					});
					finalized = true;
					pushDebugEvent(`finalizeUpload queued processing for ${file.name}`);
				} catch (error) {
					if (!finalized) {
						await convexClient
							.mutation(api.media.cancelUpload, {
								assetId: beginResult.asset.assetId,
								deleteStorage: true
							})
							.catch(() => undefined);
					}
					pushDebugEvent(
						error instanceof Error
							? `upload failed for ${file.name}: ${error.message}`
							: `upload failed for ${file.name}`
					);
					throw error;
				}
			}

			pageSuccess =
				files.length === 1
					? 'Upload started. The sandbox will keep refreshing while processing continues.'
					: 'Uploads started. The sandbox will keep refreshing while processing continues.';
			await refreshUploads({ reason: 'post upload refresh' });
		} catch (error) {
			pageError =
				error instanceof Error ? error.message : 'The upload sandbox could not start processing.';
			pushDebugEvent(pageError);
		} finally {
			uploadPending = false;
			uploadQueueLabel = '';
		}
	};

	const refreshDebugSnapshot = async () => {
		manualDebugPending = true;
		pageError = '';
		try {
			const [viewer, uploadsSnapshot] = await Promise.all([
				isConvexAuthReady ? convexClient.query(api.auth.getViewerIdentity, {}) : Promise.resolve(null),
				isConvexAuthReady ? convexClient.query(api.media.listMyUploads, {}) : Promise.resolve(null)
			]);

			manualDebugSnapshot = JSON.stringify(
				{
					viewer,
					uploadsCount: uploadsSnapshot?.length ?? null,
					firstUpload: uploadsSnapshot?.[0] ?? null
				},
				null,
				2
			);
			pushDebugEvent('manual debug snapshot refreshed');
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Manual debug snapshot failed.';
			pageError = message;
			pushDebugEvent(message);
		} finally {
			manualDebugPending = false;
		}
	};

	const retryUpload = async (assetId: Id<'mediaAssets'>) => {
		pageError = '';
		pageSuccess = '';
		try {
			await convexClient.mutation(api.media.retryProcessing, { assetId });
			pageSuccess = 'Retry queued.';
			pushDebugEvent(`retry queued for ${assetId}`);
			await refreshUploads({ reason: 'retry refresh' });
		} catch (error) {
			pageError = error instanceof Error ? error.message : 'Retry failed.';
			pushDebugEvent(pageError);
		}
	};

	const restartUpload = async (assetId: Id<'mediaAssets'>) => {
		pageError = '';
		pageSuccess = '';
		try {
			await convexClient.mutation(api.media.restartUpload, { assetId });
			pageSuccess = 'Upload reset to pending. Upload the file again to continue.';
			pushDebugEvent(`restart queued for ${assetId}`);
			await refreshUploads({ reason: 'restart refresh' });
		} catch (error) {
			pageError = error instanceof Error ? error.message : 'Restart failed.';
			pushDebugEvent(pageError);
		}
	};

	const cancelUpload = async (assetId: Id<'mediaAssets'>) => {
		pageError = '';
		pageSuccess = '';
		try {
			await convexClient.mutation(api.media.cancelUpload, {
				assetId,
				deleteStorage: true
			});
			pageSuccess = 'Upload canceled.';
			pushDebugEvent(`cancel queued for ${assetId}`);
			await refreshUploads({ reason: 'cancel refresh' });
		} catch (error) {
			pageError = error instanceof Error ? error.message : 'Cancel failed.';
			pushDebugEvent(pageError);
		}
	};

	const getStatusVariant = (value: string): 'default' | 'destructive' | 'outline' => {
		if (value === 'ready' || value === 'approved') {
			return 'default';
		}

		if (value === 'failed' || value === 'rejected' || value === 'canceled') {
			return 'destructive';
		}

		return 'outline';
	};
</script>

<PageHeaderBackButton fallbackHref="/settings" />
<PageHeaderTitle title="Media Upload Sandbox" />

<div class="grid grid-cols-1 gap-4">
	{#if pageError}
		<Alert variant="destructive">
			<AlertTitle>Sandbox action failed</AlertTitle>
			<AlertDescription>{pageError}</AlertDescription>
		</Alert>
	{/if}
	{#if pageSuccess}
		<Alert>
			<AlertTitle>Sandbox updated</AlertTitle>
			<AlertDescription>{pageSuccess}</AlertDescription>
		</Alert>
	{/if}

	<Card>
		<CardHeader class="flex flex-col gap-2">
			<CardTitle>Debug</CardTitle>
			<CardDescription>
				Media-pipeline-only diagnostics for auth state, upload refresh state, and upload events.
			</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-3">
			<div class="flex flex-wrap gap-2">
				<Button
					size="sm"
					variant="outline"
					disabled={manualDebugPending}
					onclick={() => void refreshDebugSnapshot()}
				>
					{manualDebugPending ? 'Refreshing debug...' : 'Refresh debug snapshot'}
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={uploadsLoading || !isConvexAuthReady}
					onclick={() => void refreshUploads({ reason: 'manual refresh' })}
				>
					{uploadsLoading ? 'Refreshing uploads...' : 'Refresh uploads'}
				</Button>
			</div>
			<pre class="overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">{JSON.stringify(queryDebug, null, 2)}</pre>
			{#if manualDebugSnapshot}
				<pre class="overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">{manualDebugSnapshot}</pre>
			{/if}
			{#if debugEvents.length}
				<div class="flex flex-col gap-2">
					<p class="text-sm font-medium">Event log</p>
					<div class="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-3">
						{#each debugEvents as entry, index (`${entry}-${index}`)}
							<p class="font-mono text-xs">{entry}</p>
						{/each}
					</div>
				</div>
			{/if}
		</CardContent>
	</Card>

	<Card>
		<CardHeader class="flex flex-col gap-2">
			<CardTitle>Upload Policy</CardTitle>
			<CardDescription>
				These values are passed through the real constraint-based upload API and then enforced
				server-side.
			</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			<div class="flex flex-wrap gap-2">
				<Button size="sm" variant="outline" onclick={resetToProjectUpdateDefaults}>
					Common defaults
				</Button>
				<Button size="sm" variant="outline" onclick={setImageOnlyDefaults}>Images only</Button>
				<Button size="sm" variant="outline" onclick={setVideoOnlyDefaults}>Videos only</Button>
			</div>

			<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="maxBytesMb">Max upload size (MB)</Label>
					<Input id="maxBytesMb" bind:value={uploadForm.maxBytesMb} inputmode="decimal" />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="maxDurationSeconds">Max video duration (seconds)</Label>
					<Input
						id="maxDurationSeconds"
						bind:value={uploadForm.maxDurationSeconds}
						disabled={!anyVideoSelected}
						placeholder={anyVideoSelected ? '120' : 'Only used when a video type is allowed'}
						inputmode="numeric"
					/>
				</div>
			</div>

			<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
				<div
					aria-pressed={uploadForm.enableCompression}
					class="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border p-3"
					onclick={toggleCompression}
					onkeydown={(event) => handleToggleKey(event, toggleCompression)}
					role="button"
					tabindex="0"
				>
					<div class="flex flex-col gap-1">
						<p class="font-medium">Compression</p>
						<p class="text-xs text-muted-foreground">Run the shared compression step.</p>
					</div>
					<Switch bind:checked={uploadForm.enableCompression} onclick={(event) => event.stopPropagation()} />
				</div>
				<div
					aria-pressed={uploadForm.enableSafetyScreening}
					class="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border p-3"
					onclick={toggleSafetyScreening}
					onkeydown={(event) => handleToggleKey(event, toggleSafetyScreening)}
					role="button"
					tabindex="0"
				>
					<div class="flex flex-col gap-1">
						<p class="font-medium">Safety screening</p>
						<p class="text-xs text-muted-foreground">Run AWS moderation before approval.</p>
					</div>
					<Switch
						bind:checked={uploadForm.enableSafetyScreening}
						onclick={(event) => event.stopPropagation()}
					/>
				</div>
			</div>

			<div class="flex flex-col gap-3">
				<div class="flex items-center justify-between gap-2">
					<p class="font-medium">Accepted content types</p>
					<Badge variant="outline">{acceptedContentTypes.length} entries</Badge>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="acceptedContentTypesText">Comma-separated MIME types</Label>
					<Textarea
						id="acceptedContentTypesText"
						bind:value={uploadForm.acceptedContentTypesText}
						rows={4}
					/>
					<p class="text-xs text-muted-foreground">
						Example: `image/jpeg, image/png, image/webp, video/mp4`
					</p>
					<div class="flex flex-wrap gap-2">
						{#each acceptedContentTypes as contentType (contentType)}
							<Badge variant="outline">{contentType}</Badge>
						{/each}
					</div>
				</div>
			</div>
		</CardContent>
	</Card>

	<Card>
		<CardHeader class="flex flex-col gap-2">
			<CardTitle>Upload Files</CardTitle>
			<CardDescription>
				This hits the real `beginUpload -> storage POST -> finalizeUpload` flow.
			</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-3">
			<FileDropZone.Root
				accept={dropZoneAccept}
				disabled={uploadPending}
				fileCount={0}
				maxFileSize={maxBytes}
				onFileRejected={({ file, reason }) => {
					pageError = `${file.name}: ${reason}`;
				}}
				onUpload={uploadFiles}
				showErrorToasts={false}
			>
				<FileDropZone.Trigger />
			</FileDropZone.Root>

			<div class="flex flex-wrap items-center gap-2">
				<Badge variant="outline">
					Accept: {acceptedContentTypes.length ? dropZoneAccept : 'None'}
				</Badge>
				<Badge variant="outline">Max size: {maxBytes ? formatBytes(maxBytes) : 'Invalid'}</Badge>
				<Badge variant="outline">
					Max duration: {anyVideoSelected && uploadForm.maxDurationSeconds
						? `${uploadForm.maxDurationSeconds}s`
						: 'Not set'}
				</Badge>
			</div>

			{#if uploadPending}
				<p class="text-sm text-muted-foreground">{uploadQueueLabel}</p>
			{/if}
		</CardContent>
	</Card>

	<Card>
		<CardHeader class="flex flex-col gap-2">
			<CardTitle>My Uploads</CardTitle>
			<CardDescription>
				Manual refresh plus auto-polling while uploads are still processing.
			</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-3">
			{#if uploadsError}
				<Alert variant="destructive">
					<AlertTitle>Unable to load uploads</AlertTitle>
					<AlertDescription>{uploadsError}</AlertDescription>
				</Alert>
			{:else if uploadsLoading && uploads.length === 0}
				<p class="text-sm text-muted-foreground">Loading uploads...</p>
			{:else if uploads.length === 0}
				<p class="text-sm text-muted-foreground">No uploads yet.</p>
			{:else}
				<div class="grid grid-cols-1 gap-3">
					{#each uploads as upload (upload.assetId)}
						<div class="flex flex-col gap-3 rounded-xl border border-border p-4">
							<div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
								<div class="flex flex-col gap-2">
									<div class="flex flex-wrap items-center gap-2">
										<p class="font-medium">{upload.originalFilename ?? upload.assetId}</p>
										<Badge variant={getStatusVariant(upload.status)}>{upload.status}</Badge>
										<Badge variant={getStatusVariant(upload.moderationStatus)}>
											{upload.moderationStatus}
										</Badge>
										{#if upload.mediaKind}
											<Badge variant="outline">{upload.mediaKind}</Badge>
										{/if}
									</div>
									<div class="grid grid-cols-1 gap-1 text-sm text-muted-foreground md:grid-cols-2">
										<p>Type: {upload.contentType ?? upload.clientContentType ?? 'Unknown'}</p>
										<p>
											Size: {formatBytes(upload.processedSizeBytes ?? upload.originalSizeBytes)}
										</p>
										<p>Duration: {formatDuration(upload.durationSeconds)}</p>
										<p>Created: {formatDateTime(upload.createdAt)}</p>
									</div>
								</div>

								<div class="flex flex-wrap items-center gap-2">
									{#if upload.fileUrl}
										<Button href={upload.fileUrl} rel="noreferrer" size="sm" target="_blank" variant="outline">
											Open file
										</Button>
									{/if}
									{#if upload.actions.canRetry}
										<Button size="sm" variant="outline" onclick={() => void retryUpload(upload.assetId)}>
											Retry
										</Button>
									{/if}
									{#if upload.actions.canRestart}
										<Button
											size="sm"
											variant="outline"
											onclick={() => void restartUpload(upload.assetId)}
										>
											Restart
										</Button>
									{/if}
									{#if upload.actions.canCancel}
										<Button
											size="sm"
											variant="outline"
											onclick={() => void cancelUpload(upload.assetId)}
										>
											Cancel
										</Button>
									{/if}
								</div>
							</div>

							{#if upload.lastFailure}
								<Alert variant="destructive">
									<AlertTitle>Last failure</AlertTitle>
									<AlertDescription>{upload.lastFailure.message}</AlertDescription>
								</Alert>
							{/if}

							{#if upload.moderationSummary}
								<p class="text-sm text-muted-foreground">
									Moderation summary: {upload.moderationSummary}
								</p>
							{/if}

							{#if upload.stepResults.length}
								<div class="flex flex-col gap-2">
									<p class="text-sm font-medium">Pipeline steps</p>
									<div class="flex flex-wrap gap-2">
										{#each upload.stepResults as step, index (`${upload.assetId}-${step.step}-${index}`)}
											<Badge variant={step.status === 'failed' ? 'destructive' : 'outline'}>
												{step.step}: {step.status}
											</Badge>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
