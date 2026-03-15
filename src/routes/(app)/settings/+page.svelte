<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto, preloadCode } from '$app/navigation';
	import { resolve } from '$app/paths';
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
	import { _, locale, setAppLocale } from '$lib/i18n';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { authClient } from '$lib/auth-client';

	const session = authClient.useSession();
	const convexClient = useConvexClient();
	const profileResponse = useStableQuery(api.profiles.getMe, {});
	const preferencesResponse = useStableQuery(api.preferences.get, {});
	const legalDocumentsResponse = useStableQuery(api.legalDocuments.listActive, () =>
		$session.data ? {} : 'skip'
	);
	const clubsResponse = useStableQuery(api.clubs.getMyClubs, {});
	const activeContextResponse = useStableQuery(api.clubs.getActiveClubContext, {});

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
	let profileImageStorageId = $state<Id<'_storage'> | null>(null);
	let profileImageUploading = $state(false);
	let localProfilePreviewUrl = $state<string | null>(null);
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

	const revokeProfilePreview = () => {
		if (!localProfilePreviewUrl) return;
		URL.revokeObjectURL(localProfilePreviewUrl);
		localProfilePreviewUrl = null;
	};

	onDestroy(() => {
		revokeProfilePreview();
	});

	let displayProfileImageUrl = $derived(
		localProfilePreviewUrl ?? profileResponse.data?.coverPhotoUrl ?? null
	);

	let profileInitials = $derived(
		(profileForm.firstName || profileForm.lastName
			? `${profileForm.firstName.slice(0, 1)}${profileForm.lastName.slice(0, 1)}`
			: profileForm.username.slice(0, 2) || 'ME'
		).toUpperCase()
	);

	const handleProfileImageInput = async (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		revokeProfilePreview();
		localProfilePreviewUrl = URL.createObjectURL(file);
		profileImageUploading = true;
		errorMessage = '';
		successMessage = '';

		try {
			const uploadUrl = await convexClient.mutation(api.media.generateUploadUrl, {});
			const uploadResponse = await fetch(uploadUrl, {
				method: 'POST',
				headers: file.type ? { 'Content-Type': file.type } : undefined,
				body: file
			});
			if (!uploadResponse.ok) {
				throw new Error('Profile image upload failed');
			}
			const uploadResult = (await uploadResponse.json()) as { storageId?: Id<'_storage'> };
			if (!uploadResult.storageId) {
				throw new Error('Profile image upload failed');
			}
			profileImageStorageId = uploadResult.storageId;
			successMessage = 'Profile image uploaded. Click Save profile to apply changes.';
		} catch (error) {
			profileImageStorageId = null;
			errorMessage = error instanceof Error ? error.message : 'Unable to upload profile image.';
		} finally {
			profileImageUploading = false;
			input.value = '';
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
				profileImageStorageId: profileImageStorageId ?? undefined,
				about: profileForm.about.trim() || undefined,
				howDidYouFindUs: profileForm.howDidYouFindUs.trim() || undefined,
				identity: profileForm.identity.trim() || undefined,
				locationAddress: profileForm.locationAddress.trim() || undefined
			});
			profileImageStorageId = null;
			revokeProfilePreview();
			successMessage = 'Profile updated.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unable to save profile.';
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
			successMessage = 'Preferences saved.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unable to save preferences.';
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
			successMessage = 'Active club updated.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to switch club.';
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
			<AlertTitle>Settings update failed</AlertTitle>
			<AlertDescription>{errorMessage}</AlertDescription>
		</Alert>
	{/if}
	{#if successMessage}
		<Alert>
			<AlertTitle>Saved</AlertTitle>
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
					<div class="flex flex-wrap gap-2">
						<label for="profile-image-upload">
							<input
								id="profile-image-upload"
								type="file"
								accept="image/*"
								class="hidden"
								onchange={(event) => void handleProfileImageInput(event)}
								disabled={profileImageUploading || pending}
							/>
							<span
								class="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
							>
								{profileImageUploading ? 'Uploading...' : 'Upload image'}
							</span>
						</label>
					</div>
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
				<p class="text-sm font-medium">{$_('settings.language.label')}</p>
				<div class="flex flex-wrap gap-2">
					<Button
						size="sm"
						variant={$locale === 'en' ? 'default' : 'outline'}
						onclick={() => setAppLocale('en')}
					>
						{$_('settings.language.english')}
					</Button>
					<Button
						size="sm"
						variant={$locale === 'nl' ? 'default' : 'outline'}
						onclick={() => setAppLocale('nl')}
					>
						{$_('settings.language.dutch')}
					</Button>
				</div>
			</div>

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
			</div>
		</CardContent>
	</Card>

	<Card>
		<CardHeader class="flex flex-col gap-2">
			<CardTitle>Policies</CardTitle>
			<CardDescription>Privacy, terms and cookie information.</CardDescription>
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
				<Button href="/privacy" variant="outline">Open Privacy Policy</Button>
				<Button href="/terms" variant="outline">Open Terms and Conditions</Button>
				<Button href="/cookies" variant="outline">Open Cookie Policy</Button>
			</div>
		</CardContent>
	</Card>
</div>
