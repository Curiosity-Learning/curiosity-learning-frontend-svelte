<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { showGlobalSnackbar } from '$lib/components/app/snackbar';
	import { signOutAndGoToSignIn } from '$lib/auth/sign-out';
	import { t } from '$lib/i18n';
	import {
		FRESH_SESSION_REQUIRED,
		NOTIFICATION_EMAIL_IS_PARENT,
		RESEND_LIMIT_REACHED,
		childEmailSettingsPath,
		hasErrorCode
	} from '$lib/domain/child-notification-email';

	// A parent's settings for one child, in the parent's own Settings (CL-801; until then on the
	// child's overview page, CL-768/CL-769):
	// - the child's notification email: where the child's club/project chat (and other
	//   non-critical) emails go. Unset, they come to the parent. A saved address is PENDING until
	//   the child confirms it from the emailed link while signed in as themselves (review B2/B3).
	// - once that address is confirmed, the parent's own copies of chat and activity emails
	//   (review D7). Critical notices always come to the parent.
	// Every change needs a recent sign-in (the server answers FRESH_SESSION_REQUIRED otherwise,
	// review S5), so a session left behind on a shared computer cannot redirect the child's emails.

	type Props = {
		childProfileId: Id<'profiles'>;
		displayName: string;
		notificationEmail: string | null;
		notificationEmailSetAt: number | null;
		notificationEmailVerified: boolean;
		parentNotificationSettings: { chatCopies: boolean; activityCopies: boolean };
	};

	let {
		childProfileId,
		displayName,
		notificationEmail,
		notificationEmailSetAt,
		notificationEmailVerified,
		parentNotificationSettings
	}: Props = $props();

	const convexClient = useConvexClient();

	let notificationEmailConfirmed = $derived(
		notificationEmail !== null && notificationEmailVerified
	);
	// Edge case 4: a typo'd address never confirms; after a few days say so.
	const PENDING_STALE_AFTER_DAYS = 3;
	let pendingDays = $derived(
		notificationEmail && !notificationEmailConfirmed && notificationEmailSetAt
			? Math.floor((Date.now() - notificationEmailSetAt) / (24 * 60 * 60 * 1000))
			: 0
	);
	let editing = $state(false);
	let draft = $state('');
	let emailError = $state<string | null>(null);
	let freshSignInRequired = $state(false);
	let saving = $state(false);

	const startEditing = () => {
		draft = notificationEmail ?? '';
		emailError = null;
		editing = true;
	};

	const emailErrorMessage = (error: unknown) => {
		if (hasErrorCode(error, NOTIFICATION_EMAIL_IS_PARENT)) {
			return t('parentAccounts.notificationEmailIsParent').replace('{name}', displayName);
		}
		if (hasErrorCode(error, RESEND_LIMIT_REACHED)) {
			return t('parentAccounts.notificationEmailResendLimit');
		}
		if (error instanceof Error && /valid email/i.test(error.message)) {
			return t('parentAccounts.notificationEmailInvalid');
		}
		return t('parentAccounts.notificationEmailFailure');
	};

	// `email` null removes the address; the current pending address again is "Resend".
	const submitEmail = async (email: string | null) => {
		if (saving) return;
		emailError = null;
		freshSignInRequired = false;
		saving = true;
		const isResend = email !== null && email === notificationEmail && !editing;
		try {
			const result = await convexClient.mutation(api.parentAccounts.setChildNotificationEmail, {
				childProfileId,
				email
			});
			editing = false;
			if (result.status === 'none') {
				showGlobalSnackbar({ title: t('parentAccounts.notificationEmailRemoved') });
			} else if (result.verificationSent) {
				showGlobalSnackbar({
					title: t(
						isResend
							? 'parentAccounts.notificationEmailResent'
							: 'parentAccounts.notificationEmailSaved'
					).replace('{name}', displayName)
				});
			}
		} catch (error) {
			if (hasErrorCode(error, FRESH_SESSION_REQUIRED)) {
				freshSignInRequired = true;
			} else {
				emailError = emailErrorMessage(error);
			}
		} finally {
			saving = false;
		}
	};

	// The parent's own copies. The switch shows the new value while saving and falls back to the
	// server's value when the save fails.
	type ParentSettingKey = 'chatCopies' | 'activityCopies';
	let pendingSettings = $state<Partial<Record<ParentSettingKey, boolean>>>({});
	let settings = $derived({ ...parentNotificationSettings, ...pendingSettings });
	let settingsError = $state<string | null>(null);
	let settingsFreshSignInRequired = $state(false);
	const setParentSetting = async (key: ParentSettingKey, value: boolean) => {
		settingsError = null;
		settingsFreshSignInRequired = false;
		pendingSettings[key] = value;
		try {
			await convexClient.mutation(api.parentAccounts.setParentNotificationSettings, {
				childProfileId,
				[key]: value
			});
		} catch (error) {
			if (hasErrorCode(error, FRESH_SESSION_REQUIRED)) {
				settingsFreshSignInRequired = true;
			} else {
				settingsError = t('parentAccounts.parentEmailsSaveFailure');
			}
		} finally {
			delete pendingSettings[key];
		}
	};
	const settingItems: Array<{ key: ParentSettingKey; labelKey: string }> = [
		{ key: 'chatCopies', labelKey: 'parentAccounts.parentEmailsChatCopies' },
		{ key: 'activityCopies', labelKey: 'parentAccounts.parentEmailsActivityCopies' }
	];

	let signingInAgain = $state(false);
	const signInAgain = async () => {
		signingInAgain = true;
		try {
			// Back to this card after signing in (through /child/[id]?settings=emails).
			await signOutAndGoToSignIn(childEmailSettingsPath(childProfileId));
		} finally {
			signingInAgain = false;
		}
	};
</script>

{#snippet freshSignInAlert()}
	<Alert class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex flex-col gap-1">
			<AlertTitle>{t('parentAccounts.notificationEmailFreshSessionTitle')}</AlertTitle>
			<AlertDescription>
				{t('parentAccounts.notificationEmailFreshSession')}
			</AlertDescription>
		</div>
		<Button
			type="button"
			variant="outline"
			disabled={signingInAgain}
			onclick={() => void signInAgain()}
		>
			{t('parentAccounts.notificationEmailSignInAgain')}
		</Button>
	</Alert>
{/snippet}

<section
	class="flex flex-col gap-4 rounded-lg border border-border/70 p-4"
	data-testid="child-email-settings"
>
	<p class="type-body-bold text-foreground">{displayName}</p>

	<div class="flex flex-col gap-3">
		<div class="flex flex-col gap-1">
			<div class="flex flex-wrap items-center gap-2">
				<p class="type-sm-bold text-foreground">
					{t('parentAccounts.notificationEmailTitle')}
				</p>
				{#if notificationEmailConfirmed && !editing}
					<Badge variant="secondary">{t('parentAccounts.notificationEmailConfirmed')}</Badge>
				{/if}
			</div>
			{#if notificationEmail && !editing}
				{#if notificationEmailConfirmed}
					<p class="type-sm text-muted-foreground">
						{t('parentAccounts.notificationEmailCurrent').replace('{name}', displayName)}
						<span class="type-sm-bold text-foreground">{notificationEmail}</span>
					</p>
				{:else}
					<p class="type-sm text-muted-foreground">
						{t('parentAccounts.notificationEmailPending')
							.replace('{name}', displayName)
							.replace('{email}', notificationEmail)}
					</p>
					{#if pendingDays >= PENDING_STALE_AFTER_DAYS}
						<p class="type-sm text-muted-foreground">
							{t('parentAccounts.notificationEmailPendingStale').replace(
								'{days}',
								String(pendingDays)
							)}
						</p>
					{/if}
				{/if}
			{:else}
				<p class="type-sm text-muted-foreground">
					{t('parentAccounts.notificationEmailDescription').replace(/\{name\}/g, displayName)}
				</p>
			{/if}
			{#if !notificationEmailVerified}
				<p class="type-sm text-muted-foreground">
					{t('parentAccounts.parentEmailsUnconfirmed').replace(/\{name\}/g, displayName)}
				</p>
			{/if}
		</div>
		{#if freshSignInRequired}
			{@render freshSignInAlert()}
		{/if}
		{#if editing || !notificationEmail}
			<form
				class="flex flex-col gap-3"
				onsubmit={(event) => {
					event.preventDefault();
					void submitEmail(draft);
				}}
			>
				<div class="flex flex-col gap-1.5">
					<Label for={`child-notification-email-${childProfileId}`}>
						{t('parentAccounts.notificationEmailLabel').replace('{name}', displayName)}
					</Label>
					<Input
						id={`child-notification-email-${childProfileId}`}
						type="email"
						autocomplete="off"
						placeholder={t('parentAccounts.notificationEmailPlaceholder')}
						bind:value={draft}
						disabled={saving}
						aria-invalid={emailError ? true : undefined}
					/>
					{#if emailError}
						<p class="type-sm text-destructive">{emailError}</p>
					{/if}
				</div>
				<p class="type-sm text-muted-foreground">
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
			{#if emailError}
				<p class="type-sm text-destructive">{emailError}</p>
			{/if}
			<div class="flex flex-wrap gap-2">
				{#if !notificationEmailConfirmed}
					<Button
						type="button"
						disabled={saving}
						onclick={() => void submitEmail(notificationEmail)}
					>
						{t('parentAccounts.notificationEmailResend')}
					</Button>
				{/if}
				<Button type="button" variant="outline" disabled={saving} onclick={startEditing}>
					{t('parentAccounts.notificationEmailChange')}
				</Button>
				<Button
					type="button"
					variant="ghost"
					disabled={saving}
					onclick={() => void submitEmail(null)}
				>
					{t('parentAccounts.notificationEmailRemove')}
				</Button>
			</div>
		{/if}
	</div>

	{#if notificationEmailVerified}
		<div class="flex flex-col gap-3">
			<div class="flex flex-col gap-1">
				<p class="type-sm-bold text-foreground">
					{t('parentAccounts.parentEmailsTitle').replace('{name}', displayName)}
				</p>
				<p class="type-sm text-muted-foreground">
					{t('parentAccounts.parentEmailsCriticalNote').replace('{name}', displayName)}
				</p>
			</div>
			{#each settingItems as item (item.key)}
				<div class="flex items-center justify-between gap-4">
					<Label for={`parent-email-${item.key}-${childProfileId}`} class="type-sm">
						{t(item.labelKey).replace('{name}', displayName)}
					</Label>
					<Switch
						id={`parent-email-${item.key}-${childProfileId}`}
						checked={settings[item.key]}
						disabled={pendingSettings[item.key] !== undefined}
						onCheckedChange={(value) => void setParentSetting(item.key, value)}
						class="shrink-0"
					/>
				</div>
			{/each}
			{#if settingsError}
				<p class="type-sm text-destructive">{settingsError}</p>
			{/if}
			{#if settingsFreshSignInRequired}
				{@render freshSignInAlert()}
			{/if}
		</div>
	{/if}
</section>
