<script lang="ts">
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
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import { Textarea } from '$lib/components/ui/textarea';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { formatDateTime } from '$lib/domain/date';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { page } from '$app/state';
	import { profileReady } from '$lib/app/client-init';

	const convexClient = useConvexClient();

	const clubsResponse = useQuery(api.clubs.getMyClubs, () => ($profileReady ? {} : 'skip'));
	let clubId = $derived((page.params as Record<string, string | undefined>).clubId ?? null);
	let clubItem = $derived(
		clubId ? (clubsResponse.data ?? []).find((club) => club.clubId === clubId) ?? null : null
	);
	let clubPermissions = $derived(clubItem?.rolePermissions ?? []);
	let canCreate = $derived(clubPermissions.includes('project:create'));
	let clubIdTyped = $derived((clubId ? (clubId as Id<'clubs'>) : null));

	const projectsResponse = useQuery(api.projects.listByClub, () =>
		clubIdTyped ? { clubId: clubIdTyped } : 'skip'
	);

	let selectedProjectId = $state<Id<'projects'> | null>(null);
	let selectedProject = $derived(
		projectsResponse.data?.find((project) => project._id === selectedProjectId) ?? null
	);

	$effect(() => {
		const projects = projectsResponse.data ?? [];
		if (!projects.length) {
			selectedProjectId = null;
			return;
		}
		if (!selectedProjectId || !projects.some((project) => project._id === selectedProjectId)) {
			selectedProjectId = projects[0]._id;
		}
	});

	const canManageSelected = useQuery(api.projects.canManageProject, () =>
		selectedProjectId ? { projectId: selectedProjectId } : 'skip'
	);
	const membersResponse = useQuery(api.projects.listMembers, () =>
		selectedProjectId ? { projectId: selectedProjectId } : 'skip'
	);
	const updatesResponse = useQuery(api.updates.listByProject, () =>
		selectedProjectId ? { projectId: selectedProjectId } : 'skip'
	);

	let dialogOpen = $state(false);
	let editProjectId = $state<Id<'projects'> | null>(null);
	let projectForm = $state({ name: '', description: '', dueDate: '' });
	let updateContent = $state('');
	let updateError = $state('');
	let memberUserId = $state('');
	let memberRoleName = $state<'Creator' | 'Contributor'>('Contributor');
	let errorMessage = $state('');
	let pending = $state(false);

	const toDateInput = (value: number | undefined) => {
		if (!value) return '';
		const date = new Date(value);
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
			date.getDate()
		).padStart(2, '0')}`;
	};

	const openCreate = () => {
		editProjectId = null;
		projectForm = { name: '', description: '', dueDate: '' };
		dialogOpen = true;
	};

	const openEdit = (project: NonNullable<typeof projectsResponse.data>[number]) => {
		editProjectId = project._id;
		projectForm = {
			name: project.name,
			description: project.description ?? '',
			dueDate: toDateInput(project.dueDate)
		};
		dialogOpen = true;
	};

	const saveProject = async () => {
		if (!clubIdTyped) return;
		pending = true;
		errorMessage = '';
		try {
			const dueDate = projectForm.dueDate ? new Date(projectForm.dueDate).getTime() : undefined;
			if (editProjectId) {
				await convexClient.mutation(api.projects.update, {
					projectId: editProjectId,
					name: projectForm.name.trim(),
					description: projectForm.description.trim() || undefined,
					dueDate
				});
			} else {
				await convexClient.mutation(api.projects.create, {
					clubId: clubIdTyped,
					name: projectForm.name.trim(),
					description: projectForm.description.trim() || undefined,
					dueDate
				});
			}
			dialogOpen = false;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to save project.';
		} finally {
			pending = false;
		}
	};

	const addUpdate = async () => {
		if (!selectedProjectId || !updateContent.trim()) return;
		pending = true;
		updateError = '';
		try {
			await convexClient.mutation(api.updates.create, {
				projectId: selectedProjectId,
				content: updateContent.trim()
			});
			updateContent = '';
		} catch (error) {
			updateError = error instanceof Error ? error.message : 'Failed to post update.';
		} finally {
			pending = false;
		}
	};

	const addMember = async () => {
		if (!selectedProjectId || !memberUserId.trim()) return;
		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.projects.addMember, {
				projectId: selectedProjectId,
				userId: memberUserId.trim(),
				roleName: memberRoleName
			});
			memberUserId = '';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to add member.';
		} finally {
			pending = false;
		}
	};

	const removeMember = async (projectMemberId: Id<'projectMembers'>) => {
		pending = true;
		errorMessage = '';
		try {
			await convexClient.mutation(api.projects.removeMember, { projectMemberId });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to remove member.';
		} finally {
			pending = false;
		}
	};
</script>

{#if !clubIdTyped}
	<Alert>
		<AlertTitle>No active club</AlertTitle>
		<AlertDescription>Set an active club before creating projects.</AlertDescription>
	</Alert>
{:else}
	<div class="grid grid-cols-1 gap-4">
		<Card>
			<CardHeader class="flex flex-wrap items-center justify-between gap-3">
				<div class="flex flex-col gap-1">
					<CardTitle>Projects</CardTitle>
					<CardDescription>Track club work with due dates and updates.</CardDescription>
				</div>
				{#if canCreate}
					<Button onclick={openCreate}>New project</Button>
				{/if}
			</CardHeader>
			<CardContent class="flex flex-col gap-3">
				{#if errorMessage}
					<Alert variant="destructive">
						<AlertTitle>Action failed</AlertTitle>
						<AlertDescription>{errorMessage}</AlertDescription>
					</Alert>
				{/if}

				{#if projectsResponse.isLoading}
					<p class="text-sm text-muted-foreground">Loading projects...</p>
				{:else if (projectsResponse.data?.length ?? 0) === 0}
					<p class="text-sm text-muted-foreground">No projects yet.</p>
				{:else}
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Project</TableHead>
								<TableHead>Due</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{#each projectsResponse.data ?? [] as project (project._id)}
								<TableRow>
									<TableCell>
										<button
											type="button"
											class="cursor-pointer text-left font-medium"
											onclick={() => {
												selectedProjectId = project._id;
											}}
										>
											{project.name}
										</button>
									</TableCell>
									<TableCell
										>{project.dueDate ? formatDateTime(project.dueDate) : 'No due date'}</TableCell
									>
									<TableCell>
										{#if project.doneDate}
											<Badge variant="outline">Done</Badge>
										{:else}
											<Badge>Active</Badge>
										{/if}
									</TableCell>
									<TableCell>
										<div class="flex flex-wrap gap-2">
											<Button
												size="sm"
												variant="outline"
												onclick={() => {
													selectedProjectId = project._id;
												}}
											>
												View
											</Button>
											{#if canManageSelected.data}
												<Button size="sm" variant="outline" onclick={() => openEdit(project)}
													>Edit</Button
												>
											{/if}
										</div>
									</TableCell>
								</TableRow>
							{/each}
						</TableBody>
					</Table>
				{/if}
			</CardContent>
		</Card>

		{#if selectedProject}
			<Card>
				<CardHeader class="flex flex-col gap-2">
					<CardTitle>{selectedProject.name}</CardTitle>
					<CardDescription
						>{selectedProject.description ?? 'No description provided.'}</CardDescription
					>
				</CardHeader>
				<CardContent class="flex flex-col gap-4">
					<div class="flex flex-wrap gap-2">
						<Badge variant="outline">Created {formatDateTime(selectedProject.createdAt)}</Badge>
						{#if selectedProject.dueDate}
							<Badge variant="outline">Due {formatDateTime(selectedProject.dueDate)}</Badge>
						{/if}
					</div>

					<Separator />

					<div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
						<div class="flex flex-col gap-3">
							<p class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
								Project updates
							</p>
							{#if updateError}
								<Alert variant="destructive">
									<AlertTitle>Update failed</AlertTitle>
									<AlertDescription>{updateError}</AlertDescription>
								</Alert>
							{/if}
							<div class="flex flex-col gap-2 rounded-md border border-border p-3">
								<Textarea bind:value={updateContent} rows={4} placeholder="Share progress update" />
								<Button
									disabled={pending || !canManageSelected.data}
									onclick={() => void addUpdate()}>Post update</Button
								>
							</div>
							<div class="flex flex-col gap-2">
								{#if updatesResponse.error}
									<p class="text-sm text-muted-foreground">
										You do not have permission to view updates.
									</p>
								{:else if (updatesResponse.data?.length ?? 0) === 0}
									<p class="text-sm text-muted-foreground">No updates posted yet.</p>
								{:else}
									{#each updatesResponse.data ?? [] as update (update._id)}
										<div class="flex flex-col gap-1 rounded-md border border-border p-3">
											<p class="text-sm">{update.content}</p>
											<p class="text-xs text-muted-foreground">
												{formatDateTime(update.createdAt)}
											</p>
										</div>
									{/each}
								{/if}
							</div>
						</div>

						<div class="flex flex-col gap-3">
							<p class="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
								Members
							</p>
							<div class="flex flex-col gap-2 rounded-md border border-border p-3">
								<div class="flex flex-col gap-2">
									<Label for="memberUserId">User ID</Label>
									<Input id="memberUserId" bind:value={memberUserId} placeholder="auth user id" />
								</div>
								<div class="flex flex-wrap gap-2">
									<Button
										size="sm"
										variant={memberRoleName === 'Contributor' ? 'default' : 'outline'}
										onclick={() => (memberRoleName = 'Contributor')}
									>
										Contributor
									</Button>
									<Button
										size="sm"
										variant={memberRoleName === 'Creator' ? 'default' : 'outline'}
										onclick={() => (memberRoleName = 'Creator')}
									>
										Creator
									</Button>
								</div>
								<Button
									disabled={pending || !canManageSelected.data}
									onclick={() => void addMember()}>Add member</Button
								>
							</div>
							<div class="flex flex-col gap-2">
								{#if membersResponse.isLoading}
									<p class="text-sm text-muted-foreground">Loading members...</p>
								{:else if (membersResponse.data?.length ?? 0) === 0}
									<p class="text-sm text-muted-foreground">No members yet.</p>
								{:else}
									{#each membersResponse.data ?? [] as member (member.projectMemberId)}
										<div
											class="flex items-center justify-between gap-2 rounded-md border border-border p-3"
										>
											<div class="flex flex-col gap-1">
												<p class="font-medium">
													{member.firstName}
													{member.lastName ?? ''}
												</p>
												<p class="text-xs text-muted-foreground">{member.profileId}</p>
											</div>
											<div class="flex items-center gap-2">
												<Badge variant="outline">{member.roleName}</Badge>
												<Button
													size="sm"
													variant="destructive"
													disabled={!canManageSelected.data}
													onclick={() => void removeMember(member.projectMemberId)}
												>
													Remove
												</Button>
											</div>
										</div>
									{/each}
								{/if}
							</div>
						</div>
					</div>
				</CardContent>
			</Card>
		{/if}
	</div>

	<Dialog.Root bind:open={dialogOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>{editProjectId ? 'Edit project' : 'Create project'}</Dialog.Title>
				<Dialog.Description>Keep goals and due dates visible for your club.</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-3">
				<div class="flex flex-col gap-2">
					<Label for="projectName">Project name</Label>
					<Input id="projectName" bind:value={projectForm.name} />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="projectDescription">Description</Label>
					<Textarea id="projectDescription" bind:value={projectForm.description} rows={4} />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="projectDueDate">Due date</Label>
					<Input id="projectDueDate" type="date" bind:value={projectForm.dueDate} />
				</div>
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (dialogOpen = false)}>Cancel</Button>
				<Button disabled={pending || !projectForm.name.trim()} onclick={() => void saveProject()}
					>{pending ? 'Saving...' : 'Save project'}</Button
				>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
