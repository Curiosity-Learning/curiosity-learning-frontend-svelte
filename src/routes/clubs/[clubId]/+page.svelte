<script lang="ts">
	import { goto } from '$app/navigation';
	import Clock3Icon from '@lucide/svelte/icons/clock-3';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import { Button } from '$lib/components/ui/button';
	import { PageHeaderBackButton, PageHeaderTitle, ScreenBackButton } from '$lib/components/app';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { useConvexClient } from 'convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { _, t } from '$lib/i18n';
	import type { PageProps } from './$types';
	import { api } from '$convex/_generated/api';
	import { navigateBack } from '$lib/navigation/back';
	import { formatScheduleSlot } from '$lib/domain/schedule';

	let { data }: PageProps = $props();

	const auth = useAuth();
	const convexClient = useConvexClient();
	const preview = useStableQuery(api.clubs.getClubPreviewById, () => ({ clubId: data.clubId }));

	let pending = $state(false);
	let errorMessage = $state('');
	let requestSent = $state(false);
	let videoLoadFailed = $state(false);

	let club = $derived(preview.data);
	let scheduleLabels = $derived((club?.scheduleSlots ?? []).map(formatScheduleSlot));
	let hasPendingRequest = $derived(Boolean(club?.viewerPendingJoinRequestId) || requestSent);

	$effect(() => {
		void club?.videoUrl;
		videoLoadFailed = false;
	});

	const getSignUpPath = () => {
		const next = `/clubs/${data.clubId}`;
		return `/auth/sign-up?next=${encodeURIComponent(next)}&forceSignup=1`;
	};

	const goBack = async () => {
		await navigateBack({ fallbackHref: '/onboarding/join-club/public-clubs' });
	};

	const requestToJoin = async () => {
		errorMessage = '';
		if (auth.isLoading) return;
		if (!auth.isAuthenticated) {
			await goto(getSignUpPath());
			return;
		}

		pending = true;
		try {
			await convexClient.mutation(api.joinRequests.requestToJoin, { clubId: data.clubId });
			requestSent = true;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : t('requestToJoin.requestFailure');
		} finally {
			pending = false;
		}
	};
</script>

<PageHeaderBackButton fallbackHref="/onboarding/join-club/public-clubs" />
<PageHeaderTitle title={club?.name ?? t('publicClubPreview.notFoundTitle')} />

<FlowShell step={1} total={1} showSideIllustration={true}>
	{#snippet headerSupplement()}
		<div class="flex items-center justify-between gap-4">
			<ScreenBackButton onclick={() => void goBack()} />
		</div>
	{/snippet}
	<div class="mx-auto flex w-full max-w-[28.75rem] flex-1 flex-col gap-6">
		{#if preview.isLoading}
			<div class="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-5">
				<p class="text-base text-gray-600">{$_('common.loading')}</p>
			</div>
		{:else if !club}
			<div class="flex flex-col gap-4 rounded-lg border border-red-200 bg-red-50 p-5">
				<h1 class="text-2xl font-bold text-gray-900">{$_('publicClubPreview.notFoundTitle')}</h1>
				<p class="text-base text-red-700">{$_('publicClubPreview.notFoundDescription')}</p>
				<Button href="/onboarding/join-club/public-clubs" variant="outline" size="xl" class="h-12 w-full">
					{$_('publicClubPreview.backToPublicClubs')}
				</Button>
			</div>
		{:else}
			<div class="flex flex-col gap-5">
				<div class="flex flex-col gap-2">
					<h1 class="type-step-title text-gray-900">{club.name}</h1>
					{#if club.city}
						<div class="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-gray-500">
							<MapPinIcon class="size-4 shrink-0" />
							<span>{club.city}</span>
						</div>
					{/if}
					<p class="text-[1.125rem] leading-8 text-gray-600">
						{club.description ?? ''}
					</p>
				</div>

				<div class="flex flex-wrap gap-2">
					{#each scheduleLabels as scheduleLabel (scheduleLabel)}
						<div
							class="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-500"
						>
							<Clock3Icon class="size-4" />
							<span>{scheduleLabel}</span>
						</div>
					{/each}
				</div>

				{#if club.videoUrl && !videoLoadFailed}
					<div class="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-900">
						<!-- svelte-ignore a11y_media_has_caption -->
						<video
							src={club.videoUrl}
							controls
							preload="metadata"
							class="h-44 w-full object-cover sm:h-52"
							onerror={() => {
								videoLoadFailed = true;
							}}
						></video>
					</div>
				{/if}
			</div>

			{#if errorMessage}
				<p class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
					{errorMessage}
				</p>
			{/if}

			{#if requestSent}
				<p class="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
					{$_('requestToJoin.requestSent')}
				</p>
			{/if}

			<div class="mt-auto flex flex-col gap-3 pb-2 sm:pb-6">
				{#if club.viewerIsMember}
					<Button variant="outline" size="xl" class="h-12 w-full" disabled>
						{$_('requestToJoin.alreadyMemberButton')}
					</Button>
				{:else if hasPendingRequest}
					<Button href="/chat" size="xl" class="h-12 w-full">
						{$_('requestToJoin.viewChat')}
					</Button>
				{:else}
					<Button
						variant="default"
						size="xl"
						class="h-12 w-full"
						disabled={pending || auth.isLoading}
						onclick={() => void requestToJoin()}
					>
						{pending ? $_('common.saving') : $_('requestToJoin.button')}
					</Button>
				{/if}
			</div>
		{/if}
	</div>
</FlowShell>
