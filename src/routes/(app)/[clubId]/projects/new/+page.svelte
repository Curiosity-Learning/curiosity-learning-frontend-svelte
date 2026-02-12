<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { PageHeaderBackButton, PageHeaderActions, PageHeaderTitle } from '$lib/components/app';
	import { Button } from '$lib/components/ui/button';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { Separator } from '$lib/components/ui/separator';
	import { Textarea } from '$lib/components/ui/textarea';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { useConvexClient } from 'convex-svelte';
	import { projectSchema } from './schema';

	const convexClient = useConvexClient();

	let clubId = $derived((page.params as Record<string, string | undefined>).clubId ?? '');
	let clubIdTyped = $derived(clubId ? (clubId as Id<'clubs'>) : null);

	let serverError = $state('');

	const { form: formData, errors, enhance, submitting } = superForm(
		defaults(zod4(projectSchema)),
		{
			validators: zod4Client(projectSchema),
			SPA: true,
			onUpdate: async ({ form: f }) => {
				if (!f.valid || !clubIdTyped) return;

				serverError = '';
				try {
					let dueDateMs: number | undefined = undefined;
					if (f.data.dueDate) {
						dueDateMs = new Date(f.data.dueDate).getTime();
						if (!Number.isFinite(dueDateMs)) {
							throw new Error('Please enter a valid due date.');
						}
					}

					await convexClient.mutation(api.projects.create, {
						clubId: clubIdTyped,
						name: f.data.name.trim(),
						description: f.data.description?.trim() || undefined,
						dueDate: dueDateMs
					});
					await goto(`/${clubId}/projects/current`);
				} catch (error) {
					serverError = error instanceof Error ? error.message : 'Failed to create project.';
				}
			}
		}
	);
</script>

<PageHeaderBackButton
	fallbackHref={clubId ? `/${clubId}/projects/current` : '/onboarding/get-started'}
/>
<PageHeaderTitle title="Add project details" />
<PageHeaderActions none />

<Separator />

<form method="POST" use:enhance class="flex w-full max-w-lg flex-1 flex-col self-center">
	<Field.Group>
		<Field.Field>
			<Field.Label for="name" required>Name</Field.Label>
			<Input id="name" name="name" bind:value={$formData.name} placeholder="Enter project name" />
			{#if $errors.name}<Field.Error>{$errors.name}</Field.Error>{/if}
		</Field.Field>

		<Field.Field>
			<Field.Label for="description">Description</Field.Label>
			<Textarea
				id="description"
				name="description"
				bind:value={$formData.description}
				placeholder="Add project description..."
				rows={4}
				maxlength={200}
			/>
			{#if $errors.description}<Field.Error>{$errors.description}</Field.Error>{/if}
		</Field.Field>

		<Field.Field>
			<Field.Label for="dueDate" required>Deadline</Field.Label>
			<Input id="dueDate" name="dueDate" type="date" bind:value={$formData.dueDate} />
			{#if $errors.dueDate}<Field.Error>{$errors.dueDate}</Field.Error>{/if}
			<Field.Description>Set a realistic deadline that works for you. Good luck!</Field.Description>
		</Field.Field>
	</Field.Group>

	{#if serverError}
		<Field.Error>{serverError}</Field.Error>
	{/if}

	<div class="flex flex-1"></div>

	<div class="sticky bottom-28 pb-4 lg:bottom-4">
		<Button type="submit" class="w-full" size="lg" disabled={$submitting}>
			{$submitting ? 'Creating...' : 'Continue'}
		</Button>
	</div>
</form>
