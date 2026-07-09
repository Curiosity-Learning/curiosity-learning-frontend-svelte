<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { useConvexClient } from 'convex-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent } from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Tabs from '$lib/components/ui/tabs';
	import { _, t } from '$lib/i18n';
	import { cn } from '$lib/utils.js';

	type Props = {
		clubId?: Id<'clubs'> | null;
		clubCode: string | null | undefined;
		guideInviteCode?: string | null;
		canInviteGuide?: boolean;
		triggerLabel?: string;
		triggerStyle?: 'link' | 'card' | 'button';
		cardMinHeightClass?: string;
	};

	let {
		clubId = null,
		clubCode,
		guideInviteCode = null,
		canInviteGuide = false,
		triggerLabel,
		triggerStyle = 'link',
		cardMinHeightClass = 'min-h-56'
	}: Props = $props();

	const convexClient = useConvexClient();

	let open = $state(false);
	let copiedField = $state<string | null>(null);
	let roleTab = $state<'learner' | 'guide'>('learner');
	let generatingGuideCode = $state(false);
	let generateError = $state('');

	let learnerJoinUrl = $derived(clubCode ? `/onboarding/join-club/${clubCode}` : '');
	let guideJoinUrl = $derived(guideInviteCode ? `/onboarding/join-club/${guideInviteCode}` : '');
	let resolvedTriggerLabel = $derived(triggerLabel ?? t('inviteLearnerDialog.triggerLabel'));

	const copyText = async (value: string, field: string) => {
		try {
			await navigator.clipboard.writeText(value);
			copiedField = field;
			window.setTimeout(() => {
				copiedField = null;
			}, 1200);
		} catch {
			// Ignore clipboard errors; users can still select + copy manually.
		}
	};

	const generateGuideCode = async () => {
		if (!clubId) return;
		generatingGuideCode = true;
		generateError = '';
		try {
			await convexClient.mutation(api.clubs.createOrRotateGuideInviteCode, { clubId });
		} catch (error) {
			generateError =
				error instanceof Error ? error.message : t('inviteLearnerDialog.generateGuideCodeFailure');
		} finally {
			generatingGuideCode = false;
		}
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger>
		{#snippet child({ props })}
			{#if triggerStyle === 'card'}
				<Card class="gap-0 py-0">
					<CardContent class={cn('px-0', cardMinHeightClass)}>
						<Button
							{...props}
							variant="ghost"
							class="h-full w-full justify-center rounded-xl type-lead-medium text-foreground hover:bg-accent/60"
						>
							{resolvedTriggerLabel}
						</Button>
					</CardContent>
				</Card>
			{:else if triggerStyle === 'button'}
				<Button {...props} variant="outline" class="w-fit">
					{resolvedTriggerLabel}
				</Button>
			{:else}
				<Button
					{...props}
					variant="ghost"
					size="sm"
					class="px-0 py-0 type-sm-bold text-orange-500 hover:bg-transparent hover:text-orange-600"
				>
					<PlusIcon class="size-4" />
					<span>{resolvedTriggerLabel}</span>
				</Button>
			{/if}
		{/snippet}
	</Dialog.Trigger>

	<Dialog.Content class="flex flex-col gap-5">
		<Dialog.Header class="flex flex-col gap-2">
			<Dialog.Title>{$_('inviteLearnerDialog.dialogTitle')}</Dialog.Title>
			<Dialog.Description>{$_('inviteLearnerDialog.dialogDescription')}</Dialog.Description>
		</Dialog.Header>

		{#if canInviteGuide}
			<Tabs.Root bind:value={roleTab}>
				<Tabs.List class="grid w-full grid-cols-2">
					<Tabs.Trigger value="learner">{$_('inviteLearnerDialog.roleTabLearner')}</Tabs.Trigger>
					<Tabs.Trigger value="guide">{$_('inviteLearnerDialog.roleTabGuide')}</Tabs.Trigger>
				</Tabs.List>
			</Tabs.Root>
		{/if}

		{#if roleTab === 'learner' || !canInviteGuide}
			{#if !clubCode}
				<p class="type-sm text-muted-foreground">{$_('inviteLearnerDialog.noLearnerCode')}</p>
			{:else}
				<div class="flex flex-col gap-4">
					<div class="flex flex-col gap-2">
						<Label for="inviteCode">{$_('inviteLearnerDialog.learnerCodeLabel')}</Label>
						<div class="flex items-center gap-2">
							<Input id="inviteCode" readonly value={clubCode} class="type-code" />
							<Button variant="outline" onclick={() => void copyText(clubCode, 'learnerCode')}>
								<CopyIcon class="size-4" />
								<span class="hidden sm:inline"
									>{copiedField === 'learnerCode'
										? $_('inviteLearnerDialog.copied')
										: $_('inviteLearnerDialog.copy')}</span
								>
							</Button>
						</div>
					</div>

					<div class="flex flex-col gap-2">
						<Label for="joinLink">{$_('inviteLearnerDialog.joinLinkLabel')}</Label>
						<div class="flex items-center gap-2">
							<Input
								id="joinLink"
								readonly
								value={learnerJoinUrl}
								class={cn('type-code', !learnerJoinUrl && 'opacity-70')}
							/>
							<Button
								variant="outline"
								onclick={() => void copyText(learnerJoinUrl, 'learnerLink')}
								disabled={!learnerJoinUrl}
							>
								<CopyIcon class="size-4" />
								<span class="hidden sm:inline"
									>{copiedField === 'learnerLink'
										? $_('inviteLearnerDialog.copied')
										: $_('inviteLearnerDialog.copy')}</span
								>
							</Button>
						</div>
					</div>
				</div>
			{/if}
		{:else}
			<div class="flex flex-col gap-4">
				{#if generateError}
					<p class="type-sm text-destructive">{generateError}</p>
				{/if}
				{#if !guideInviteCode}
					<p class="type-sm text-muted-foreground">{$_('inviteLearnerDialog.noGuideCode')}</p>
					<Button
						variant="outline"
						class="w-fit"
						disabled={generatingGuideCode}
						onclick={() => void generateGuideCode()}
					>
						{$_('inviteLearnerDialog.generateGuideCodeButton')}
					</Button>
				{:else}
					<div class="flex flex-col gap-2">
						<Label for="guideInviteCode">{$_('inviteLearnerDialog.guideCodeLabel')}</Label>
						<div class="flex items-center gap-2">
							<Input id="guideInviteCode" readonly value={guideInviteCode} class="type-code" />
							<Button variant="outline" onclick={() => void copyText(guideInviteCode, 'guideCode')}>
								<CopyIcon class="size-4" />
								<span class="hidden sm:inline"
									>{copiedField === 'guideCode'
										? $_('inviteLearnerDialog.copied')
										: $_('inviteLearnerDialog.copy')}</span
								>
							</Button>
						</div>
					</div>

					<div class="flex flex-col gap-2">
						<Label for="guideJoinLink">{$_('inviteLearnerDialog.joinLinkLabel')}</Label>
						<div class="flex items-center gap-2">
							<Input id="guideJoinLink" readonly value={guideJoinUrl} class="type-code" />
							<Button variant="outline" onclick={() => void copyText(guideJoinUrl, 'guideLink')}>
								<CopyIcon class="size-4" />
								<span class="hidden sm:inline"
									>{copiedField === 'guideLink'
										? $_('inviteLearnerDialog.copied')
										: $_('inviteLearnerDialog.copy')}</span
								>
							</Button>
						</div>
					</div>

					<Button
						variant="ghost"
						size="sm"
						class="w-fit px-0"
						disabled={generatingGuideCode}
						onclick={() => void generateGuideCode()}
					>
						{$_('inviteLearnerDialog.generateGuideCodeButton')}
					</Button>
				{/if}
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
