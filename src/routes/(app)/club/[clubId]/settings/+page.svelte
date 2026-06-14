<script lang="ts">
	import { env } from '$env/dynamic/public';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { LoadingState, PageHeaderBackButton, PageHeaderTitle } from '$lib/components/app';
	import LocationAutocompleteField from '$lib/components/app/location-autocomplete-field.svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { MAPBOX_STYLE_URL, type MapboxCoordinates } from '$lib/maps/mapbox';
	import { routes } from '$lib/routes';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
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
	let initializedClubId = $state<string | null>(null);
	let locationCoordinates = $state<MapboxCoordinates | null>(null);
	let pending = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');
	let form = $state({
		name: '',
		description: '',
		location: '',
		meetingDay: '',
		meetingTime: ''
	});

	$effect(() => {
		if (!clubItem || initializedClubId === clubItem.clubId) return;
		form = {
			name: clubItem.clubName,
			description: clubItem.clubDescription ?? '',
			location: clubItem.clubLocation ?? '',
			meetingDay: clubItem.clubMeetingDay ?? '',
			meetingTime: clubItem.clubMeetingTime ?? ''
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
			errorMessage = name
				? 'You do not have permission to edit this club.'
				: 'Club name is required.';
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
				meetingDay: form.meetingDay.trim() || null,
				meetingTime: form.meetingTime.trim() || null
			});
			successMessage = 'Club settings updated.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Unable to update club settings.';
		} finally {
			pending = false;
		}
	};
</script>

<PageHeaderBackButton fallbackHref={clubId ? routes.clubHome(clubId) : '/'} />
<PageHeaderTitle title="Club settings" />

{#if clubsResponse.isLoading}
	<LoadingState label="Loading club settings" />
{:else if !clubItem}
	<Alert variant="destructive">
		<AlertTitle>Club not found</AlertTitle>
		<AlertDescription>This club doesn't exist or you don't have access to it.</AlertDescription>
	</Alert>
{:else if !canEditClub}
	<Alert variant="destructive">
		<AlertTitle>Access denied</AlertTitle>
		<AlertDescription
			>Only club members with the <code>club:edit</code> permission can change club settings.</AlertDescription
		>
	</Alert>
{:else}
	<div class="flex w-full flex-col gap-4">
		{#if errorMessage}
			<Alert variant="destructive">
				<AlertTitle>Unable to save settings</AlertTitle>
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
				<CardTitle>Club details</CardTitle>
				<CardDescription
					>These details are visible to members and are editable through the club permission model.</CardDescription
				>
			</CardHeader>
			<CardContent class="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<div class="flex flex-col gap-2 lg:col-span-2">
					<Label for="clubName">Club name</Label>
					<Input id="clubName" bind:value={form.name} required maxlength={100} />
				</div>

				<div class="flex flex-col gap-2 lg:col-span-2">
					<Label for="clubDescription">Description</Label>
					<Textarea id="clubDescription" bind:value={form.description} rows={5} maxlength={500} />
				</div>

				<div class="lg:col-span-2">
					<LocationAutocompleteField
						id="clubLocation"
						label="Location"
						bind:value={form.location}
						bind:coordinates={locationCoordinates}
						accessToken={mapboxAccessToken}
						placeholder="Search for the club location"
						showPreview={true}
						previewStyleUrl={MAPBOX_STYLE_URL}
					/>
				</div>

				<div class="flex flex-col gap-2">
					<Label for="meetingDay">Meeting day</Label>
					<Input id="meetingDay" bind:value={form.meetingDay} placeholder="Tuesday" />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="meetingTime">Meeting time</Label>
					<Input id="meetingTime" bind:value={form.meetingTime} placeholder="16:00" />
				</div>

				<div class="flex flex-col gap-2 lg:col-span-2">
					<Label for="clubCode">Invite code</Label>
					<Input id="clubCode" value={clubItem.clubCode ?? 'No invite code'} readonly />
				</div>

				<Button
					class="lg:col-span-2"
					disabled={pending || !form.name.trim()}
					onclick={() => void saveClub()}
				>
					{pending ? 'Saving...' : 'Save club settings'}
				</Button>
			</CardContent>
		</Card>
	</div>
{/if}
