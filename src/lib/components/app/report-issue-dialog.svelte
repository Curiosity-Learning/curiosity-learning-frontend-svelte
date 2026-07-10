<script lang="ts">
	import FlagIcon from '@lucide/svelte/icons/flag';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import { api } from '$convex/_generated/api';
	import { useConvexClient } from 'convex-svelte';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Textarea } from '$lib/components/ui/textarea';
	import { cn } from '$lib/utils';
	import { _, t } from '$lib/i18n';

	type ReportTargetType = 'chat_message' | 'project_update' | 'user' | 'club';
	type ReportCategory = 'safeguarding' | 'inappropriate_content' | 'other';

	type Props = {
		targetType: ReportTargetType;
		targetId: string;
		/** Short snapshot of the reported content at report time (e.g. the message text). */
		contextText?: string;
		open?: boolean;
		/** Render own trigger (a subtle flag icon button). Set false to control `open` externally. */
		showTrigger?: boolean;
		triggerClass?: string;
		triggerAriaLabel?: string;
	};

	let {
		targetType,
		targetId,
		contextText,
		open = $bindable(false),
		showTrigger = true,
		triggerClass,
		triggerAriaLabel
	}: Props = $props();

	const DESCRIPTION_MAX_LENGTH = 2000;

	const convexClient = useConvexClient();

	let categoryOptions = $derived<Array<{ value: ReportCategory; label: string; description: string }>>([
		{
			value: 'safeguarding',
			label: $_('reportIssueDialog.categorySafeguardingLabel'),
			description: $_('reportIssueDialog.categorySafeguardingDescription')
		},
		{
			value: 'inappropriate_content',
			label: $_('reportIssueDialog.categoryInappropriateLabel'),
			description: $_('reportIssueDialog.categoryInappropriateDescription')
		},
		{
			value: 'other',
			label: $_('reportIssueDialog.categoryOtherLabel'),
			description: $_('reportIssueDialog.categoryOtherDescription')
		}
	]);

	let category = $state<ReportCategory>('safeguarding');
	let description = $state('');
	let submitting = $state(false);
	let errorMessage = $state('');
	let submitted = $state(false);

	const resetForm = () => {
		category = 'safeguarding';
		description = '';
		errorMessage = '';
		submitted = false;
	};

	// Resets the form whenever the dialog transitions from closed to open, regardless of
	// whether it was opened via the built-in trigger or externally (bind:open from a caller's
	// own menu item).
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen) {
			resetForm();
		}
		wasOpen = open;
	});

	const submitReport = async () => {
		submitting = true;
		errorMessage = '';
		try {
			const result = await convexClient.mutation(api.reports.submitReport, {
				category,
				description: description.trim() || undefined,
				targetType,
				targetId,
				contextText
			});
			if (!result.ok) {
				errorMessage = t('reportIssueDialog.rateLimitedError');
				return;
			}
			submitted = true;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('reportIssueDialog.submitFailure');
		} finally {
			submitting = false;
		}
	};
</script>

<Dialog.Root bind:open>
	{#if showTrigger}
		<Dialog.Trigger>
			{#snippet child({ props })}
				<button
					{...props}
					type="button"
					aria-label={triggerAriaLabel ?? $_('reportIssueDialog.triggerAriaLabel')}
					class={cn(
						'grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
						triggerClass
					)}
				>
					<FlagIcon class="size-4" />
				</button>
			{/snippet}
		</Dialog.Trigger>
	{/if}

	<Dialog.Content class="flex flex-col gap-5">
		{#if submitted}
			<div class="flex flex-col items-center gap-3 py-4 text-center">
				<div class="grid size-12 place-items-center rounded-full bg-green-50 text-green-600">
					<CheckCircle2Icon class="size-6" />
				</div>
				<Dialog.Title>{$_('reportIssueDialog.successTitle')}</Dialog.Title>
				<Dialog.Description>{$_('reportIssueDialog.successDescription')}</Dialog.Description>
				<Button variant="outline" class="mt-2" onclick={() => (open = false)}>
					{$_('reportIssueDialog.closeAction')}
				</Button>
			</div>
		{:else}
			<Dialog.Header class="flex flex-col gap-2">
				<Dialog.Title>{$_('reportIssueDialog.dialogTitle')}</Dialog.Title>
				<Dialog.Description>{$_('reportIssueDialog.dialogDescription')}</Dialog.Description>
			</Dialog.Header>

			{#if errorMessage}
				<Alert variant="destructive">
					<AlertDescription>{errorMessage}</AlertDescription>
				</Alert>
			{/if}

			<div class="flex flex-col gap-2">
				{#each categoryOptions as option (option.value)}
					<button
						type="button"
						onclick={() => (category = option.value)}
						class={cn(
							'flex flex-col gap-0.5 rounded-xl border px-4 py-3 text-left transition-colors',
							category === option.value
								? 'border-orange-500 bg-orange-50/60'
								: 'border-border/70 hover:border-border'
						)}
					>
						<span class="type-sm-bold text-foreground">{option.label}</span>
						<span class="type-caption text-muted-foreground">{option.description}</span>
					</button>
				{/each}
			</div>

			<div class="flex flex-col gap-2">
				<Textarea
					bind:value={description}
					rows={3}
					maxlength={DESCRIPTION_MAX_LENGTH}
					placeholder={$_('reportIssueDialog.detailsPlaceholder')}
				/>
			</div>

			<Dialog.Footer>
				<Button variant="outline" onclick={() => (open = false)} disabled={submitting}>
					{$_('reportIssueDialog.cancelAction')}
				</Button>
				<Button disabled={submitting} onclick={() => void submitReport()}>
					{submitting ? $_('reportIssueDialog.submitting') : $_('reportIssueDialog.submitAction')}
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
