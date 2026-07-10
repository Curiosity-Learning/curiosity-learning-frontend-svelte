<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import {
		AutoFitCardGrid,
		LoadingState,
		PageHeaderActions,
		PageHeaderBackButton,
		PageHeaderSearch
	} from '$lib/components/app';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { DatePicker } from '$lib/components/ui/date-picker';
	import * as FileDropZone from '$lib/components/ui/file-drop-zone';
	import { Input } from '$lib/components/ui/input';
	import { FieldLabel } from '$lib/components/ui/field';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';
	import { createMediaField } from '$lib/media/media-field.svelte';
	import { routes } from '$lib/routes';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { t } from '$lib/i18n';
	import ClubProjectCard from './club-project-card.svelte';

	const PROJECT_NAME_MAX_LENGTH = 50;
	const PROJECT_DESCRIPTION_MAX_LENGTH = 500;

	type Props = {
		status: 'current' | 'completed';
	};

	let { status }: Props = $props();

	const convexClient = useConvexClient();
	const clubsResponse = useStableQuery(api.clubs.getMyClubs, {});

	let clubId = $derived((page.params as Record<string, string | undefined>).clubId ?? null);
	let clubItem = $derived(
		clubId ? ((clubsResponse.data ?? []).find((club) => club.clubId === clubId) ?? null) : null
	);
	let clubPermissions = $derived(clubItem?.rolePermissions ?? []);
	let canCreate = $derived(clubPermissions.includes('project:create'));
	let clubIdTyped = $derived(clubId ? (clubId as Id<'clubs'>) : null);

	const projectCardsResponse = useStableQuery(api.projects.listPreviewsByClub, () =>
		clubIdTyped ? { clubId: clubIdTyped } : 'skip',
		{ cache: 'memory' }
	);

	let errorMessage = $state('');
	let searchText = $state('');

	let createDialogOpen = $state(false);
	let createName = $state('');
	let createDescription = $state('');
	let createDueDate = $state<number | null>(null);
	let createVisibility = $state<'clubs' | 'global'>('clubs');
	let createPending = $state(false);
	let createError = $state('');

	// PRD 6.6.3: cover image is optional at creation, editable later by any active member.
	const createCoverField = createMediaField(convexClient, 'projectCover', { mode: 'immediate' });
	let coverUploadError = $state('');

	onDestroy(() => {
		createCoverField.destroy();
	});

	const uploadCreateCover = async (files: File[]) => {
		coverUploadError = '';
		try {
			await createCoverField.selectFiles(files);
			if (!createCoverField.isReady || !createCoverField.assetId) {
				throw new Error(createCoverField.errorMessage || 'Failed to upload cover image.');
			}
		} catch (error) {
			coverUploadError = error instanceof Error ? error.message : 'Failed to upload cover image.';
		}
	};

	const removeCreateCover = () => {
		createCoverField.clear();
		coverUploadError = '';
	};

	const openCreateDialog = () => {
		createName = '';
		createDescription = '';
		createDueDate = null;
		createVisibility = 'clubs';
		createError = '';
		coverUploadError = '';
		createCoverField.clear();
		createDialogOpen = true;
	};

	const createProject = async () => {
		if (
			!clubIdTyped ||
			!createName.trim() ||
			createDueDate === null ||
			!createDescription.trim()
		) {
			return;
		}
		createPending = true;
		createError = '';
		try {
			const coverImageMediaAssetId = await createCoverField.ensureUploaded();
			const project = await convexClient.mutation(api.projects.create, {
				clubId: clubIdTyped,
				name: createName.trim(),
				description: createDescription.trim(),
				dueDate: createDueDate,
				visibility: createVisibility,
				coverImageMediaAssetId: coverImageMediaAssetId ?? undefined
			});
			createDialogOpen = false;
			if (project?._id) {
				await goto(resolve(`/project/${project._id}/overview`), {
					state: {
						headerTitleHint: createName.trim(),
						headerTitleHintPath: `/project/${project._id}`
					}
				});
			}
		} catch (error) {
			createError = error instanceof Error ? error.message : 'Failed to create project.';
		} finally {
			createPending = false;
		}
	};

	let sortedProjectCards = $derived.by(() => {
		const projectCards = [...(projectCardsResponse.data ?? [])];
		if (status === 'completed') {
			return projectCards.sort(
				(left, right) =>
					(right.project.archivedAt ?? right.project.updatedAt ?? right.project.createdAt) -
					(left.project.archivedAt ?? left.project.updatedAt ?? left.project.createdAt)
			);
		}

		return projectCards.sort((left, right) => {
			if (left.project.dueDate !== right.project.dueDate) {
				return (left.project.dueDate ?? 0) - (right.project.dueDate ?? 0);
			}
			return left.project.createdAt - right.project.createdAt;
		});
	});

	// PRD 6.6.7: "completed" here is the Showcase tab — archived OR zero active members left in
	// this club, as computed server-side by `listPreviewsByClub`'s `isShowcase`.
	let visibleProjectCards = $derived.by(() => {
		const query = searchText.trim().toLowerCase();
		const scopedByTab = sortedProjectCards.filter((entry) =>
			status === 'completed' ? entry.isShowcase : !entry.isShowcase
		);

		if (!query) return scopedByTab;

		return scopedByTab.filter((entry) => {
			const project = entry.project;
			const dueText = project.dueDate ? new Date(project.dueDate).toLocaleDateString() : '';
			const doneText = project.archivedAt
				? new Date(project.archivedAt).toLocaleDateString()
				: '';
			return [project.name, project.description ?? '', dueText, doneText]
				.join(' ')
				.toLowerCase()
				.includes(query);
		});
	});

	let emptyLabel = $derived(
		searchText
			? 'No projects match your search.'
			: status === 'completed'
				? 'No completed projects yet.'
				: 'No current projects yet.'
	);

	let initialProjectPreviewImageUrls = $derived.by(() => {
		return new Map(
			((page.data.initialProjectPreviewImages as Array<{ assetId: Id<'mediaAssets'>; signedUrl: string }> | undefined) ?? []).map(
				(asset) => [asset.assetId, asset.signedUrl] as const
			)
		);
	});

	// PRD 6.6.3: cover image appears in project cards on club views. Renders gracefully without
	// one when the project has no cover or the asset can't be resolved for this viewer.
	let initialProjectCoverImageUrls = $derived.by(() => {
		return new Map(
			(
				(page.data.initialProjectCoverImages as
					| Array<{ assetId: Id<'mediaAssets'>; signedUrl: string }>
					| undefined) ?? []
			).map((asset) => [asset.assetId, asset.signedUrl] as const)
		);
	});

	let visibleProjectCardsWithSignedMembers = $derived(
		visibleProjectCards.map((entry) => ({
			...entry,
			members: entry.members.map((member) => ({
				name: member.name,
				imageUrl: member.profileImageMediaAssetId
					? (initialProjectPreviewImageUrls.get(member.profileImageMediaAssetId) ?? null)
					: null
			})),
			coverImageUrl: entry.project.coverImageMediaAssetId
				? (initialProjectCoverImageUrls.get(entry.project.coverImageMediaAssetId) ?? null)
				: null
		}))
	);
</script>

<PageHeaderBackButton fallbackHref={clubId ? `/club/${clubId}` : '/onboarding/get-started'} />
<PageHeaderSearch
	bind:value={searchText}
	placeholder="Search projects by title, date, or description"
	ariaLabel="Search projects"
	mode="auto"
/>
<PageHeaderActions>
	<div class="flex items-center gap-1">
		<Button
			variant="ghost"
			size="icon"
			aria-label="Create project"
			disabled={!canCreate}
			onclick={openCreateDialog}
		>
			<PlusIcon class="size-5 text-muted-foreground" />
		</Button>
	</div>
</PageHeaderActions>

{#if !clubIdTyped}
	<Alert>
		<AlertTitle>No active club</AlertTitle>
		<AlertDescription>Set an active club before creating projects.</AlertDescription>
	</Alert>
{:else}
	<div class="flex w-full flex-col gap-4 self-center">
		{#if errorMessage}
			<Alert variant="destructive">
				<AlertTitle>Action failed</AlertTitle>
				<AlertDescription>{errorMessage}</AlertDescription>
			</Alert>
		{/if}

		{#if projectCardsResponse.error}
			<Alert variant="destructive">
				<AlertTitle>Unable to load projects</AlertTitle>
				<AlertDescription>
					{projectCardsResponse.error.message ?? 'Please refresh and try again.'}
				</AlertDescription>
			</Alert>
		{:else if projectCardsResponse.isLoading}
			<LoadingState label="Loading projects" />
		{:else if visibleProjectCards.length === 0}
			<p class="type-sm text-muted-foreground">{emptyLabel}</p>
		{:else}
			<AutoFitCardGrid minColumnWidth="17rem" maxColumns={3}>
				{#each visibleProjectCardsWithSignedMembers as entry (entry.project._id)}
					<ClubProjectCard
						project={entry.project}
						{status}
						memberPreview={entry.members}
						coverImageUrl={entry.coverImageUrl}
						href={routes.projectDetail(entry.project._id)}
						navigationState={{
							headerTitleHint: entry.project.name,
							headerTitleHintPath: `/project/${entry.project._id}`
						}}
						class={status === 'completed' ? 'border-border/70' : undefined}
					/>
				{/each}
			</AutoFitCardGrid>
		{/if}
	</div>

	<Dialog.Root bind:open={createDialogOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Create project</Dialog.Title>
				<Dialog.Description>Give your project a name to get started.</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-3">
				<div class="flex flex-col gap-2">
					<FieldLabel for="projectName" required>Name</FieldLabel>
					<Input
						id="projectName"
						bind:value={createName}
						placeholder="Enter project name"
						maxlength={PROJECT_NAME_MAX_LENGTH}
						required
					/>
				</div>
				<div class="flex flex-col gap-2">
					<FieldLabel for="projectDescription" required>Description</FieldLabel>
					<Textarea
						id="projectDescription"
						bind:value={createDescription}
						rows={3}
						maxlength={PROJECT_DESCRIPTION_MAX_LENGTH}
						placeholder="Describe the project..."
						required
					/>
				</div>
				<div class="flex flex-col gap-2">
					<FieldLabel for="projectDueDate" required>Due date</FieldLabel>
					<DatePicker id="projectDueDate" bind:value={createDueDate} />
				</div>

				<div
					class="flex items-start justify-between gap-4 rounded-lg border border-border/70 p-3"
				>
					<div class="flex flex-col gap-1">
						<Label for="projectVisibility">{t('projectDetail.visibilityLabel')}</Label>
						<p class="type-sm text-muted-foreground">{t('projectDetail.visibilityExplanation')}</p>
						<p class="type-sm text-muted-foreground">
							{createVisibility === 'global'
								? t('projectDetail.visibilityGlobalOption')
								: t('projectDetail.visibilityClubsOption')}
						</p>
					</div>
					<Switch
						id="projectVisibility"
						checked={createVisibility === 'global'}
						onCheckedChange={(checked: boolean) =>
							(createVisibility = checked ? 'global' : 'clubs')}
						class="mt-1 shrink-0"
					/>
				</div>

				<div class="flex flex-col gap-2">
					<Label for="projectCoverUpload">{t('projectDetail.coverImageLabel')}</Label>
					{#if createCoverField.localPreviewUrl}
						<div class="flex items-center gap-3">
							<img
								src={createCoverField.localPreviewUrl}
								alt=""
								class="h-16 w-16 rounded-md object-cover"
							/>
							<Button variant="outline" size="sm" onclick={removeCreateCover}>
								{t('projectDetail.coverImageRemove')}
							</Button>
						</div>
					{:else}
						<FileDropZone.Root
							accept={createCoverField.accept}
							maxFiles={1}
							fileCount={0}
							maxFileSize={createCoverField.maxBytes}
							disabled={createCoverField.isBusy}
							onUpload={uploadCreateCover}
						>
							<FileDropZone.Trigger>
								<div
									id="projectCoverUpload"
									class="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
								>
									{createCoverField.isBusy
										? t('projectDetail.coverImageUploading')
										: t('projectDetail.coverImageUploadLabel')}
								</div>
							</FileDropZone.Trigger>
						</FileDropZone.Root>
					{/if}
					{#if coverUploadError}
						<p class="type-sm text-destructive">{coverUploadError}</p>
					{/if}
				</div>
			</div>
			{#if createError}
				<p class="type-sm text-destructive">{createError}</p>
			{/if}
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (createDialogOpen = false)}>Cancel</Button>
				<Button
					disabled={createPending ||
						!createName.trim() ||
						!createDescription.trim() ||
						createDueDate === null ||
						createCoverField.isBusy}
					onclick={() => void createProject()}
				>
					{createPending ? 'Creating...' : 'Open'}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
