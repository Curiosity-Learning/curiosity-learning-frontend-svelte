<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { PageHeaderActions, PageHeaderBackButton } from '$lib/components/app';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { DatePicker } from '$lib/components/ui/date-picker';
	import { Input } from '$lib/components/ui/input';
	import { FieldLabel } from '$lib/components/ui/field';
	import { Label } from '$lib/components/ui/label';
	import { routes } from '$lib/routes';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import ClubProjectCard from './club-project-card.svelte';

	type Props = {
		status: 'current' | 'completed';
	};

	let { status }: Props = $props();

	const convexClient = useConvexClient();
	const clubsResponse = useQuery(api.clubs.getMyClubs, {});

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

	let errorMessage = $state('');
	let searchOpen = $state(false);
	let searchText = $state('');

	let createDialogOpen = $state(false);
	let createName = $state('');
	let createDueDate = $state<number | null>(null);
	let createPending = $state(false);
	let createError = $state('');

	const openCreateDialog = () => {
		createName = '';
		createDueDate = null;
		createError = '';
		createDialogOpen = true;
	};

	const createProject = async () => {
		if (!clubIdTyped || !createName.trim() || createDueDate === null) return;
		createPending = true;
		createError = '';
		try {
			const project = await convexClient.mutation(api.projects.create, {
				clubId: clubIdTyped,
				name: createName.trim(),
				dueDate: createDueDate
			});
			createDialogOpen = false;
			if (project?._id) {
				await goto(routes.projectDetail(project._id));
			}
		} catch (error) {
			createError = error instanceof Error ? error.message : 'Failed to create project.';
		} finally {
			createPending = false;
		}
	};

	const toggleSearch = () => {
		searchOpen = !searchOpen;
		if (!searchOpen) {
			searchText = '';
		}
	};

	let sortedProjects = $derived.by(() => {
		const projects = [...(projectsResponse.data ?? [])];
		if (status === 'completed') {
			return projects.sort(
				(left, right) =>
					(right.doneDate ?? right.updatedAt ?? right.createdAt) -
					(left.doneDate ?? left.updatedAt ?? left.createdAt)
			);
		}

		return projects.sort((left, right) => {
			if (left.dueDate !== right.dueDate) return (left.dueDate ?? 0) - (right.dueDate ?? 0);
			return left.createdAt - right.createdAt;
		});
	});

	let visibleProjects = $derived.by(() => {
		const query = searchText.trim().toLowerCase();
		const scopedByTab = sortedProjects.filter((project) =>
			status === 'completed' ? Boolean(project.doneDate) : !project.doneDate
		);

		if (!query) return scopedByTab;

		return scopedByTab.filter((project) => {
			const dueText = project.dueDate ? new Date(project.dueDate).toLocaleDateString() : '';
			const doneText = project.doneDate ? new Date(project.doneDate).toLocaleDateString() : '';
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
</script>

<PageHeaderBackButton fallbackHref={clubId ? `/${clubId}` : '/onboarding/get-started'} />
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
		<Button
			variant="ghost"
			size="icon"
			aria-label={searchOpen ? 'Hide search' : 'Search projects'}
			onclick={toggleSearch}
		>
			<SearchIcon class="size-5 text-muted-foreground" />
		</Button>
	</div>
</PageHeaderActions>

{#if !clubIdTyped}
	<Alert>
		<AlertTitle>No active club</AlertTitle>
		<AlertDescription>Set an active club before creating projects.</AlertDescription>
	</Alert>
{:else}
	<div class="flex w-full max-w-2xl self-center flex-col gap-4">
		{#if searchOpen}
			<Input bind:value={searchText} placeholder="Search projects by title, date, or description" />
		{/if}

		{#if errorMessage}
			<Alert variant="destructive">
				<AlertTitle>Action failed</AlertTitle>
				<AlertDescription>{errorMessage}</AlertDescription>
			</Alert>
		{/if}

		{#if projectsResponse.error}
			<Alert variant="destructive">
				<AlertTitle>Unable to load projects</AlertTitle>
				<AlertDescription>
					{projectsResponse.error.message ?? 'Please refresh and try again.'}
				</AlertDescription>
			</Alert>
		{:else if projectsResponse.isLoading}
			<p class="type-sm text-muted-foreground">Loading projects...</p>
		{:else if visibleProjects.length === 0}
			<p class="type-sm text-muted-foreground">{emptyLabel}</p>
		{:else}
			<div class="flex flex-col gap-3">
				{#each visibleProjects as project (project._id)}
					<ClubProjectCard
						{project}
						{status}
						href={routes.projectDetail(project._id)}
						class={status === 'completed' ? 'border-border/70' : undefined}
					/>
				{/each}
			</div>
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
					<Input id="projectName" bind:value={createName} placeholder="Enter project name" required />
				</div>
				<div class="flex flex-col gap-2">
					<FieldLabel for="projectDueDate" required>Due date</FieldLabel>
					<DatePicker id="projectDueDate" bind:value={createDueDate} />
				</div>
			</div>
			{#if createError}
				<p class="type-sm text-destructive">{createError}</p>
			{/if}
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (createDialogOpen = false)}>Cancel</Button>
				<Button disabled={createPending || !createName.trim() || createDueDate === null} onclick={() => void createProject()}>
					{createPending ? 'Creating...' : 'Open'}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
