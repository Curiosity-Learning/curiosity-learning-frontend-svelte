<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { env } from '$env/dynamic/public';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Doc, Id } from '$convex/_generated/dataModel';
	import {
		ConfirmDialog,
		LoadingState,
		PageHeaderBackButton,
		PageHeaderTitle
	} from '$lib/components/app';
	import LocationAutocompleteField from '$lib/components/app/location-autocomplete-field.svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { MAPBOX_STYLE_URL, type MapboxCoordinates } from '$lib/maps/mapbox';
	import { routes } from '$lib/routes';
	import { _, t } from '$lib/i18n';
	import type { DayOfWeek } from '$lib/domain/schedule';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { FieldLabel } from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';
	import { useConvexClient } from 'convex-svelte';

	const convexClient = useConvexClient();
	const clubsResponse = useStableQuery(api.clubs.getMyClubs, {});
	const mapboxAccessToken = env.PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';

	let clubId = $derived((page.params as Record<string, string | undefined>).clubId ?? null);
	let clubIdTyped = $derived(clubId ? (clubId as Id<'clubs'>) : null);
	let clubItem = $derived(
		clubId ? ((clubsResponse.data ?? []).find((club) => club.clubId === clubId) ?? null) : null
	);
	let canEditClub = $derived(clubItem?.rolePermissions.includes('club:edit') ?? false);

	const scheduleSlotsResponse = useStableQuery(api.clubScheduleSlots.listByClub, () =>
		clubIdTyped ? { clubId: clubIdTyped } : 'skip'
	);
	let scheduleSlots = $derived(scheduleSlotsResponse.data ?? []);

	let initializedClubId = $state<string | null>(null);
	let locationCoordinates = $state<MapboxCoordinates | null>(null);
	let pending = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');
	let form = $state({
		name: '',
		description: '',
		location: '',
		discoverable: false
	});

	$effect(() => {
		if (!clubItem || initializedClubId === clubItem.clubId) return;
		form = {
			name: clubItem.clubName,
			description: clubItem.clubDescription ?? '',
			location: clubItem.clubLocation ?? '',
			discoverable: clubItem.clubDiscoverable
		};
		locationCoordinates =
			clubItem.clubLocation &&
			typeof clubItem.clubLocationLatitude === 'number' &&
			typeof clubItem.clubLocationLongitude === 'number'
				? {
						latitude: clubItem.clubLocationLatitude,
						longitude: clubItem.clubLocationLongitude
					}
				: null;
		initializedClubId = clubItem.clubId;
	});

	const saveClub = async () => {
		const name = form.name.trim();
		if (!clubIdTyped || !canEditClub || !name) {
			errorMessage = name ? t('clubSettingsPage.permissionDenied') : t('clubSettingsPage.nameRequired');
			successMessage = '';
			return;
		}

		pending = true;
		errorMessage = '';
		successMessage = '';
		try {
			await convexClient.mutation(api.clubs.updateClub, {
				clubId: clubIdTyped,
				name,
				description: form.description.trim() || null,
				location: form.location.trim() || null,
				locationLatitude: locationCoordinates?.latitude ?? null,
				locationLongitude: locationCoordinates?.longitude ?? null,
				discoverable: form.discoverable
			});
			successMessage = t('clubSettingsPage.saveSuccessDescription');
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : t('clubSettingsPage.saveErrorTitle');
		} finally {
			pending = false;
		}
	};

	// ── Invite code reset ────────────────────────────────────────────────
	let resetCodeDialogOpen = $state(false);
	let resetCodePending = $state(false);

	const resetClubCode = async () => {
		if (!clubIdTyped || !canEditClub) return;
		resetCodePending = true;
		errorMessage = '';
		successMessage = '';
		try {
			await convexClient.mutation(api.clubs.resetClubCode, { clubId: clubIdTyped });
			successMessage = t('clubSettingsPage.resetCodeSuccess');
			resetCodeDialogOpen = false;
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : t('clubSettingsPage.resetCodeFailure');
		} finally {
			resetCodePending = false;
		}
	};

	// ── Schedule slots ───────────────────────────────────────────────────
	const DAY_OPTIONS: DayOfWeek[] = [
		'monday',
		'tuesday',
		'wednesday',
		'thursday',
		'friday',
		'saturday',
		'sunday'
	];

	type SlotForm = {
		dayOfWeek: DayOfWeek;
		startTime: string;
		endTime: string;
		location: string;
	};

	const buildEmptySlotForm = (): SlotForm => ({
		dayOfWeek: 'monday',
		startTime: '16:00',
		endTime: '17:00',
		location: ''
	});

	let slotDialogOpen = $state(false);
	let editingSlot = $state<Doc<'clubScheduleSlots'> | null>(null);
	let slotForm = $state<SlotForm>(buildEmptySlotForm());
	let slotErrorMessage = $state('');
	let slotPending = $state(false);

	const openAddSlotDialog = () => {
		editingSlot = null;
		slotForm = buildEmptySlotForm();
		slotErrorMessage = '';
		slotDialogOpen = true;
	};

	const openEditSlotDialog = (slot: Doc<'clubScheduleSlots'>) => {
		editingSlot = slot;
		slotForm = {
			dayOfWeek: slot.dayOfWeek,
			startTime: slot.startTime,
			endTime: slot.endTime,
			location: slot.location
		};
		slotErrorMessage = '';
		slotDialogOpen = true;
	};

	const saveSlot = async () => {
		if (!clubIdTyped) return;
		const location = slotForm.location.trim();
		if (slotForm.endTime <= slotForm.startTime) {
			slotErrorMessage = t('clubSettingsPage.slotEndAfterStart');
			return;
		}
		if (!location) {
			slotErrorMessage = t('clubSettingsPage.slotLocationRequired');
			return;
		}

		slotPending = true;
		slotErrorMessage = '';
		try {
			if (editingSlot) {
				await convexClient.mutation(api.clubScheduleSlots.update, {
					slotId: editingSlot._id,
					dayOfWeek: slotForm.dayOfWeek,
					startTime: slotForm.startTime,
					endTime: slotForm.endTime,
					location
				});
			} else {
				await convexClient.mutation(api.clubScheduleSlots.create, {
					clubId: clubIdTyped,
					dayOfWeek: slotForm.dayOfWeek,
					startTime: slotForm.startTime,
					endTime: slotForm.endTime,
					location
				});
			}
			slotDialogOpen = false;
		} catch (error) {
			slotErrorMessage =
				error instanceof Error ? error.message : t('clubSettingsPage.slotSaveFailure');
		} finally {
			slotPending = false;
		}
	};

	let removeSlotDialogOpen = $state(false);
	let removeSlotTarget = $state<Doc<'clubScheduleSlots'> | null>(null);

	const openRemoveSlotDialog = (slot: Doc<'clubScheduleSlots'>) => {
		removeSlotTarget = slot;
		removeSlotDialogOpen = true;
	};

	const removeSlot = async () => {
		const slot = removeSlotTarget;
		if (!slot) return;
		errorMessage = '';
		try {
			await convexClient.mutation(api.clubScheduleSlots.remove, { slotId: slot._id });
		} catch (error) {
			errorMessage =
				error instanceof Error ? error.message : t('clubSettingsPage.slotRemoveFailure');
		}
	};

	const dayLabel = (day: DayOfWeek) => t(`clubSettingsPage.days.${day}`);
</script>

<PageHeaderBackButton fallbackHref={clubId ? routes.clubHome(clubId) : '/'} preferFallback />
<PageHeaderTitle title={$_('clubSettingsPage.title')} />

{#if clubsResponse.isLoading}
	<LoadingState label={$_('clubSettingsPage.title')} />
{:else if !clubItem}
	<Alert variant="destructive">
		<AlertTitle>{$_('clubSettingsPage.notFoundTitle')}</AlertTitle>
		<AlertDescription>{$_('clubSettingsPage.notFoundDescription')}</AlertDescription>
	</Alert>
{:else if !canEditClub}
	<Alert variant="destructive">
		<AlertTitle>{$_('clubSettingsPage.accessDeniedTitle')}</AlertTitle>
		<AlertDescription>{$_('clubSettingsPage.accessDeniedDescription')}</AlertDescription>
	</Alert>
{:else}
	<div class="flex w-full flex-col gap-4">
		{#if errorMessage}
			<Alert variant="destructive">
				<AlertTitle>{$_('clubSettingsPage.saveErrorTitle')}</AlertTitle>
				<AlertDescription>{errorMessage}</AlertDescription>
			</Alert>
		{/if}
		{#if successMessage}
			<Alert>
				<AlertTitle>{$_('clubSettingsPage.saveSuccessTitle')}</AlertTitle>
				<AlertDescription>{successMessage}</AlertDescription>
			</Alert>
		{/if}

		<Card>
			<CardHeader class="flex flex-col gap-2">
				<CardTitle>{$_('clubSettingsPage.detailsTitle')}</CardTitle>
				<CardDescription>{$_('clubSettingsPage.detailsDescription')}</CardDescription>
			</CardHeader>
			<CardContent class="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<div class="flex flex-col gap-2 lg:col-span-2">
					<Label for="clubName">{$_('clubSettingsPage.nameLabel')}</Label>
					<Input id="clubName" bind:value={form.name} required maxlength={100} />
				</div>

				<div class="flex flex-col gap-2 lg:col-span-2">
					<Label for="clubDescription">{$_('clubSettingsPage.descriptionLabel')}</Label>
					<Textarea id="clubDescription" bind:value={form.description} rows={5} maxlength={500} />
				</div>

				<div class="lg:col-span-2">
					<LocationAutocompleteField
						id="clubLocation"
						label={$_('clubSettingsPage.locationLabel')}
						bind:value={form.location}
						bind:coordinates={locationCoordinates}
						accessToken={mapboxAccessToken}
						placeholder={$_('clubSettingsPage.locationPlaceholder')}
						showPreview={true}
						previewStyleUrl={MAPBOX_STYLE_URL}
					/>
				</div>

				<div class="flex items-start justify-between gap-4 rounded-lg border border-border/70 p-3 lg:col-span-2">
					<div class="flex flex-col gap-1">
						<Label for="clubDiscoverable">{$_('clubSettingsPage.discoverableLabel')}</Label>
						<p class="text-sm text-muted-foreground">
							{$_('clubSettingsPage.discoverableDescription')}
						</p>
					</div>
					<Switch id="clubDiscoverable" bind:checked={form.discoverable} class="mt-1 shrink-0" />
				</div>

				<div class="flex flex-col gap-2 lg:col-span-2">
					<Label for="clubCode">{$_('clubSettingsPage.inviteCodeLabel')}</Label>
					<Input
						id="clubCode"
						value={clubItem.clubCode ?? $_('clubSettingsPage.noInviteCode')}
						readonly
					/>
					<Button
						variant="outline"
						class="w-fit"
						onclick={() => (resetCodeDialogOpen = true)}
					>
						{$_('clubSettingsPage.resetCodeButton')}
					</Button>
				</div>

				<Button
					class="lg:col-span-2"
					disabled={pending || !form.name.trim()}
					onclick={() => void saveClub()}
				>
					{pending ? $_('clubSettingsPage.saving') : $_('clubSettingsPage.saveButton')}
				</Button>
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="flex flex-row items-center justify-between gap-2">
				<div class="flex flex-col gap-2">
					<CardTitle>{$_('clubSettingsPage.scheduleTitle')}</CardTitle>
					<CardDescription>{$_('clubSettingsPage.scheduleDescription')}</CardDescription>
				</div>
				<Button variant="outline" size="icon" aria-label={$_('clubSettingsPage.addSlotButton')} onclick={openAddSlotDialog}>
					<PlusIcon class="size-4" />
				</Button>
			</CardHeader>
			<CardContent class="flex flex-col gap-3">
				{#if scheduleSlotsResponse.isLoading}
					<LoadingState label={$_('clubSettingsPage.scheduleTitle')} />
				{:else if scheduleSlots.length === 0}
					<p class="text-sm text-muted-foreground">{$_('clubSettingsPage.scheduleEmpty')}</p>
				{:else}
					{#each scheduleSlots as slot (slot._id)}
						<div
							class="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2"
						>
							<div class="flex min-w-0 flex-col">
								<span class="font-medium">{dayLabel(slot.dayOfWeek)}</span>
								<span class="truncate text-sm text-muted-foreground"
									>{slot.startTime}–{slot.endTime} · {slot.location}</span
								>
							</div>
							<div class="flex shrink-0 items-center gap-1">
								<Button
									variant="ghost"
									size="icon"
									aria-label={$_('clubSettingsPage.editSlotTitle')}
									onclick={() => openEditSlotDialog(slot)}
								>
									<PencilIcon class="size-4" />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									aria-label={$_('clubSettingsPage.slotRemove')}
									onclick={() => openRemoveSlotDialog(slot)}
								>
									<Trash2Icon class="size-4" />
								</Button>
							</div>
						</div>
					{/each}
				{/if}
			</CardContent>
		</Card>
	</div>

	<Dialog.Root bind:open={resetCodeDialogOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>{$_('clubSettingsPage.resetCodeConfirmTitle')}</Dialog.Title>
				<Dialog.Description>
					{$_('clubSettingsPage.resetCodeConfirmDescription')}
				</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (resetCodeDialogOpen = false)}>
					{$_('clubSettingsPage.resetCodeCancel')}
				</Button>
				<Button
					variant="destructive"
					disabled={resetCodePending}
					onclick={() => void resetClubCode()}
				>
					{resetCodePending ? $_('common.saving') : $_('clubSettingsPage.resetCodeConfirmAction')}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={slotDialogOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>
					{editingSlot
						? $_('clubSettingsPage.editSlotTitle')
						: $_('clubSettingsPage.addSlotTitle')}
				</Dialog.Title>
			</Dialog.Header>
			<div class="flex flex-col gap-3">
				{#if slotErrorMessage}
					<Alert variant="destructive">
						<AlertDescription>{slotErrorMessage}</AlertDescription>
					</Alert>
				{/if}
				<div class="flex flex-col gap-2">
					<FieldLabel for="slotDay" required>{$_('clubSettingsPage.dayLabel')}</FieldLabel>
					<Select.Root type="single" bind:value={slotForm.dayOfWeek}>
						<Select.Trigger id="slotDay" class="w-full justify-between">
							<span>{dayLabel(slotForm.dayOfWeek)}</span>
						</Select.Trigger>
						<Select.Content>
							{#each DAY_OPTIONS as day (day)}
								<Select.Item value={day} label={dayLabel(day)}>{dayLabel(day)}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div class="flex flex-col gap-2">
						<FieldLabel for="slotStartTime" required
							>{$_('clubSettingsPage.startTimeLabel')}</FieldLabel
						>
						<Input id="slotStartTime" type="time" bind:value={slotForm.startTime} />
					</div>
					<div class="flex flex-col gap-2">
						<FieldLabel for="slotEndTime" required>{$_('clubSettingsPage.endTimeLabel')}</FieldLabel>
						<Input id="slotEndTime" type="time" bind:value={slotForm.endTime} />
					</div>
				</div>
				<div class="flex flex-col gap-2">
					<FieldLabel for="slotLocation" required
						>{$_('clubSettingsPage.slotLocationLabel')}</FieldLabel
					>
					<Input
						id="slotLocation"
						bind:value={slotForm.location}
						placeholder={$_('clubSettingsPage.slotLocationPlaceholder')}
					/>
				</div>
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (slotDialogOpen = false)}>
					{$_('clubSettingsPage.slotCancel')}
				</Button>
				<Button disabled={slotPending} onclick={() => void saveSlot()}>
					{slotPending ? $_('common.saving') : $_('clubSettingsPage.slotSave')}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}

<ConfirmDialog
	bind:open={removeSlotDialogOpen}
	title={t('clubSettingsPage.slotRemoveConfirm')}
	confirmLabel={t('clubSettingsPage.slotRemove')}
	variant="destructive"
	onConfirm={removeSlot}
/>
