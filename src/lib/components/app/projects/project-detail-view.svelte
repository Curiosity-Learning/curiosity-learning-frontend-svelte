<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import CheckIcon from '@lucide/svelte/icons/check';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import SendIcon from '@lucide/svelte/icons/send';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import {
		ActionMenu,
		LoadingState,
		PageHeaderActions,
		PageHeaderBackButton,
		PageHeaderTitle,
		UpdateCard
	} from '$lib/components/app';
	import type { UpdateCardMediaItem } from '$lib/components/app/feed/update-card.svelte';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
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
	import { routes } from '$lib/routes';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { _, t } from '$lib/i18n';

	type Props = {
		view: 'overview' | 'members';
	};

	type SignedProjectUpdateMedia = {
		assetId: Id<'mediaAssets'>;
		signedUrl: string;
		mediaKind: 'image' | 'video' | null;
		contentType: string | null;
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
		project?.name ??
			(projectResponse.isLoading || projectResponse.data === undefined ? null : 'Project')
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

	const changeLogResponse = useStableQuery(api.projects.listChangeLog, () =>
		view === 'overview' && projectIdTyped ? { projectId: projectIdTyped } : 'skip'
	);

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

	let imDoneDialogOpen = $state(false);
	let imDonePending = $state(false);
	let leaveDialogOpen = $state(false);
	let leavePending = $state(false);

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

	const initialsFor = (name: string) => {
		const cleaned = name.trim();
		if (!cleaned) return '?';
		const parts = cleaned.split(/\s+/g).filter(Boolean);
		const letters = [parts[0]?.[0] ?? '', parts.at(-1)?.[0] ?? ''].join('').toUpperCase();
		return letters || cleaned.slice(0, 2).toUpperCase();
	};

	const meResponse = useStableQuery(api.profiles.getMe, {});

	let isCompleted = $derived(Boolean(project?.archivedAt));
	let statusLabel = $derived.by(() => {
		if (!project) return '';
		if (isCompleted) {
			if (project.archivedAt) return `Completed on ${formatDateLabel(project.archivedAt)}`;
			return 'Completed';
		}
		return project.dueDate ? `Due by ${formatDateLabel(project.dueDate)}` : 'No due date';
	});

	let memberSummaries = $derived(
		(membersResponse.data ?? []).map((member) => ({
			id: member.projectMemberId,
			profileId: member.profileId,
			name:
				[member.firstName ?? '', member.lastName ?? ''].join(' ').trim() ||
				member.username ||
				'Project member',
			imageAssetId: member.profileImageMediaAssetId ?? null,
			imageUrl: null,
			username: member.username ?? null,
			roleName: member.roleName ?? null,
			state: member.state
		}))
	);

	let viewerMembership = $derived.by(() => {
		const viewerProfileId = meResponse.data?._id;
		if (!viewerProfileId) return null;
		return memberSummaries.find((member) => member.profileId === viewerProfileId) ?? null;
	});
	let viewerIsDone = $derived(viewerMembership?.state === 'done');
	let viewerIsActiveMember = $derived(viewerMembership?.state === 'active');
	let initialProjectMemberImageUrls = $derived.by(() => {
		return new Map(
			(
				(page.data.initialProjectMemberImages as
					| Array<{ assetId: Id<'mediaAssets'>; signedUrl: string }>
					| undefined) ?? []
			).map((asset) => [asset.assetId, asset.signedUrl] as const)
		);
	});

	const memberImageUrl = (member: (typeof memberSummaries)[number]) => {
		if (member.imageAssetId) {
			return initialProjectMemberImageUrls.get(member.imageAssetId) ?? null;
		}

		return null;
	};
	let initialProjectUpdateMedia = $derived(
		(page.data.initialProjectUpdateMedia as Array<SignedProjectUpdateMedia> | undefined) ?? []
	);
	let initialProjectUpdateMediaById = $derived.by(() => {
		return new Map(initialProjectUpdateMedia.map((asset) => [asset.assetId, asset] as const));
	});

	let orderedUpdates = $derived.by(() => {
		return [...(updatesResponse.data ?? [])].reverse().map((update) => ({
			...update,
			authorImageUrl: update.authorImageAssetId
				? (initialProjectMemberImageUrls.get(update.authorImageAssetId) ?? null)
				: null,
			media: (update.mediaAssetIds ?? []).map((assetId): UpdateCardMediaItem => {
				const asset = initialProjectUpdateMediaById.get(assetId) ?? null;
				const isVideo = asset?.mediaKind === 'video' || asset?.contentType?.startsWith('video/');
				return {
					assetId,
					kind: isVideo ? 'video' : 'image',
					url: asset?.signedUrl ?? null
				};
			})
		}));
	});

	const memberSubtitleFor = (member: (typeof memberSummaries)[number]) => {
		if (member.username) return `@${member.username}`;
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

	const openImDoneDialog = () => {
		imDoneDialogOpen = true;
	};

	const confirmImDone = async () => {
		if (!projectIdTyped) return;
		imDonePending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.projects.markSelfDone, { projectId: projectIdTyped });
			imDoneDialogOpen = false;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('projectDetail.imDoneFailure');
		} finally {
			imDonePending = false;
		}
	};

	const openLeaveDialog = () => {
		leaveDialogOpen = true;
	};

	const confirmLeave = async () => {
		if (!projectIdTyped) return;
		leavePending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.projects.leaveProject, { projectId: projectIdTyped });
			leaveDialogOpen = false;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('projectDetail.leaveProjectFailure');
		} finally {
			leavePending = false;
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
			disabled: !canManage || viewerIsDone,
			onSelect: openEditDialog
		},
		...(viewerIsActiveMember
			? [
					{
						id: 'im-done',
						label: t('projectDetail.imDoneAction'),
						Icon: CheckIcon,
						disabled: false,
						onSelect: openImDoneDialog
					},
					{
						id: 'leave-project',
						label: t('projectDetail.leaveProjectAction'),
						Icon: LogOutIcon,
						disabled: false,
						onSelect: openLeaveDialog
					}
				]
			: [])
	]);

	let orderedChangeLog = $derived([...(changeLogResponse.data ?? [])].reverse());
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
	<LoadingState label="Loading project" />
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

				{#if canManage && viewerIsDone}
					<p class="type-sm text-muted-foreground">{$_('projectDetail.doneMemberEditNotice')}</p>
				{:else if canManage}
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
					<LoadingState label="Loading updates" />
				{:else if (updatesResponse.data ?? []).length === 0}
					<div class="rounded-2xl border border-dashed border-border/80 bg-card px-4 py-6 text-center">
						<p class="type-sm text-muted-foreground">No updates yet.</p>
					</div>
				{:else}
					<div class="flex flex-col gap-3">
						{#each orderedUpdates as update (update._id)}
							<UpdateCard
								authorName={update.authorName}
								authorImageUrl={update.authorImageUrl}
								createdAt={update.createdAt}
								content={update.content}
								media={update.media}
								showProjectContext={false}
							/>
						{/each}
					</div>
				{/if}
			</div>

			<div class="flex flex-col gap-4">
				<p class="type-body-medium">{$_('projectDetail.activityTitle')}</p>
				{#if changeLogResponse.isLoading}
					<LoadingState label={$_('projectDetail.activityTitle')} />
				{:else if orderedChangeLog.length === 0}
					<p class="type-sm text-muted-foreground">{$_('projectDetail.activityEmpty')}</p>
				{:else}
					<div class="flex flex-col gap-2">
						{#each orderedChangeLog as entry (entry._id)}
							<UpdateCard
								variant="system"
								createdAt={entry.createdAt}
								content={entry.text}
								showProjectContext={false}
							/>
						{/each}
					</div>
				{/if}
			</div>
		{:else}
			<div class="flex flex-col gap-4">
				{#if membersResponse.isLoading}
					<LoadingState label="Loading members" />
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
								<ItemActions>
									{#if member.state === 'done'}
										<Badge variant="secondary" class="bg-chart-2/15 text-chart-2"
											>{$_('projectDetail.memberStateDone')}</Badge
										>
									{/if}
									{#if member.roleName}
										<Badge variant="outline">{member.roleName}</Badge>
									{/if}
								</ItemActions>
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

	<Dialog.Root bind:open={imDoneDialogOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>{$_('projectDetail.imDoneDialogTitle')}</Dialog.Title>
				<Dialog.Description>{$_('projectDetail.imDoneDialogDescription')}</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (imDoneDialogOpen = false)}>
					{$_('projectDetail.imDoneCancelAction')}
				</Button>
				<Button disabled={imDonePending} onclick={() => void confirmImDone()}>
					{imDonePending ? t('common.saving') : $_('projectDetail.imDoneConfirmAction')}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={leaveDialogOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>{$_('projectDetail.leaveProjectDialogTitle')}</Dialog.Title>
				<Dialog.Description>{$_('projectDetail.leaveProjectDialogDescription')}</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (leaveDialogOpen = false)}>
					{$_('projectDetail.leaveProjectCancelAction')}
				</Button>
				<Button
					variant="destructive"
					disabled={leavePending}
					onclick={() => void confirmLeave()}
				>
					{leavePending ? t('common.saving') : $_('projectDetail.leaveProjectConfirmAction')}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
