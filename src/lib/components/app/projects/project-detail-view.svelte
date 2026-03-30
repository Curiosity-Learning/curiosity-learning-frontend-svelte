<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import SendIcon from '@lucide/svelte/icons/send';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import {
		ActionMenu,
		PageHeaderActions,
		PageHeaderBackButton,
		PageHeaderTitle
	} from '$lib/components/app';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent } from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { DatePicker } from '$lib/components/ui/date-picker';
	import { Input } from '$lib/components/ui/input';
	import { FieldLabel } from '$lib/components/ui/field';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		Item,
		ItemActions,
		ItemContent,
		ItemDescription,
		ItemGroup,
		ItemMedia,
		ItemTitle
	} from '$lib/components/ui/item';
	import { createSignedMediaManager } from '$lib/media/signed-media.svelte';
	import { routes } from '$lib/routes';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';

	type Props = {
		view: 'overview' | 'members';
	};

	let { view }: Props = $props();

	const convexClient = useConvexClient();

	let projectIdParam = $derived(
		(page.params as Record<string, string | undefined>).projectId ?? null
	);
	let projectIdTyped = $derived(projectIdParam ? (projectIdParam as Id<'projects'>) : null);

	const projectResponse = useStableQuery(api.projects.getById, () =>
		projectIdTyped ? { projectId: projectIdTyped } : 'skip'
	);
	let project = $derived(projectResponse.data ?? null);
	let headerTitle = $derived(
		project?.name ?? (projectResponse.isLoading || projectResponse.data === undefined ? null : 'Project')
	);

	const canManageResponse = useStableQuery(api.projects.canManageProject, () =>
		projectIdTyped ? { projectId: projectIdTyped } : 'skip'
	);
	let canManage = $derived(canManageResponse.data ?? false);

	const membersResponse = useStableQuery(api.projects.listMembers, () =>
		projectIdTyped ? { projectId: projectIdTyped } : 'skip'
	);

	const updatesResponse = useStableQuery(api.updates.listByProject, () =>
		view === 'overview' && projectIdTyped ? { projectId: projectIdTyped } : 'skip'
	);
	const updateMedia = createSignedMediaManager();

	let pending = $state(false);
	let errorMessage = $state('');

	let editDialogOpen = $state(false);
	let editForm = $state({
		name: '',
		description: '',
		dueDate: null as number | null
	});

	let updateContent = $state('');
	let updatePending = $state(false);

	const toOrdinalDay = (day: number) => {
		const moduloTen = day % 10;
		const moduloHundred = day % 100;
		if (moduloTen === 1 && moduloHundred !== 11) return `${day}st`;
		if (moduloTen === 2 && moduloHundred !== 12) return `${day}nd`;
		if (moduloTen === 3 && moduloHundred !== 13) return `${day}rd`;
		return `${day}th`;
	};

	const formatDateLabel = (timestamp: number) => {
		const date = new Date(timestamp);
		const day = toOrdinalDay(date.getDate());
		const month = date.toLocaleDateString(undefined, { month: 'long' });
		const year = date.toLocaleDateString(undefined, { year: 'numeric' });
		return `${day} ${month}, ${year}`;
	};

	const formatRelativeTime = (timestamp: number) => {
		const now = Date.now();
		const diff = now - timestamp;
		const minutes = Math.floor(diff / 60_000);
		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 7) return `${days}d ago`;
		return new Date(timestamp).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric'
		});
	};

	const initialsFor = (name: string) => {
		const cleaned = name.trim();
		if (!cleaned) return '?';
		const parts = cleaned.split(/\s+/g).filter(Boolean);
		const letters = [parts[0]?.[0] ?? '', parts.at(-1)?.[0] ?? ''].join('').toUpperCase();
		return letters || cleaned.slice(0, 2).toUpperCase();
	};

	let isCompleted = $derived(Boolean(project?.doneDate));
	let statusLabel = $derived.by(() => {
		if (!project) return '';
		if (isCompleted) {
			if (project.doneDate) return `Completed on ${formatDateLabel(project.doneDate)}`;
			return 'Completed';
		}
		return project.dueDate ? `Due by ${formatDateLabel(project.dueDate)}` : 'No due date';
	});

	let memberSummaries = $derived(
		(membersResponse.data ?? []).map((member) => ({
			id: member.projectMemberId,
			name:
				[member.firstName ?? '', member.lastName ?? ''].join(' ').trim() ||
				member.username ||
				member.email ||
				member.profileId,
			imageAssetId: member.profileImageMediaAssetId ?? null,
			imageUrl: null,
			email: member.email ?? null,
			username: member.username ?? null,
			roleName: member.roleName ?? null
		}))
	);
	let initialProjectMemberImageUrls = $derived.by(() => {
		return new Map(
			((page.data.initialProjectMemberImages as Array<{ assetId: Id<'mediaAssets'>; signedUrl: string }> | undefined) ?? []).map(
				(asset) => [asset.assetId, asset.signedUrl] as const
			)
		);
	});

	const memberImageUrl = (member: (typeof memberSummaries)[number]) => {
		if (member.imageAssetId) {
			return initialProjectMemberImageUrls.get(member.imageAssetId) ?? null;
		}

		return null;
	};
	let orderedUpdates = $derived([...(updatesResponse.data ?? [])].reverse());
	let updateMediaAssetIds = $derived.by(() =>
		view === 'overview'
			? [...new Set((updatesResponse.data ?? []).flatMap((update) => update.mediaAssetIds ?? []))]
			: []
	);

	const isVideoAsset = (
		asset: ReturnType<typeof updateMedia.get>
	): asset is NonNullable<ReturnType<typeof updateMedia.get>> =>
		Boolean(asset && (asset.mediaKind === 'video' || asset.contentType?.startsWith('video/')));

	const memberSubtitleFor = (member: (typeof memberSummaries)[number]) => {
		if (member.username) return `@${member.username}`;
		if (member.email) return member.email;
		return null;
	};

	const openEditDialog = () => {
		if (!project) return;
		editForm = {
			name: project.name,
			description: project.description ?? '',
			dueDate: project.dueDate ?? null
		};
		editDialogOpen = true;
	};

	const saveProject = async () => {
		if (!project) return;
		if (!editForm.name.trim()) {
			errorMessage = 'Project name is required.';
			return;
		}
		if (editForm.dueDate === null) {
			errorMessage = 'Due date is required.';
			return;
		}

		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.projects.update, {
				projectId: project._id,
				name: editForm.name.trim(),
				description: editForm.description.trim() || undefined,
				dueDate: editForm.dueDate
			});
			editDialogOpen = false;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to update project.';
		} finally {
			pending = false;
		}
	};

	const toggleDone = async () => {
		if (!project) return;
		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.projects.update, {
				projectId: project._id,
				doneDate: isCompleted ? undefined : Date.now()
			});
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to update project status.';
		} finally {
			pending = false;
		}
	};

	const postUpdate = async () => {
		if (!projectIdTyped || !updateContent.trim()) return;
		updatePending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.updates.create, {
				projectId: projectIdTyped,
				content: updateContent.trim()
			});
			updateContent = '';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to post update.';
		} finally {
			updatePending = false;
		}
	};

	let projectActionItems = $derived([
		{
			id: 'edit-project',
			label: 'Edit details',
			Icon: PencilIcon,
			disabled: !canManage,
			onSelect: openEditDialog
		},
		{
			id: 'toggle-done',
			label: isCompleted ? 'Mark as not done' : 'Mark as done',
			Icon: isCompleted ? CircleIcon : CircleCheckIcon,
			disabled: !canManage,
			onSelect: () => void toggleDone()
		}
	]);

	$effect(() => {
		if (view !== 'overview' || !projectIdTyped || !updateMediaAssetIds.length) {
			updateMedia.clear();
			return;
		}

		void updateMedia.track(updateMediaAssetIds, {
			kind: 'project',
			projectId: projectIdTyped
		});
	});

	$effect(() => {
		return () => {
			updateMedia.destroy();
		};
	});
</script>

<PageHeaderBackButton fallbackHref={routes.feed} />
{#if headerTitle}
	<PageHeaderTitle title={headerTitle} />
{/if}
<PageHeaderActions>
	<ActionMenu items={projectActionItems} ariaLabel="Open project actions" />
</PageHeaderActions>

{#if !projectIdTyped}
	<Alert variant="destructive">
		<AlertTitle>Invalid project</AlertTitle>
		<AlertDescription>This project ID is not valid.</AlertDescription>
	</Alert>
{:else if projectResponse.isLoading}
	<p class="type-sm text-muted-foreground">Loading project...</p>
{:else if !project}
	<Alert variant="destructive">
		<AlertTitle>Project not found</AlertTitle>
		<AlertDescription>The requested project could not be loaded.</AlertDescription>
	</Alert>
{:else}
	<div class="flex flex-col gap-6 pb-8">
		{#if errorMessage}
			<Alert variant="destructive">
				<AlertTitle>Action failed</AlertTitle>
				<AlertDescription>{errorMessage}</AlertDescription>
			</Alert>
		{/if}

		{#if view === 'overview'}
			{#if project.description}
				<p class="type-lead text-muted-foreground">{project.description}</p>
			{:else}
				<p class="type-lead text-muted-foreground">No description yet.</p>
			{/if}

			<div class="type-lead flex items-center gap-2 text-muted-foreground">
				{#if isCompleted}
					<CheckIcon class="size-5 text-chart-2" />
				{:else}
					<CalendarIcon class="size-5 text-primary" />
				{/if}
				<p>{statusLabel}</p>
				{#if isCompleted}
					<Badge variant="secondary" class="bg-chart-2/15 text-chart-2">Done</Badge>
				{/if}
			</div>

			<div class="flex flex-col gap-4">
				<p class="type-body-medium">Updates</p>

				{#if canManage}
					<div class="flex gap-3">
						<Textarea
							bind:value={updateContent}
							placeholder="Post an update..."
							rows={2}
							class="flex-1 resize-none"
						/>
						<Button
							size="icon"
							variant="ghost"
							disabled={updatePending || !updateContent.trim()}
							onclick={() => void postUpdate()}
							aria-label="Post update"
						>
							<SendIcon class="size-5" />
						</Button>
					</div>
				{/if}

				{#if updatesResponse.isLoading}
					<p class="type-sm text-muted-foreground">Loading updates...</p>
				{:else if (updatesResponse.data ?? []).length === 0}
					<p class="type-sm text-muted-foreground">No updates yet.</p>
				{:else}
					<div class="flex flex-col gap-3">
						{#each orderedUpdates as update (update._id)}
							<Card class="gap-0 py-0">
								<CardContent class="flex flex-col gap-2 p-4">
									<p class="type-body whitespace-pre-wrap">{update.content}</p>
									{#if update.mediaAssetIds?.length}
										<div class="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
											{#each update.mediaAssetIds as mediaAssetId (mediaAssetId)}
												{@const mediaAsset = updateMedia.get(mediaAssetId)}
												{@const mediaUrl = mediaAsset?.signedUrl ?? null}
												<div class="overflow-hidden rounded-xl border border-border bg-muted/20">
													{#if mediaUrl}
														{#if isVideoAsset(mediaAsset)}
															<!-- svelte-ignore a11y_media_has_caption -->
															<video
																src={mediaUrl}
																controls
																preload="metadata"
																class="aspect-video w-full bg-black object-cover"
															></video>
														{:else}
															<img
																src={mediaUrl}
																alt="Project update attachment"
																class="aspect-video w-full object-cover"
															/>
														{/if}
													{:else}
														<div class="flex aspect-video items-center justify-center p-4">
															<p class="text-sm text-muted-foreground">
																Preparing media...
															</p>
														</div>
													{/if}
												</div>
											{/each}
										</div>
									{/if}
									<p class="type-sm text-muted-foreground">
										{formatRelativeTime(update.createdAt)}
									</p>
								</CardContent>
							</Card>
						{/each}
					</div>
				{/if}

				{#if updateMedia.errorMessage}
					<Alert variant="destructive">
						<AlertTitle>Media refresh failed</AlertTitle>
						<AlertDescription>{updateMedia.errorMessage}</AlertDescription>
					</Alert>
				{/if}
			</div>
		{:else}
			<div class="flex flex-col gap-4">
				{#if membersResponse.isLoading}
					<p class="type-sm text-muted-foreground">Loading members...</p>
				{:else if memberSummaries.length === 0}
					<p class="type-sm text-muted-foreground">No members yet.</p>
				{:else}
					<ItemGroup class="gap-2">
						{#each memberSummaries as member (member.id)}
							<Item variant="outline" size="sm">
								<ItemMedia>
									<Avatar class="size-8">
										{#if memberImageUrl(member)}
											<AvatarImage src={memberImageUrl(member) ?? undefined} alt={member.name} />
										{/if}
										<AvatarFallback class="type-caption-bold"
											>{initialsFor(member.name)}</AvatarFallback
										>
									</Avatar>
								</ItemMedia>
								<ItemContent>
									<ItemTitle class="w-full truncate">{member.name}</ItemTitle>
									{#if memberSubtitleFor(member)}
										<ItemDescription class="line-clamp-1 w-full"
											>{memberSubtitleFor(member)}</ItemDescription
										>
									{/if}
								</ItemContent>
								{#if member.roleName}
									<ItemActions>
										<Badge variant="outline">{member.roleName}</Badge>
									</ItemActions>
								{/if}
							</Item>
						{/each}
					</ItemGroup>
				{/if}
			</div>
		{/if}
	</div>

	<Dialog.Root bind:open={editDialogOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>Edit project details</Dialog.Title>
				<Dialog.Description>Update the project name, description, and due date.</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-3">
				<div class="flex flex-col gap-2">
					<FieldLabel for="editProjectName" required>Name</FieldLabel>
					<Input
						id="editProjectName"
						bind:value={editForm.name}
						placeholder="Project name"
						required
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="editProjectDescription">Description</Label>
					<Textarea
						id="editProjectDescription"
						bind:value={editForm.description}
						rows={3}
						placeholder="Describe the project..."
					/>
				</div>
				<div class="flex flex-col gap-2">
					<FieldLabel for="editProjectDueDate" required>Due date</FieldLabel>
					<DatePicker id="editProjectDueDate" bind:value={editForm.dueDate} />
				</div>
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (editDialogOpen = false)}>Cancel</Button>
				<Button
					disabled={pending || !editForm.name.trim() || editForm.dueDate === null}
					onclick={() => void saveProject()}
				>
					{pending ? 'Saving...' : 'Save'}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
