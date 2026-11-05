<script lang="ts">
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { showGlobalSnackbar } from '$lib/components/app/snackbar';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { useConvexClient } from 'convex-svelte';
	import { t } from '$lib/i18n';

	// A parent-owned setting for one linked child: where the child's club/project chat (and other
	// non-critical) emails go. Unset, they come to the parent — the chat email itself links to
	// Settings with a nudge to set one (chat.deliverChatEmailNotification). Critical notices keep
	// going to the parent. The child cannot consent to receiving email, so the parent does it here.

	type Props = {
		childProfileId: Id<'profiles'>;
		displayName: string;
		notificationEmail: string | null;
	};

	let { childProfileId, displayName, notificationEmail }: Props = $props();

	const convexClient = useConvexClient();
	let editing = $state(false);
	let draft = $state('');
	let error = $state<string | null>(null);
	let saving = $state(false);
	let inputId = $derived(`child-notification-email-${childProfileId}`);

	const startEditing = () => {
		draft = notificationEmail ?? '';
		error = null;
		editing = true;
	};

	const submit = async (email: string | null) => {
		if (saving) return;
		error = null;
		saving = true;
		try {
			await convexClient.mutation(api.parentAccounts.setChildNotificationEmail, {
				childProfileId,
				email
			});
			editing = false;
			showGlobalSnackbar({
				title: email
					? t('parentAccounts.notificationEmailSaved').replace('{name}', displayName)
					: t('parentAccounts.notificationEmailRemoved')
			});
		} catch (caught) {
			error =
				caught instanceof Error && /valid email/i.test(caught.message)
					? t('parentAccounts.notificationEmailInvalid')
					: t('parentAccounts.notificationEmailFailure');
		} finally {
			saving = false;
		}
	};
</script>

<section class="flex flex-col gap-3 rounded-lg border border-border/70 p-3">
	<div class="flex flex-col gap-1">
		<p class="type-sm-bold text-foreground">{displayName}</p>
		{#if notificationEmail && !editing}
			<p class="type-body-compact text-muted-foreground">
				{t('parentAccounts.notificationEmailCurrent').replace('{name}', displayName)}
				<span class="type-sm-bold text-foreground">{notificationEmail}</span>
			</p>
		{:else}
			<p class="type-body-compact text-muted-foreground">
				{t('parentAccounts.notificationEmailDescription').replace(/\{name\}/g, displayName)}
			</p>
		{/if}
	</div>
	{#if editing || !notificationEmail}
		<form
			class="flex flex-col gap-3"
			onsubmit={(event) => {
				event.preventDefault();
				void submit(draft);
			}}
		>
			<div class="flex flex-col gap-1.5">
				<Label for={inputId}>
					{t('parentAccounts.notificationEmailLabel').replace('{name}', displayName)}
				</Label>
				<Input
					id={inputId}
					type="email"
					autocomplete="off"
					placeholder={t('parentAccounts.notificationEmailPlaceholder')}
					bind:value={draft}
					disabled={saving}
					aria-invalid={error ? true : undefined}
				/>
				{#if error}
					<p class="type-sm text-destructive">{error}</p>
				{/if}
			</div>
			<p class="type-body-compact text-muted-foreground">
				{t('parentAccounts.notificationEmailConsent').replace('{name}', displayName)}
			</p>
			<div class="flex flex-wrap gap-2">
				<Button type="submit" disabled={saving || draft.trim() === ''}>
					{t('parentAccounts.notificationEmailSave')}
				</Button>
				{#if editing}
					<Button
						type="button"
						variant="outline"
						disabled={saving}
						onclick={() => (editing = false)}
					>
						{t('parentAccounts.notificationEmailCancel')}
					</Button>
				{/if}
			</div>
		</form>
	{:else}
		<div class="flex flex-wrap gap-2">
			<Button type="button" variant="outline" onclick={startEditing}>
				{t('parentAccounts.notificationEmailChange')}
			</Button>
			<Button type="button" variant="ghost" disabled={saving} onclick={() => void submit(null)}>
				{t('parentAccounts.notificationEmailRemove')}
			</Button>
		</div>
	{/if}
</section>
