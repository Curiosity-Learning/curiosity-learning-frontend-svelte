<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import Clock3Icon from '@lucide/svelte/icons/clock-3';
	import { Button } from '$lib/components/ui/button';
	import { PageHeaderBackButton, PageHeaderTitle } from '$lib/components/app';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import { authClient } from '$lib/auth-client';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { useConvexClient } from 'convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { _, t } from '$lib/i18n';
	import type { PageProps } from './$types';
	import { api } from '$convex/_generated/api';
	import { routes } from '$lib/routes';
	import { formatWeeklyMeetingLabel } from '$lib/domain/date';
	import type { SignedDeliveryAsset } from '$lib/server/signed-media';

	let { data }: { data: PageProps['data'] & { initialClubVideo: SignedDeliveryAsset | null } } =
		$props();

	const auth = useAuth();
	const convexClient = useConvexClient();
	const preview = useStableQuery(api.clubs.getClubPreviewByCode, () => ({ code: data.code }));
	const FORCE_SIGNUP_GOOGLE_PENDING_KEY = 'cl_force_signup_google_pending_v1';

	let pending = $state(false);
	let errorMessage = $state('');
	let videoLoadFailed = $state(false);
	let forcedGoogleSignupRecoveryPending = $state(false);

	let club = $derived(preview.data);
	let isAppNewClubFlow = $derived(page.url.pathname.startsWith(routes.newClubJoin));
	let joinClubPath = $derived(isAppNewClubFlow ? routes.newClubJoin : routes.onboardingJoinClub);
	let currentJoinPath = $derived(`${joinClubPath}/${data.code}`);
	let headerTitle = $derived(club?.name ?? $_('onboarding.joinClub.title'));
	let contentClass = $derived(
		isAppNewClubFlow
			? 'flex w-full max-w-3xl flex-col gap-6'
			: 'mx-auto flex w-full max-w-[28.75rem] flex-1 flex-col gap-6'
	);
	let meetingLabel = $derived(
		formatWeeklyMeetingLabel(club?.meetingDay ?? null, club?.meetingTime ?? null)
	);
	let clubVideoUrl = $derived.by(() => {
		const clubVideoAssetId = club?.videoMediaAssetId ?? null;
		if (clubVideoAssetId && data.initialClubVideo?.assetId === clubVideoAssetId) {
			return data.initialClubVideo.signedUrl;
		}

		if (clubVideoAssetId) {
			return null;
		}

		return null;
	});

	$effect(() => {
		void clubVideoUrl;
		videoLoadFailed = false;
	});

	$effect(() => {
		if (!browser) return;
		const currentPath = currentJoinPath;
		const pendingPath = sessionStorage.getItem(FORCE_SIGNUP_GOOGLE_PENDING_KEY);
		if (pendingPath !== currentPath) {
			forcedGoogleSignupRecoveryPending = false;
			return;
		}
		forcedGoogleSignupRecoveryPending = auth.isLoading || auth.isAuthenticated;
		if (auth.isLoading) return;
		if (!auth.isAuthenticated) {
			sessionStorage.removeItem(FORCE_SIGNUP_GOOGLE_PENDING_KEY);
			forcedGoogleSignupRecoveryPending = false;
			return;
		}
		sessionStorage.removeItem(FORCE_SIGNUP_GOOGLE_PENDING_KEY);
		void (async () => {
			await authClient.signOut();
			const params = new SvelteURLSearchParams();
			params.set('next', currentPath);
			params.set('forceSignup', '1');
			params.set('step', '4');
			params.set('signupBlocked', 'existing-google');
			await goto(`/auth/sign-up?${params.toString()}`, { replaceState: true });
		})();
	});

	const getSignUpPath = () => {
		const params = new SvelteURLSearchParams();
		params.set('next', currentJoinPath);
		params.set('forceSignup', '1');
		return `/auth/sign-up?${params.toString()}`;
	};

	const joinClub = async () => {
		pending = true;
		errorMessage = '';
		try {
			if (auth.isLoading) {
				errorMessage = t('onboarding.joinClubDetails.checkingSession');
				return;
			}
			if (auth.isAuthenticated) {
				const result = await convexClient.mutation(api.clubs.joinClubWithCode, {
					code: data.code
				});
				if (browser) {
					try {
						localStorage.setItem('cl_last_club_id', result.clubId);
					} catch {
						// Ignore storage errors.
					}
				}
				await goto(`/club/${result.clubId}`);
				return;
			}
			await goto(getSignUpPath());
		} catch (error) {
			const message =
				error instanceof Error ? error.message : t('onboarding.joinClubDetails.continueFailure');
			if (message.toLowerCase().includes('already a member')) {
				if (club?.id) {
					await goto(`/club/${club.id}`);
					return;
				}
			}
			errorMessage = message;
		} finally {
			pending = false;
		}
	};
</script>

{#if isAppNewClubFlow}
	<PageHeaderBackButton fallbackHref={joinClubPath} />
	<PageHeaderTitle title={headerTitle} />
{/if}

<FlowShell step={2} total={5} showSideIllustration={true} appFrame={isAppNewClubFlow}>
	{#snippet headerSupplement()}
		<div class="flex items-center justify-between gap-4">
			<a
				href={joinClubPath}
				class="inline-flex w-fit items-center text-gray-500 transition-colors duration-200 hover:text-gray-700"
				aria-label={$_('common.goBack')}
			>
				<ChevronLeftIcon class="size-7" />
			</a>
		</div>
	{/snippet}
	<div class={contentClass}>
		{#if preview.isLoading}
			<div class="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-5">
				<p class="text-base text-gray-600">{$_('onboarding.joinClubDetails.loading')}</p>
			</div>
		{:else if !club}
			<div class="flex flex-col gap-4 rounded-lg border border-red-200 bg-red-50 p-5">
				<h1 class="text-2xl font-bold text-gray-900">
					{$_('onboarding.joinClubDetails.invalidTitle')}
				</h1>
				<p class="text-base text-red-700">{$_('onboarding.joinClubDetails.invalidDescription')}</p>
				<Button href={joinClubPath} variant="outline" size="xl" class="h-12 w-full">
					{$_('onboarding.joinClubDetails.enterAnother')}
				</Button>
			</div>
		{:else if forcedGoogleSignupRecoveryPending}
			<div class="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-5">
				<h1 class="text-2xl font-bold text-gray-900">
					{$_('onboarding.joinClubDetails.checkingAccountTitle')}
				</h1>
				<p class="text-base text-gray-600">
					{$_('onboarding.joinClubDetails.checkingAccountDescription')}
				</p>
			</div>
		{:else}
			<div class="flex flex-col gap-5">
				<div class="flex flex-col gap-2">
					{#if !isAppNewClubFlow}
						<h1 class="type-step-title text-gray-900">{club.name}</h1>
					{/if}
					<p class="text-[1.125rem] leading-8 text-gray-600">
						{club.description ?? $_('onboarding.joinClubDetails.defaultDescription')}
					</p>
				</div>

				<div class="flex flex-wrap gap-2">
					{#if meetingLabel}
						<div
							class="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-500"
						>
							<Clock3Icon class="size-4" />
							<span>{meetingLabel}</span>
						</div>
					{/if}
				</div>

				{#if clubVideoUrl && !videoLoadFailed}
					<div class="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-900">
						<!-- svelte-ignore a11y_media_has_caption -->
						<video
							src={clubVideoUrl}
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

			<div
				class={isAppNewClubFlow
					? 'flex max-w-[28.75rem] flex-col gap-3'
					: 'mt-auto flex flex-col gap-3 pb-2 sm:pb-6'}
			>
				<Button
					variant="default"
					size="xl"
					class="h-12 w-full"
					disabled={pending || auth.isLoading}
					onclick={() => void joinClub()}
				>
					{pending
						? $_('onboarding.joinClubDetails.continuing')
						: $_('onboarding.joinClubDetails.joinAsLearner')}
				</Button>
			</div>
		{/if}
	</div>
</FlowShell>
