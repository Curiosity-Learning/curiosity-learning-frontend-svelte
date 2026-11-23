<script lang="ts">
	import { onDestroy, tick } from 'svelte';
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
	import * as Dialog from '$lib/components/ui/dialog';
	import { _, t } from '$lib/i18n';
	import { createMediaField } from '$lib/media/media-field.svelte';
	import { PageHeaderBackButton, PageHeaderTitle } from '$lib/components/app';
	import { api } from '$convex/_generated/api';
	import { useConvexClient } from 'convex-svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { authClient } from '$lib/auth-client';
	import { signOutAndGoToSignIn } from '$lib/auth/sign-out';
	import { routes } from '$lib/routes';
	import { Badge } from '$lib/components/ui/badge';
	import { showGlobalSnackbar } from '$lib/components/app/snackbar';
	import {
		FRESH_SESSION_REQUIRED,
		NOTIFICATION_EMAIL_IS_PARENT,
		OWN_EMAIL_REQUIRED,
		RESEND_LIMIT_REACHED,
		UNLINK_REQUIRES_CONFIRMED_EMAIL,
		CHILD_NOTIFICATIONS_ANCHOR,
		hasErrorCode
	} from '$lib/domain/child-notification-email';
	import ChildEmailSettings from '$lib/components/app/child-email-settings.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const session = authClient.useSession();
	const convexClient = useConvexClient();
	const profileResponse = useStableQuery(api.profiles.getMe, {});
	const preferencesResponse = useStableQuery(api.preferences.get, {});
	const legalDocumentsResponse = useStableQuery(api.legalDocuments.listActive, () =>
		$session.data ? {} : 'skip'
	);

	// Parent side (CL-801): the parent's email settings for each linked child. Viewing the app as
	// a child lives in the bar above the app; links are claimed by the app layout. Child side:
	// whether this account has a linked parent, and whether they're old enough (>=16) to unlink it
	// themselves.
	const linkedChildrenResponse = useStableQuery(api.parentAccounts.getMyLinkedChildren, () =>
		$session.data ? {} : 'skip'
	);
	const myParentLinkResponse = useStableQuery(api.parentAccounts.getMyParentLink, () =>
		$session.data ? {} : 'skip'
	);
	let linkedChildren = $derived(linkedChildrenResponse.data ?? []);
	// Emails about a child link to #child-notifications (through /child/[id]?settings=emails); the
	// card only renders once the query loads, so the browser's own jump to the anchor misses it.
	// Scroll once it exists.
	let scrolledToChildNotifications = false;
	$effect(() => {
		if (scrolledToChildNotifications || linkedChildren.length === 0) return;
		if (window.location.hash !== `#${CHILD_NOTIFICATIONS_ANCHOR}`) return;
		scrolledToChildNotifications = true;
		void tick().then(() =>
			document.getElementById(CHILD_NOTIFICATIONS_ANCHOR)?.scrollIntoView({ block: 'start' })
		);
	});
	let myParentLink = $derived(myParentLinkResponse.data ?? null);

	const childDisplayName = (child: {
		firstName: string | null;
		lastName: string | null;
		username: string | null;
	}) =>
		[child.firstName, child.lastName].filter(Boolean).join(' ').trim() ||
		child.username ||
		t('profileDetail.fallbackName');

	let unlinkDialogOpen = $state(false);
	let unlinkPending = $state(false);
	let unlinkError = $state('');

	const confirmUnlinkParent = async () => {
		if (!myParentLink) return;
		unlinkPending = true;
		unlinkError = '';
		try {
			await convexClient.mutation(api.parentAccounts.unlinkParent, {
				parentProfileId: myParentLink.parentProfileId
			});
			successMessage = t('parentAccounts.unlinkSuccess');
			unlinkDialogOpen = false;
		} catch (error) {
			unlinkError = hasErrorCode(error, UNLINK_REQUIRES_CONFIRMED_EMAIL)
				? t('parentAccounts.unlinkRequiresEmail')
				: t('parentAccounts.unlinkFailure');
		} finally {
			unlinkPending = false;
		}
	};

	// CL-769 (review D4, edge case 13): a child aged 16+ owns their own notification email —
	// the same pending -> confirm flow as an address their parent adds — and must have a
	// confirmed one before unlinking their parent, because after that every email about them
	// (important notices included) goes to that address only. getMyNotificationEmail is null for
	// everyone else (adults, under-16 children), so the card never shows for them; the server
	// refuses the mutation the same way. Changes need a recent sign-in, like the parent's form.
	const myEmailResponse = useStableQuery(api.parentAccounts.getMyNotificationEmail, () =>
		$session.data ? {} : 'skip'
	);
	let myEmail = $derived(myEmailResponse.data ?? null);
	let myEmailConfirmed = $derived(myEmail?.status === 'verified');
	let editingMyEmail = $state(false);
	let myEmailDraft = $state('');
	let myEmailError = $state<string | null>(null);
	let myEmailFreshSignInRequired = $state(false);
	let savingMyEmail = $state(false);

	const myEmailErrorMessage = (error: unknown) => {
		if (hasErrorCode(error, NOTIFICATION_EMAIL_IS_PARENT))
			return t('parentAccounts.ownEmailIsParent');
		if (hasErrorCode(error, OWN_EMAIL_REQUIRED)) return t('parentAccounts.ownEmailRequired');
		if (hasErrorCode(error, RESEND_LIMIT_REACHED)) return t('parentAccounts.ownEmailResendLimit');
		if (error instanceof Error && /valid email/i.test(error.message)) {
			return t('parentAccounts.ownEmailInvalid');
		}
		return t('parentAccounts.ownEmailFailure');
	};

	// `email` null removes the address; the current pending address again is "Resend".
	const submitMyEmail = async (email: string | null) => {
		if (savingMyEmail) return;
		myEmailError = null;
		myEmailFreshSignInRequired = false;
		savingMyEmail = true;
		const isResend = email !== null && email === myEmail?.notificationEmail && !editingMyEmail;
		try {
			const result = await convexClient.mutation(api.parentAccounts.setMyNotificationEmail, {
				email
			});
			editingMyEmail = false;
			if (result.status === 'none') {
				showGlobalSnackbar({ title: t('parentAccounts.ownEmailRemoved') });
			} else if (result.verificationSent) {
				showGlobalSnackbar({
					title: t(isResend ? 'parentAccounts.ownEmailResent' : 'parentAccounts.ownEmailSaved')
				});
			}
		} catch (error) {
			if (hasErrorCode(error, FRESH_SESSION_REQUIRED)) {
				myEmailFreshSignInRequired = true;
			} else {
				myEmailError = myEmailErrorMessage(error);
			}
		} finally {
			savingMyEmail = false;
		}
	};

	let signingInAgain = $state(false);
	const signInAgain = async () => {
		signingInAgain = true;
		try {
			await signOutAndGoToSignIn(routes.settings);
		} finally {
			signingInAgain = false;
		}
	};
	// CL-769 (review S4): "Sign out everywhere". Sign-in links make sessions easy to leave
	// behind (a family computer, a forwarded email), and nothing else lets a parent end them.
	// Revokes every other session server-side, then signs this device out too.
	let signOutEverywhereDialogOpen = $state(false);
	let signOutEverywherePending = $state(false);
	let signOutEverywhereError = $state('');

	const confirmSignOutEverywhere = async () => {
		signOutEverywherePending = true;
		signOutEverywhereError = '';
		try {
			const { error } = await authClient.revokeOtherSessions();
			if (error) {
				signOutEverywhereError = t('settingsPage.devicesFailure');
				return;
			}
			signOutEverywhereDialogOpen = false;
			await signOutAndGoToSignIn();
		} catch {
			signOutEverywhereError = t('settingsPage.devicesFailure');
		} finally {
			signOutEverywherePending = false;
		}
	};

	// Review S8/D8: parent accounts are created without a password at consent approval and sign
	// in with emailed links. "Set a password" is Better Auth's reset flow (it creates the
	// credential account when there is none), sent to the caller's own address.
	const signInMethodsResponse = useStableQuery(api.auth.getMySignInMethods, () =>
		$session.data ? {} : 'skip'
	);
	let showSetPassword = $derived(
		signInMethodsResponse.data !== undefined &&
			!signInMethodsResponse.data.hasPassword &&
			!signInMethodsResponse.data.isChildAccount
	);
	let setPasswordPending = $state(false);
	let setPasswordSent = $state(false);
	let setPasswordError = $state('');

	const requestSetPasswordLink = async () => {
		const email = $session.data?.user.email;
		if (!email) return;
		setPasswordPending = true;
		setPasswordError = '';
		try {
			const redirectTo = new URL('/auth/reset-password', window.location.origin);
			redirectTo.searchParams.set('next', routes.settings);
			const { error } = await authClient.requestPasswordReset({
				email,
				redirectTo: redirectTo.toString()
			});
			if (error) {
				setPasswordError = t('settingsPage.passwordFailure');
				return;
			}
			setPasswordSent = true;
		} catch {
			setPasswordError = t('settingsPage.passwordFailure');
		} finally {
			setPasswordPending = false;
		}
	};

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
					<p class="type-body-medium">Profile image</p>
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
								class="type-control inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 transition-colors hover:bg-accent hover:text-accent-foreground"
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
					<p class="type-sm text-muted-foreground">Checking availability...</p>
				{:else if usernameAvailable === true}
					<p class="type-sm text-emerald-600">Username is available.</p>
				{:else if usernameAvailable === false}
					<p class="type-sm text-destructive">Username is already taken.</p>
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
				<p class="type-body-compact text-muted-foreground">...</p>
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
									<p class="type-body-compact text-muted-foreground">{item.description}</p>
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
						<p class="type-body-compact text-muted-foreground">
							{$_('settingsPage.notificationsCriticalDescription')}
						</p>
						<Switch checked disabled class="mt-1 shrink-0" />
					</div>
				</div>
			{/if}
		</CardContent>
	</Card>

	{#if linkedChildren.length > 0}
		<Card id={CHILD_NOTIFICATIONS_ANCHOR} class="scroll-mt-40">
			<CardHeader class="flex flex-col gap-2">
				<CardTitle>{$_('parentAccounts.childrenTitle')}</CardTitle>
				<CardDescription>{$_('parentAccounts.childrenDescription')}</CardDescription>
				<CardDescription>{$_('parentAccounts.notificationEmailCriticalNote')}</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-3">
				{#each linkedChildren as child (child.childProfileId)}
					<ChildEmailSettings
						childProfileId={child.childProfileId}
						displayName={childDisplayName(child)}
						notificationEmail={child.notificationEmail}
						notificationEmailSetAt={child.notificationEmailSetAt}
						notificationEmailVerified={child.notificationEmailVerified}
						parentNotificationSettings={child.parentNotificationSettings}
					/>
				{/each}
			</CardContent>
		</Card>
	{/if}

	{#if myEmail}
		<Card>
			<CardHeader class="flex flex-col gap-2">
				<div class="flex flex-wrap items-center gap-2">
					<CardTitle>{$_('parentAccounts.ownEmailTitle')}</CardTitle>
					{#if myEmailConfirmed && !editingMyEmail}
						<Badge variant="secondary">{$_('parentAccounts.ownEmailConfirmed')}</Badge>
					{/if}
				</div>
				<CardDescription>
					{myEmailConfirmed && !editingMyEmail
						? $_('parentAccounts.ownEmailDescriptionConfirmed')
						: $_('parentAccounts.ownEmailDescription')}
				</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-3">
				{#if myEmail.notificationEmail && !editingMyEmail}
					{#if myEmailConfirmed}
						<p class="type-sm text-muted-foreground">
							{$_('parentAccounts.ownEmailCurrent')}
							<span class="type-sm-bold text-foreground">{myEmail.notificationEmail}</span>
						</p>
					{:else}
						<p class="type-sm text-muted-foreground">
							{t('parentAccounts.ownEmailPending').replace('{email}', myEmail.notificationEmail)}
						</p>
						{#if !myEmail.hasLinkedParent}
							<p class="type-sm text-muted-foreground">
								{$_('parentAccounts.ownEmailPendingUnlinked')}
							</p>
						{/if}
					{/if}
				{/if}
				{#if myEmailFreshSignInRequired}
					<Alert class="flex flex-wrap items-center justify-between gap-3">
						<div class="flex flex-col gap-1">
							<AlertTitle>{$_('parentAccounts.notificationEmailFreshSessionTitle')}</AlertTitle>
							<AlertDescription>
								{$_('parentAccounts.notificationEmailFreshSession')}
							</AlertDescription>
						</div>
						<Button
							type="button"
							variant="outline"
							disabled={signingInAgain}
							onclick={() => void signInAgain()}
						>
							{$_('parentAccounts.notificationEmailSignInAgain')}
						</Button>
					</Alert>
				{/if}
				{#if editingMyEmail || !myEmail.notificationEmail}
					<form
						class="flex flex-col gap-3"
						onsubmit={(event) => {
							event.preventDefault();
							void submitMyEmail(myEmailDraft);
						}}
					>
						<div class="flex flex-col gap-1.5">
							<Label for="own-notification-email">{$_('parentAccounts.ownEmailLabel')}</Label>
							<Input
								id="own-notification-email"
								type="email"
								autocomplete="email"
								placeholder={$_('parentAccounts.ownEmailPlaceholder')}
								bind:value={myEmailDraft}
								disabled={savingMyEmail}
								aria-invalid={myEmailError ? true : undefined}
							/>
							{#if myEmailError}
								<p class="type-sm text-destructive">{myEmailError}</p>
							{/if}
						</div>
						<div class="flex flex-wrap gap-2">
							<Button type="submit" disabled={savingMyEmail || myEmailDraft.trim() === ''}>
								{$_('parentAccounts.ownEmailSave')}
							</Button>
							{#if editingMyEmail}
								<Button
									type="button"
									variant="outline"
									disabled={savingMyEmail}
									onclick={() => (editingMyEmail = false)}
								>
									{$_('parentAccounts.ownEmailCancel')}
								</Button>
							{/if}
						</div>
					</form>
				{:else}
					{#if myEmailError}
						<p class="type-sm text-destructive">{myEmailError}</p>
					{/if}
					<div class="flex flex-wrap gap-2">
						{#if !myEmailConfirmed}
							<Button
								type="button"
								disabled={savingMyEmail}
								onclick={() => void submitMyEmail(myEmail?.notificationEmail ?? null)}
							>
								{$_('parentAccounts.ownEmailResend')}
							</Button>
						{/if}
						<Button
							type="button"
							variant="outline"
							disabled={savingMyEmail}
							onclick={() => {
								myEmailDraft = myEmail?.notificationEmail ?? '';
								myEmailError = null;
								editingMyEmail = true;
							}}
						>
							{$_('parentAccounts.ownEmailChange')}
						</Button>
						{#if myEmail.hasLinkedParent}
							<Button
								type="button"
								variant="ghost"
								disabled={savingMyEmail}
								onclick={() => void submitMyEmail(null)}
							>
								{$_('parentAccounts.ownEmailRemove')}
							</Button>
						{/if}
					</div>
				{/if}
			</CardContent>
		</Card>
	{/if}

	{#if myParentLink}
		<Card>
			<CardHeader class="flex flex-col gap-2">
				<CardTitle>{$_('parentAccounts.linkedParentTitle')}</CardTitle>
				<CardDescription>{$_('parentAccounts.linkedParentDescription')}</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-3">
				<div class="flex items-center justify-between gap-4 rounded-lg border border-border/70 p-3">
					<p class="type-sm-bold text-foreground">
						{[myParentLink.parentFirstName, myParentLink.parentLastName]
							.filter(Boolean)
							.join(' ')
							.trim() || t('profileDetail.fallbackName')}
					</p>
					{#if myParentLink.canUnlink}
						<Button
							variant="outline"
							onclick={() => {
								unlinkError = '';
								unlinkDialogOpen = true;
							}}
						>
							{$_('parentAccounts.unlinkAction')}
						</Button>
					{/if}
				</div>
			</CardContent>
		</Card>
	{/if}

	{#if showSetPassword}
		<Card>
			<CardHeader class="flex flex-col gap-2">
				<CardTitle>{$_('settingsPage.passwordTitle')}</CardTitle>
				<CardDescription>{$_('settingsPage.passwordDescription')}</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-3">
				{#if setPasswordSent}
					<Alert>
						<AlertTitle>{$_('settingsPage.passwordSentTitle')}</AlertTitle>
						<AlertDescription>
							{$_('settingsPage.passwordSentDescription').replace(
								'{email}',
								$session.data?.user.email ?? ''
							)}
						</AlertDescription>
					</Alert>
				{:else}
					{#if setPasswordError}
						<Alert variant="destructive">
							<AlertDescription>{setPasswordError}</AlertDescription>
						</Alert>
					{/if}
					<Button
						variant="outline"
						class="justify-start"
						disabled={setPasswordPending}
						onclick={() => void requestSetPasswordLink()}
					>
						{setPasswordPending
							? $_('settingsPage.passwordSending')
							: $_('settingsPage.passwordSendLink')}
					</Button>
				{/if}
				<p class="text-sm text-muted-foreground">{$_('settingsPage.passwordLinksStillWork')}</p>
			</CardContent>
		</Card>
	{/if}

	<Card>
		<CardHeader class="flex flex-col gap-2">
			<CardTitle>{$_('settingsPage.devicesTitle')}</CardTitle>
			<CardDescription>{$_('settingsPage.devicesDescription')}</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-2">
			<Button
				variant="outline"
				class="justify-start"
				onclick={() => {
					signOutEverywhereError = '';
					signOutEverywhereDialogOpen = true;
				}}
			>
				{$_('settingsPage.devicesSignOutEverywhere')}
			</Button>
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

<Dialog.Root bind:open={unlinkDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{$_('parentAccounts.unlinkConfirmTitle')}</Dialog.Title>
			<Dialog.Description>
				{#if myEmailConfirmed}
					{t('parentAccounts.unlinkConfirmDescription').replace(
						'{email}',
						myEmail?.notificationEmail ?? ''
					)}
				{:else}
					{$_('parentAccounts.unlinkRequiresEmail')}
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		{#if unlinkError}
			<Alert variant="destructive">
				<AlertDescription>{unlinkError}</AlertDescription>
			</Alert>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (unlinkDialogOpen = false)} disabled={unlinkPending}>
				{$_('parentAccounts.unlinkCancel')}
			</Button>
			<Button
				variant="destructive"
				disabled={unlinkPending || !myEmailConfirmed}
				onclick={() => void confirmUnlinkParent()}
			>
				{$_('parentAccounts.unlinkConfirmAction')}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={signOutEverywhereDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{$_('settingsPage.devicesConfirmTitle')}</Dialog.Title>
			<Dialog.Description>{$_('settingsPage.devicesConfirmDescription')}</Dialog.Description>
		</Dialog.Header>
		{#if signOutEverywhereError}
			<Alert variant="destructive">
				<AlertDescription>{signOutEverywhereError}</AlertDescription>
			</Alert>
		{/if}
		<Dialog.Footer>
			<Button
				variant="outline"
				onclick={() => (signOutEverywhereDialogOpen = false)}
				disabled={signOutEverywherePending}
			>
				{$_('settingsPage.devicesCancel')}
			</Button>
			<Button
				variant="destructive"
				disabled={signOutEverywherePending}
				onclick={() => void confirmSignOutEverywhere()}
			>
				{signOutEverywherePending
					? $_('settingsPage.devicesSigningOut')
					: $_('settingsPage.devicesConfirmAction')}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
