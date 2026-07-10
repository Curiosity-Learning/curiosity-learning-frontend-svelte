<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import CheckIcon from '@lucide/svelte/icons/check';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import SendIcon from '@lucide/svelte/icons/send';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import { onDestroy } from 'svelte';
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
	import * as FileDropZone from '$lib/components/ui/file-drop-zone';
	import { Input } from '$lib/components/ui/input';
	import { FieldLabel } from '$lib/components/ui/field';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
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
	import { createMediaField } from '$lib/media/media-field.svelte';
	import { createDebouncedLookup } from '$lib/forms/debounced-lookup';
	import { routes } from '$lib/routes';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { _, formatT, t } from '$lib/i18n';

	const PROJECT_NAME_MAX_LENGTH = 50;
	const PROJECT_DESCRIPTION_MAX_LENGTH = 500;

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

	// PRD 5.11/6.6.6: per-member club attribution — attributed clubs, which of those the viewer
	// personally linked, and the viewer's own current clubs (for link/unlink controls).
	const attributionsResponse = useStableQuery(api.projects.listAttributions, () =>
		view === 'overview' && projectIdTyped ? { projectId: projectIdTyped } : 'skip'
	);
	let attributedClubs = $derived(attributionsResponse.data?.attributedClubs ?? []);
	let viewerClubs = $derived(attributionsResponse.data?.viewerClubs ?? []);
	let viewerCanChangeAttribution = $derived(
		attributionsResponse.data?.viewerCanChangeAttribution ?? false
	);
	let attributionPendingClubId = $state<Id<'clubs'> | null>(null);

	let pending = $state(false);
	let errorMessage = $state('');

	let editDialogOpen = $state(false);
	let editForm = $state({
		name: '',
		description: '',
		dueDate: null as number | null,
		visibility: 'clubs' as 'clubs' | 'global'
	});

	// PRD 6.6.3: cover image is editable by any active member, independent of the edit dialog's
	// other fields — uploads immediately, then attaches on save alongside the rest of the form.
	const editCoverField = createMediaField(convexClient, 'projectCover', { mode: 'immediate' });
	let editCoverUploadError = $state('');
	let editCoverRemoved = $state(false);

	onDestroy(() => {
		editCoverField.destroy();
	});

	const uploadEditCover = async (files: File[]) => {
		editCoverUploadError = '';
		try {
			await editCoverField.selectFiles(files);
			if (!editCoverField.isReady || !editCoverField.assetId) {
				throw new Error(editCoverField.errorMessage || 'Failed to upload cover image.');
			}
			editCoverRemoved = false;
		} catch (error) {
			editCoverUploadError =
				error instanceof Error ? error.message : 'Failed to upload cover image.';
		}
	};

	const removeEditCover = () => {
		editCoverField.clear();
		editCoverUploadError = '';
		editCoverRemoved = true;
	};

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
	// PRD 6.6.10/CL-722: viewer can view the project (canViewProject-gated) but has no
	// membership row at all — eligible to request to join or see an invite banner.
	let viewerIsNonMember = $derived(!viewerMembership);

	// --- CL-722: invites ---
	const pendingInvitesResponse = useStableQuery(api.projectInvites.listPendingInvites, () =>
		projectIdTyped && viewerIsActiveMember ? { projectId: projectIdTyped } : 'skip'
	);
	const myInviteResponse = useStableQuery(api.projectInvites.getMyInviteForProject, () =>
		projectIdTyped && viewerIsNonMember ? { projectId: projectIdTyped } : 'skip'
	);
	let myPendingInvite = $derived(
		myInviteResponse.data?.status === 'pending' ? myInviteResponse.data : null
	);

	let inviteDialogOpen = $state(false);
	let inviteSearchTerm = $state('');
	let inviteSearchResults = $state<
		Array<{ profileId: Id<'profiles'>; firstName: string | null; lastName: string | null; username: string | null }>
	>([]);
	let inviteSearchPending = $state(false);
	let invitePending = $state<Id<'profiles'> | null>(null);
	let inviteCancelPending = $state<Id<'projectInvites'> | null>(null);
	let inviteDecisionPending = $state(false);
	const inviteSearchLookup = createDebouncedLookup<typeof inviteSearchResults>(300);

	const openInviteDialog = () => {
		inviteSearchTerm = '';
		inviteSearchResults = [];
		inviteDialogOpen = true;
	};

	$effect(() => {
		const term = inviteSearchTerm.trim();
		inviteSearchLookup.stop();
		if (!term) {
			inviteSearchResults = [];
			inviteSearchPending = false;
			return;
		}
		const excludeIds = memberSummaries.map((member) => member.profileId);
		inviteSearchLookup.schedule({
			key: term,
			onStart: () => {
				inviteSearchPending = true;
			},
			lookup: () =>
				convexClient.query(api.profiles.searchByUsername, {
					usernamePrefix: term,
					excludeProfileIds: excludeIds
				}),
			onSuccess: (results) => {
				inviteSearchResults = results;
				inviteSearchPending = false;
			},
			onError: () => {
				inviteSearchResults = [];
				inviteSearchPending = false;
			}
		});
		return () => inviteSearchLookup.stop();
	});

	const sendInvite = async (inviteeProfileId: Id<'profiles'>) => {
		if (!projectIdTyped) return;
		invitePending = inviteeProfileId;
		errorMessage = '';
		try {
			await convexClient.mutation(api.projectInvites.inviteMember, {
				projectId: projectIdTyped,
				inviteeProfileId
			});
			inviteDialogOpen = false;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('projectDetail.inviteSendFailure');
		} finally {
			invitePending = null;
		}
	};

	const cancelInvite = async (inviteId: Id<'projectInvites'>) => {
		inviteCancelPending = inviteId;
		errorMessage = '';
		try {
			await convexClient.mutation(api.projectInvites.cancelInvite, { inviteId });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('projectDetail.cancelInviteFailure');
		} finally {
			inviteCancelPending = null;
		}
	};

	const acceptMyInvite = async () => {
		if (!myPendingInvite) return;
		inviteDecisionPending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.projectInvites.acceptInvite, { inviteId: myPendingInvite._id });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('projectDetail.inviteDecisionFailure');
		} finally {
			inviteDecisionPending = false;
		}
	};

	const declineMyInvite = async () => {
		if (!myPendingInvite) return;
		inviteDecisionPending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.projectInvites.declineInvite, { inviteId: myPendingInvite._id });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('projectDetail.inviteDecisionFailure');
		} finally {
			inviteDecisionPending = false;
		}
	};

	// --- CL-722: join requests ---
	const myRequestResponse = useStableQuery(api.projectJoinRequests.getMyRequestForProject, () =>
		projectIdTyped && viewerIsNonMember ? { projectId: projectIdTyped } : 'skip'
	);
	let myPendingRequest = $derived(
		myRequestResponse.data?.status === 'pending' ? myRequestResponse.data : null
	);
	const pendingRequestsResponse = useStableQuery(api.projectJoinRequests.listPendingRequests, () =>
		projectIdTyped && viewerIsActiveMember ? { projectId: projectIdTyped } : 'skip'
	);

	let requestToJoinPending = $state(false);
	let requestCancelPending = $state(false);
	let requestDecisionPending = $state<Id<'projectJoinRequests'> | null>(null);

	const sendJoinRequest = async () => {
		if (!projectIdTyped) return;
		requestToJoinPending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.projectJoinRequests.requestToJoin, { projectId: projectIdTyped });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('projectDetail.requestToJoinFailure');
		} finally {
			requestToJoinPending = false;
		}
	};

	const cancelMyRequest = async () => {
		if (!myPendingRequest) return;
		requestCancelPending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.projectJoinRequests.cancelRequest, {
				requestId: myPendingRequest._id
			});
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('projectDetail.cancelRequestFailure');
		} finally {
			requestCancelPending = false;
		}
	};

	const acceptJoinRequest = async (requestId: Id<'projectJoinRequests'>) => {
		requestDecisionPending = requestId;
		errorMessage = '';
		try {
			await convexClient.mutation(api.projectJoinRequests.acceptRequest, { requestId });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('projectDetail.requestDecisionFailure');
		} finally {
			requestDecisionPending = null;
		}
	};

	const declineJoinRequest = async (requestId: Id<'projectJoinRequests'>) => {
		requestDecisionPending = requestId;
		errorMessage = '';
		try {
			await convexClient.mutation(api.projectJoinRequests.declineRequest, { requestId });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('projectDetail.requestDecisionFailure');
		} finally {
			requestDecisionPending = null;
		}
	};
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
	// PRD 6.6.3: cover image appears at the top of the project page. Falls back to nothing
	// (graceful without) when the project has no cover, the asset isn't ready, or it can't be
	// resolved for the current viewer.
	let coverImageUrl = $derived.by(() => {
		if (!project?.coverImageMediaAssetId) return null;
		const assets =
			(page.data.initialProjectCoverImage as
				| { assetId: Id<'mediaAssets'>; signedUrl: string }
				| undefined
				| null) ?? null;
		return assets && assets.assetId === project.coverImageMediaAssetId ? assets.signedUrl : null;
	});

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
			dueDate: project.dueDate ?? null,
			visibility: project.visibility
		};
		editCoverField.clear();
		editCoverUploadError = '';
		editCoverRemoved = false;
		editDialogOpen = true;
	};

	const saveProject = async () => {
		if (!project) return;
		if (!editForm.name.trim()) {
			errorMessage = 'Project name is required.';
			return;
		}
		if (!editForm.description.trim()) {
			errorMessage = t('projectDetail.descriptionRequiredError');
			return;
		}
		if (editForm.dueDate === null) {
			errorMessage = 'Due date is required.';
			return;
		}

		pending = true;
		errorMessage = '';
		try {
			const newCoverAssetId = await editCoverField.ensureUploaded();
			await convexClient.mutation(api.projects.update, {
				projectId: project._id,
				name: editForm.name.trim(),
				description: editForm.description.trim() || undefined,
				dueDate: editForm.dueDate,
				visibility: editForm.visibility,
				coverImageMediaAssetId: newCoverAssetId ?? (editCoverRemoved ? null : undefined)
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

	const toggleClubAttribution = async (clubId: Id<'clubs'>, currentlyLinked: boolean) => {
		if (!projectIdTyped) return;
		attributionPendingClubId = clubId;
		errorMessage = '';
		try {
			if (currentlyLinked) {
				await convexClient.mutation(api.projects.unlinkClub, { projectId: projectIdTyped, clubId });
			} else {
				await convexClient.mutation(api.projects.linkClub, { projectId: projectIdTyped, clubId });
			}
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : t('projectDetail.attributionUpdateFailure');
		} finally {
			attributionPendingClubId = null;
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
						id: 'invite-member',
						label: t('projectDetail.inviteMemberAction'),
						Icon: UserPlusIcon,
						disabled: false,
						onSelect: openInviteDialog
					},
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

		{#if myPendingInvite}
			<Alert>
				<AlertTitle>{t('projectDetail.yourInviteBannerTitle')}</AlertTitle>
				<AlertDescription class="flex flex-col gap-3">
					<p>
						{formatT('projectDetail.yourInviteBannerDescription', {
							inviterName: myInviteResponse.data?.inviterName ?? 'A member'
						})}
					</p>
					<div class="flex gap-2">
						<Button size="sm" disabled={inviteDecisionPending} onclick={() => void acceptMyInvite()}>
							{t('projectDetail.acceptInviteAction')}
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={inviteDecisionPending}
							onclick={() => void declineMyInvite()}
						>
							{t('projectDetail.declineInviteAction')}
						</Button>
					</div>
				</AlertDescription>
			</Alert>
		{/if}

		{#if viewerIsNonMember && !myPendingInvite}
			{#if myPendingRequest}
				<div class="flex items-center justify-between gap-3 rounded-lg border border-border/70 p-3">
					<p class="type-sm text-muted-foreground">{t('projectDetail.requestPendingLabel')}</p>
					<Button
						size="sm"
						variant="outline"
						disabled={requestCancelPending}
						onclick={() => void cancelMyRequest()}
					>
						{t('projectDetail.cancelRequestAction')}
					</Button>
				</div>
			{:else}
				<div>
					<Button
						size="sm"
						disabled={requestToJoinPending}
						onclick={() => void sendJoinRequest()}
					>
						{requestToJoinPending
							? t('projectDetail.requestToJoinSending')
							: t('projectDetail.requestToJoinAction')}
					</Button>
				</div>
			{/if}
		{/if}

		{#if viewerIsActiveMember && (pendingRequestsResponse.data ?? []).length > 0}
			<div class="flex flex-col gap-2 rounded-lg border border-border/70 p-3">
				<p class="type-body-medium">{t('projectDetail.joinRequestsTitle')}</p>
				{#each pendingRequestsResponse.data ?? [] as request (request.requestId)}
					<div class="flex items-center justify-between gap-3">
						<p class="type-sm">{request.requesterName}</p>
						<div class="flex gap-2">
							<Button
								size="sm"
								disabled={requestDecisionPending === request.requestId}
								onclick={() => void acceptJoinRequest(request.requestId)}
							>
								{t('projectDetail.acceptRequestAction')}
							</Button>
							<Button
								size="sm"
								variant="outline"
								disabled={requestDecisionPending === request.requestId}
								onclick={() => void declineJoinRequest(request.requestId)}
							>
								{t('projectDetail.declineRequestAction')}
							</Button>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if viewerIsActiveMember && (pendingInvitesResponse.data ?? []).length > 0}
			<div class="flex flex-col gap-2 rounded-lg border border-border/70 p-3">
				<p class="type-body-medium">{t('projectDetail.pendingInvitesTitle')}</p>
				{#each pendingInvitesResponse.data ?? [] as invite (invite.inviteId)}
					<div class="flex items-center justify-between gap-3">
						<p class="type-sm">{invite.inviteeName}</p>
						<Button
							size="sm"
							variant="outline"
							disabled={inviteCancelPending === invite.inviteId}
							onclick={() => void cancelInvite(invite.inviteId)}
						>
							{t('projectDetail.cancelInviteAction')}
						</Button>
					</div>
				{/each}
			</div>
		{/if}

		{#if view === 'overview'}
			{#if coverImageUrl}
				<img
					src={coverImageUrl}
					alt=""
					class="h-48 w-full rounded-2xl object-cover sm:h-64"
				/>
			{/if}

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

			<div class="flex flex-col gap-2">
				<p class="type-body-medium">{t('projectDetail.clubsTitle')}</p>
				{#if attributedClubs.length === 0}
					<p class="type-sm text-muted-foreground">{t('projectDetail.clubsEmpty')}</p>
				{:else}
					<div class="flex flex-wrap gap-2">
						{#each attributedClubs as club (club.clubId)}
							<Badge variant="outline">{club.name}</Badge>
						{/each}
					</div>
				{/if}

				{#if viewerCanChangeAttribution && viewerClubs.length > 0}
					<div class="mt-1 flex flex-col gap-1">
						{#each viewerClubs as club (club.clubId)}
							<div class="flex items-center justify-between gap-3">
								<p class="type-sm">{club.name}</p>
								<Button
									variant="outline"
									size="sm"
									disabled={attributionPendingClubId === club.clubId}
									onclick={() => void toggleClubAttribution(club.clubId, club.linkedByViewer)}
								>
									{club.linkedByViewer
										? t('projectDetail.unlinkClubAction')
										: t('projectDetail.linkClubAction')}
								</Button>
							</div>
						{/each}
					</div>
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
								updateId={update._id}
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
						maxlength={PROJECT_NAME_MAX_LENGTH}
						required
					/>
				</div>
				<div class="flex flex-col gap-2">
					<FieldLabel for="editProjectDescription" required>Description</FieldLabel>
					<Textarea
						id="editProjectDescription"
						bind:value={editForm.description}
						rows={3}
						maxlength={PROJECT_DESCRIPTION_MAX_LENGTH}
						placeholder="Describe the project..."
						required
					/>
				</div>
				<div class="flex flex-col gap-2">
					<FieldLabel for="editProjectDueDate" required>Due date</FieldLabel>
					<DatePicker id="editProjectDueDate" bind:value={editForm.dueDate} />
				</div>

				<div
					class="flex items-start justify-between gap-4 rounded-lg border border-border/70 p-3"
				>
					<div class="flex flex-col gap-1">
						<Label for="editProjectVisibility">{t('projectDetail.visibilityLabel')}</Label>
						<p class="type-sm text-muted-foreground">{t('projectDetail.visibilityExplanation')}</p>
						<p class="type-sm text-muted-foreground">
							{editForm.visibility === 'global'
								? t('projectDetail.visibilityGlobalOption')
								: t('projectDetail.visibilityClubsOption')}
						</p>
					</div>
					<Switch
						id="editProjectVisibility"
						checked={editForm.visibility === 'global'}
						onCheckedChange={(checked: boolean) =>
							(editForm.visibility = checked ? 'global' : 'clubs')}
						class="mt-1 shrink-0"
					/>
				</div>

				<div class="flex flex-col gap-2">
					<Label for="editProjectCoverUpload">{t('projectDetail.coverImageLabel')}</Label>
					{#if editCoverField.localPreviewUrl}
						<div class="flex items-center gap-3">
							<img
								src={editCoverField.localPreviewUrl}
								alt=""
								class="h-16 w-16 rounded-md object-cover"
							/>
							<Button variant="outline" size="sm" onclick={removeEditCover}>
								{t('projectDetail.coverImageRemove')}
							</Button>
						</div>
					{:else if coverImageUrl && !editCoverRemoved}
						<div class="flex items-center gap-3">
							<img src={coverImageUrl} alt="" class="h-16 w-16 rounded-md object-cover" />
							<Button variant="outline" size="sm" onclick={removeEditCover}>
								{t('projectDetail.coverImageRemove')}
							</Button>
						</div>
					{:else}
						<FileDropZone.Root
							accept={editCoverField.accept}
							maxFiles={1}
							fileCount={0}
							maxFileSize={editCoverField.maxBytes}
							disabled={editCoverField.isBusy}
							onUpload={uploadEditCover}
						>
							<FileDropZone.Trigger>
								<div
									id="editProjectCoverUpload"
									class="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
								>
									{editCoverField.isBusy
										? t('projectDetail.coverImageUploading')
										: t('projectDetail.coverImageUploadLabel')}
								</div>
							</FileDropZone.Trigger>
						</FileDropZone.Root>
					{/if}
					{#if editCoverUploadError}
						<p class="type-sm text-destructive">{editCoverUploadError}</p>
					{/if}
				</div>
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (editDialogOpen = false)}>Cancel</Button>
				<Button
					disabled={pending ||
						!editForm.name.trim() ||
						!editForm.description.trim() ||
						editForm.dueDate === null ||
						editCoverField.isBusy}
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

	<Dialog.Root bind:open={inviteDialogOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>{t('projectDetail.inviteDialogTitle')}</Dialog.Title>
				<Dialog.Description>{t('projectDetail.inviteDialogDescription')}</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-3">
				<Input
					bind:value={inviteSearchTerm}
					placeholder={t('projectDetail.inviteSearchPlaceholder')}
				/>
				{#if inviteSearchPending}
					<LoadingState label="Searching" />
				{:else if inviteSearchTerm.trim() && inviteSearchResults.length === 0}
					<p class="type-sm text-muted-foreground">{t('projectDetail.inviteSearchNoResults')}</p>
				{:else}
					<ItemGroup class="gap-2">
						{#each inviteSearchResults as result (result.profileId)}
							<Item variant="outline" size="sm">
								<ItemContent>
									<ItemTitle>
										{[result.firstName ?? '', result.lastName ?? ''].join(' ').trim() ||
											result.username ||
											'User'}
									</ItemTitle>
									{#if result.username}
										<ItemDescription>@{result.username}</ItemDescription>
									{/if}
								</ItemContent>
								<ItemActions>
									<Button
										size="sm"
										disabled={invitePending === result.profileId}
										onclick={() => void sendInvite(result.profileId)}
									>
										{invitePending === result.profileId
											? t('projectDetail.inviteSendingAction')
											: t('projectDetail.inviteSendAction')}
									</Button>
								</ItemActions>
							</Item>
						{/each}
					</ItemGroup>
				{/if}
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (inviteDialogOpen = false)}>Cancel</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
