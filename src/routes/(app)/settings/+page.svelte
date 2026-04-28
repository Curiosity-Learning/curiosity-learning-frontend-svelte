<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto, preloadCode } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as FileDropZone from '$lib/components/ui/file-drop-zone';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Badge } from '$lib/components/ui/badge';
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
	import { Separator } from '$lib/components/ui/separator';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';
	import { _, t } from '$lib/i18n';
	import { createMediaField } from '$lib/media/media-field.svelte';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
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
	const clubsResponse = useStableQuery(api.clubs.getMyClubs, {});
	const activeContextResponse = useStableQuery(api.clubs.getActiveClubContext, {});
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
	let preferencesInitialized = $state(false);
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

	let preferencesForm = $state({
		theme: 'system' as 'light' | 'dark' | 'system',
		notificationsEnabled: true,
		notificationPreferences: {
			clubMemberChanges: true,
			projectDeadlineReminder: true,
			projectMemberAdded: true,
			projectCompleted: true,
			sessionReminder: true,
			sessionActivityChanges: true,
			updateLikes: true,
			updateComments: true,
			chatMessages: true
		}
	});
	const notificationPreferenceKeys = [
		'clubMemberChanges',
		'projectDeadlineReminder',
		'projectMemberAdded',
		'projectCompleted',
		'sessionReminder',
		'sessionActivityChanges',
		'updateLikes',
		'updateComments',
		'chatMessages'
	] as const;

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

	$effect(() => {
		if (preferencesInitialized) return;
		if (!preferencesResponse.data) return;
		preferencesForm = {
			theme: preferencesResponse.data.theme,
			notificationsEnabled: preferencesResponse.data.notificationsEnabled,
			notificationPreferences: preferencesResponse.data.notificationPreferences
		};
		preferencesInitialized = true;
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

	const savePreferences = async () => {
		pending = true;
		errorMessage = '';
		successMessage = '';
		try {
			await convexClient.mutation(api.preferences.upsert, {
				theme: preferencesForm.theme,
				notificationsEnabled: preferencesForm.notificationsEnabled,
				notificationPreferences: preferencesForm.notificationPreferences
			});
			successMessage = t('settingsPage.preferencesSaved');
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : t('settingsPage.savePreferencesFailure');
		} finally {
			pending = false;
		}
	};

	const switchActiveClub = async (clubId: Id<'clubs'>) => {
		errorMessage = '';
		successMessage = '';
		// Instant UX: navigate immediately and persist the preference in the background.
		// Security is still enforced by Convex permission checks per query/mutation.
		await goto(resolve(`/club/${clubId}/sessions`));

		pending = true;
		try {
			await convexClient.mutation(api.clubs.switchActiveClub, { clubId });
			await convexClient.mutation(api.preferences.upsert, { activeClubId: clubId });
			successMessage = t('settingsPage.activeClubUpdated');
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('settingsPage.switchClubFailure');
		} finally {
			pending = false;
		}
	};

	const setNotificationPreference = (
		key: (typeof notificationPreferenceKeys)[number],
		checked: boolean
	) => {
		preferencesForm.notificationPreferences = {
			...preferencesForm.notificationPreferences,
			[key]: checked
		};
	};
</script>

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
			<CardTitle>Preferences</CardTitle>
			<CardDescription>Theme and notification settings.</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			<div class="flex flex-col gap-2">
				<p class="text-sm font-medium">Theme</p>
				<div class="flex flex-wrap gap-2">
					<Button
						size="sm"
						variant={preferencesForm.theme === 'system' ? 'default' : 'outline'}
						onclick={() => (preferencesForm.theme = 'system')}
					>
						System
					</Button>
					<Button
						size="sm"
						variant={preferencesForm.theme === 'light' ? 'default' : 'outline'}
						onclick={() => (preferencesForm.theme = 'light')}
					>
						Light
					</Button>
					<Button
						size="sm"
						variant={preferencesForm.theme === 'dark' ? 'default' : 'outline'}
						onclick={() => (preferencesForm.theme = 'dark')}
					>
						Dark
					</Button>
				</div>
			</div>

			<div class="flex items-center justify-between gap-2 rounded-md border border-border p-3">
				<div class="flex flex-col gap-1">
					<p class="font-medium">Notifications enabled</p>
					<p class="text-xs text-muted-foreground">Master toggle for all app notifications.</p>
				</div>
				<Switch bind:checked={preferencesForm.notificationsEnabled} />
			</div>

			<div class="grid grid-cols-1 gap-2 lg:grid-cols-2">
				{#each notificationPreferenceKeys as key (key)}
					<div class="flex items-center justify-between gap-2 rounded-md border border-border p-3">
						<p class="text-sm">{key}</p>
						<Switch
							checked={preferencesForm.notificationPreferences[key]}
							onCheckedChange={(checked) => setNotificationPreference(key, checked)}
						/>
					</div>
				{/each}
			</div>

			<Button disabled={pending} onclick={() => void savePreferences()}>Save preferences</Button>
		</CardContent>
	</Card>

	<Card>
		<CardHeader class="flex flex-col gap-2">
			<CardTitle>Active club</CardTitle>
			<CardDescription>Switch your active club workspace.</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-3">
			<div class="flex flex-wrap gap-2">
				{#each clubsResponse.data ?? [] as club (club.clubId)}
					<Button
						size="sm"
						variant={club.clubId === activeContextResponse.data?.activeClubId
							? 'default'
							: 'outline'}
						disabled={pending || club.clubId === activeContextResponse.data?.activeClubId}
						onpointerenter={() => void preloadCode(`/club/${club.clubId}`)}
						onclick={() => void switchActiveClub(club.clubId)}
					>
						{club.clubName}
					</Button>
				{/each}
				<Button size="sm" variant="outline" href={routes.newClub}>New club</Button>
			</div>
		</CardContent>
	</Card>

	<Card>
		<CardHeader class="flex flex-col gap-2">
			<CardTitle>{$_('settingsPage.policiesTitle')}</CardTitle>
			<CardDescription>{$_('settingsPage.policiesDescription')}</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-3">
			{#if orderedLegalDocuments.length}
				{#each orderedLegalDocuments as document (document._id)}
					<div class="flex flex-col gap-2 rounded-lg border border-border p-3">
						<div class="flex flex-wrap items-center gap-2">
							<Badge variant="outline">{document.fullName}</Badge>
							<Badge variant="outline">Version {document.version}</Badge>
						</div>
						<p class="max-h-24 overflow-auto text-sm text-muted-foreground">{document.content}</p>
					</div>
				{/each}
			{/if}
			<Separator />
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
				<Button href="/privacy" variant="outline">{$_('settingsPage.openPrivacyPolicy')}</Button>
				<Button href="/terms" variant="outline">{$_('settingsPage.openTerms')}</Button>
				<Button href="/cookies" variant="outline">{$_('settingsPage.openCookies')}</Button>
			</div>
		</CardContent>
	</Card>

	<Card>
		<CardHeader class="flex flex-col gap-2">
			<CardTitle>Developer tools</CardTitle>
			<CardDescription>Manual test surfaces for shared infrastructure.</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-3">
			<p class="text-sm text-muted-foreground">
				Use the media upload test page to exercise begin, upload, finalize, retry, and cancel flows
				against the shared S3-backed pipeline.
			</p>
			<Button href={routes.settingsMediaUploadDev} variant="outline">Open media upload test</Button>
		</CardContent>
	</Card>
</div>
