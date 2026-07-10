<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as FileDropZone from '$lib/components/ui/file-drop-zone';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';
	import { _, t } from '$lib/i18n';
	import { createMediaField } from '$lib/media/media-field.svelte';
	import { PageHeaderBackButton, PageHeaderTitle } from '$lib/components/app';
	import { api } from '$convex/_generated/api';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { authClient } from '$lib/auth-client';
	import { routes } from '$lib/routes';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const session = authClient.useSession();
	const convexClient = useConvexClient();
	const profileResponse = useStableQuery(api.profiles.getMe, {});
	const preferencesResponse = useStableQuery(api.preferences.get, {});
	const legalDocumentsResponse = useStableQuery(api.legalDocuments.listActive, () =>
		$session.data ? {} : 'skip'
	);
	const profileImageField = createMediaField(convexClient, 'profileImage', {
		mode: 'immediate'
	});

	const legalDocumentOrder = {
		privacy_policy: 0,
		terms_and_conditions: 1,
		cookie_policy: 2
	} as const;

	let orderedLegalDocuments = $derived(
		[...(legalDocumentsResponse.data ?? [])].sort(
			(a, b) => legalDocumentOrder[a.documentKey] - legalDocumentOrder[b.documentKey]
		)
	);

	let profileInitialized = $state(false);
	let checkingUsername = $state(false);
	let usernameAvailable = $state<boolean | null>(null);
	let pending = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');

	let profileForm = $state({
		firstName: '',
		lastName: '',
		username: '',
		about: '',
		howDidYouFindUs: '',
		identity: '',
		locationAddress: ''
	});

	$effect(() => {
		if (profileInitialized) return;
		if (!profileResponse.data) return;
		profileForm = {
			firstName: profileResponse.data.firstName ?? '',
			lastName: profileResponse.data.lastName ?? '',
			username: profileResponse.data.username ?? '',
			about: profileResponse.data.about ?? '',
			howDidYouFindUs: profileResponse.data.howDidYouFindUs ?? '',
			identity: profileResponse.data.identity ?? '',
			locationAddress: profileResponse.data.locationAddress ?? ''
		};
		profileInitialized = true;
	});

	const checkUsername = async () => {
		if (!profileForm.username.trim()) {
			usernameAvailable = null;
			return;
		}
		checkingUsername = true;
		try {
			usernameAvailable = await convexClient.query(api.profiles.checkUsernameAvailability, {
				username: profileForm.username.trim().toLowerCase()
			});
		} finally {
			checkingUsername = false;
		}
	};

	onDestroy(() => {
		profileImageField.destroy();
	});

	let persistedProfileImageUrl = $derived.by(() => {
		const profileImageAssetId = profileResponse.data?.profileImageMediaAssetId ?? null;
		if (profileImageAssetId && data.initialProfileImage?.assetId === profileImageAssetId) {
			return data.initialProfileImage.signedUrl;
		}

		if (profileImageAssetId) {
			return null;
		}

		return null;
	});

	let displayProfileImageUrl = $derived(
		profileImageField.localPreviewUrl ?? persistedProfileImageUrl ?? null
	);

	let profileInitials = $derived(
		(profileForm.firstName || profileForm.lastName
			? `${profileForm.firstName.slice(0, 1)}${profileForm.lastName.slice(0, 1)}`
			: profileForm.username.slice(0, 2) || 'ME'
		).toUpperCase()
	);

	const handleProfileImageUpload = async (files: File[]) => {
		pending = true;
		errorMessage = '';
		successMessage = '';

		try {
			await profileImageField.selectFiles(files);
			if (!profileImageField.isReady || !profileImageField.assetId) {
				throw new Error(
					profileImageField.errorMessage || t('settingsPage.profileImageUploadFailure')
				);
			}
			await profileImageField.persistAttached(async (assetId) => {
				if (!assetId) return;
				await convexClient.mutation(api.profiles.updateMe, {
					profileImageMediaAssetId: assetId
				});
			});
			successMessage = t('settingsPage.profileImageUploaded');
		} catch (error) {
			let message = t('settingsPage.profileImageUploadFailure');
			if (error instanceof Error) {
				const match = error.message.match(/ConvexError:\s*(.+?)(?:\s+at\s+|$)/);
				message = match ? match[1] : error.message;
			}
			errorMessage = message;
		} finally {
			pending = false;
		}
	};

	const saveProfile = async () => {
		pending = true;
		errorMessage = '';
		successMessage = '';
		try {
			await convexClient.mutation(api.profiles.updateMe, {
				firstName: profileForm.firstName.trim() || undefined,
				lastName: profileForm.lastName.trim() || undefined,
				username: profileForm.username.trim().toLowerCase() || undefined,
				about: profileForm.about.trim() || undefined,
				howDidYouFindUs: profileForm.howDidYouFindUs.trim() || undefined,
				identity: profileForm.identity.trim() || undefined,
				locationAddress: profileForm.locationAddress.trim() || undefined
			});
			successMessage = t('settingsPage.profileUpdated');
		} catch (error) {
			let message = t('settingsPage.saveProfileFailure');
			if (error instanceof Error) {
				const match = error.message.match(/ConvexError:\s*(.+?)(?:\s+at\s+|$)/);
				message = match ? match[1] : error.message;
			}
			errorMessage = message;
		} finally {
			pending = false;
		}
	};

	// Notification preferences (CL-715). Toggles persist immediately via preferences.upsert;
	// the local copy keeps the UI responsive and is initialized once from the server value.
	type NotificationPreferences = {
		clubMemberChanges: boolean;
		projectDeadlineReminder: boolean;
		projectMemberAdded: boolean;
		projectCompleted: boolean;
		sessionReminder: boolean;
		sessionActivityChanges: boolean;
		updateLikes: boolean;
		updateComments: boolean;
		chatMessages: boolean;
	};
	type NotificationPreferenceKey = keyof NotificationPreferences;
	let notificationPrefs = $state<NotificationPreferences | null>(null);

	$effect(() => {
		if (notificationPrefs) return;
		const data = preferencesResponse.data;
		if (!data) return;
		notificationPrefs = { ...data.notificationPreferences };
	});

	let notificationToggles = $derived(
		notificationPrefs
			? [
					{
						group: $_('settingsPage.notificationsSessionsGroup'),
						items: [
							{
								key: 'sessionReminder' as const,
								label: $_('settingsPage.notificationsSessionReminderLabel'),
								description: $_('settingsPage.notificationsSessionReminderDescription')
							},
							{
								key: 'sessionActivityChanges' as const,
								label: $_('settingsPage.notificationsSessionChangesLabel'),
								description: $_('settingsPage.notificationsSessionChangesDescription')
							}
						]
					},
					{
						group: $_('settingsPage.notificationsClubGroup'),
						items: [
							{
								key: 'clubMemberChanges' as const,
								label: $_('settingsPage.notificationsClubMemberChangesLabel'),
								description: $_('settingsPage.notificationsClubMemberChangesDescription')
							}
						]
					},
					{
						group: $_('settingsPage.notificationsProjectsGroup'),
						items: [
							{
								key: 'projectMemberAdded' as const,
								label: $_('settingsPage.notificationsProjectMembershipLabel'),
								description: $_('settingsPage.notificationsProjectMembershipDescription')
							},
							{
								key: 'projectCompleted' as const,
								label: $_('settingsPage.notificationsProjectUpdatesLabel'),
								description: $_('settingsPage.notificationsProjectUpdatesDescription')
							}
						]
					}
				]
			: []
	);

	const setNotificationPreference = async (key: NotificationPreferenceKey, value: boolean) => {
		if (!notificationPrefs) return;
		const previous = notificationPrefs[key];
		notificationPrefs[key] = value;
		try {
			await convexClient.mutation(api.preferences.upsert, {
				notificationPreferences: { ...notificationPrefs }
			});
		} catch {
			notificationPrefs[key] = previous;
			errorMessage = t('settingsPage.notificationsSaveFailure');
		}
	};

	const policyLinks = $derived(
		orderedLegalDocuments.length
			? orderedLegalDocuments.map((document) => ({
					label: document.fullName,
					href:
						document.documentKey === 'privacy_policy'
							? '/privacy'
							: document.documentKey === 'terms_and_conditions'
								? '/terms'
								: '/cookies'
				}))
			: [
					{ label: $_('settingsPage.openPrivacyPolicy'), href: '/privacy' },
					{ label: $_('settingsPage.openTerms'), href: '/terms' },
					{ label: $_('settingsPage.openCookies'), href: '/cookies' }
				]
	);
</script>

<PageHeaderBackButton fallbackHref={routes.profile} />
<PageHeaderTitle title="Settings" />

<div class="grid grid-cols-1 gap-4">
	{#if errorMessage}
		<Alert variant="destructive">
			<AlertTitle>{$_('settingsPage.errorTitle')}</AlertTitle>
			<AlertDescription>{errorMessage}</AlertDescription>
		</Alert>
	{/if}
	{#if successMessage}
		<Alert>
			<AlertTitle>{$_('settingsPage.successTitle')}</AlertTitle>
			<AlertDescription>{successMessage}</AlertDescription>
		</Alert>
	{/if}

	<Card>
		<CardHeader class="flex flex-col gap-2">
			<CardTitle>Profile</CardTitle>
			<CardDescription>Keep your account details up to date.</CardDescription>
		</CardHeader>
		<CardContent class="grid grid-cols-1 gap-3 lg:grid-cols-2">
			<div class="flex items-center gap-3 rounded-md border border-border p-3 lg:col-span-2">
				<Avatar class="size-14">
					<AvatarImage src={displayProfileImageUrl ?? undefined} alt="Profile image" />
					<AvatarFallback>{profileInitials}</AvatarFallback>
				</Avatar>
				<div class="flex flex-1 flex-col gap-2">
					<p class="text-sm font-medium">Profile image</p>
					<FileDropZone.Root
						accept={profileImageField.accept}
						maxFiles={1}
						fileCount={0}
						maxFileSize={profileImageField.maxBytes}
						disabled={pending || profileImageField.isBusy}
						onUpload={handleProfileImageUpload}
					>
						<FileDropZone.Trigger>
							<div
								class="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
							>
								{profileImageField.isBusy ? 'Uploading...' : 'Upload image'}
							</div>
						</FileDropZone.Trigger>
					</FileDropZone.Root>
				</div>
			</div>
			<div class="flex flex-col gap-2">
				<Label for="firstName">First name</Label>
				<Input id="firstName" bind:value={profileForm.firstName} />
			</div>
			<div class="flex flex-col gap-2">
				<Label for="lastName">Last name</Label>
				<Input id="lastName" bind:value={profileForm.lastName} />
			</div>
			<div class="flex flex-col gap-2 lg:col-span-2">
				<Label for="username">Username</Label>
				<Input
					id="username"
					bind:value={profileForm.username}
					onblur={() => {
						void checkUsername();
					}}
				/>
				{#if checkingUsername}
					<p class="text-xs text-muted-foreground">Checking availability...</p>
				{:else if usernameAvailable === true}
					<p class="text-xs text-emerald-600">Username is available.</p>
				{:else if usernameAvailable === false}
					<p class="text-xs text-destructive">Username is already taken.</p>
				{/if}
			</div>
			<div class="flex flex-col gap-2 lg:col-span-2">
				<Label for="about">About</Label>
				<Textarea id="about" bind:value={profileForm.about} rows={4} />
			</div>
			<div class="flex flex-col gap-2">
				<Label for="identity">I am a...</Label>
				<Input
					id="identity"
					bind:value={profileForm.identity}
					placeholder="Teacher, Parent, Student"
				/>
			</div>
			<div class="flex flex-col gap-2">
				<Label for="location">Location</Label>
				<Input id="location" bind:value={profileForm.locationAddress} />
			</div>
			<div class="flex flex-col gap-2 lg:col-span-2">
				<Label for="howFound">How did you find us?</Label>
				<Input id="howFound" bind:value={profileForm.howDidYouFindUs} />
			</div>
			<Button disabled={pending} class="lg:col-span-2" onclick={() => void saveProfile()}
				>Save profile</Button
			>
		</CardContent>
	</Card>

	<Card>
		<CardHeader class="flex flex-col gap-2">
			<CardTitle>{$_('settingsPage.notificationsTitle')}</CardTitle>
			<CardDescription>{$_('settingsPage.notificationsDescription')}</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			{#if !notificationPrefs}
				<p class="text-sm text-muted-foreground">...</p>
			{:else}
				{#each notificationToggles as section (section.group)}
					<div class="flex flex-col gap-2">
						<p class="text-sm font-semibold text-foreground">{section.group}</p>
						{#each section.items as item (item.key)}
							<div
								class="flex items-start justify-between gap-4 rounded-lg border border-border/70 p-3"
							>
								<div class="flex flex-col gap-1">
									<Label for={`notification-${item.key}`}>{item.label}</Label>
									<p class="text-sm text-muted-foreground">{item.description}</p>
								</div>
								<Switch
									id={`notification-${item.key}`}
									checked={notificationPrefs[item.key]}
									onCheckedChange={(value) => void setNotificationPreference(item.key, value)}
									class="mt-1 shrink-0"
								/>
							</div>
						{/each}
					</div>
				{/each}
				<div class="flex flex-col gap-2">
					<p class="text-sm font-semibold text-foreground">
						{$_('settingsPage.notificationsCriticalGroup')}
					</p>
					<div
						class="flex items-start justify-between gap-4 rounded-lg border border-border/70 bg-muted/40 p-3"
					>
						<p class="text-sm text-muted-foreground">
							{$_('settingsPage.notificationsCriticalDescription')}
						</p>
						<Switch checked disabled class="mt-1 shrink-0" />
					</div>
				</div>
			{/if}
		</CardContent>
	</Card>

	<Card>
		<CardHeader class="flex flex-col gap-2">
			<CardTitle>{$_('settingsPage.policiesTitle')}</CardTitle>
			<CardDescription>{$_('settingsPage.policiesDescription')}</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-2">
			{#each policyLinks as link (link.href)}
				<Button href={link.href} variant="outline" class="justify-start">{link.label}</Button>
			{/each}
		</CardContent>
	</Card>
</div>
