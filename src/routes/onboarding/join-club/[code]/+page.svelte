<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import Clock3Icon from '@lucide/svelte/icons/clock-3';
	import { Button } from '$lib/components/ui/button';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import { authClient } from '$lib/auth-client';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { useConvexClient } from 'convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import type { PageProps } from './$types';
	import { api } from '$convex/_generated/api';
	import { formatWeeklyMeetingLabel } from '$lib/domain/date';

	let { data }: PageProps = $props();

	const auth = useAuth();
	const convexClient = useConvexClient();
	const preview = useStableQuery(api.clubs.getClubPreviewByCode, () => ({ code: data.code }));
	const FORCE_SIGNUP_GOOGLE_PENDING_KEY = 'cl_force_signup_google_pending_v1';

	let pending = $state(false);
	let errorMessage = $state('');
	let videoLoadFailed = $state(false);
	let forcedGoogleSignupRecoveryPending = $state(false);

	const isValidVideoUrl = (value: string | null | undefined) => {
		if (!value) return false;
		try {
			const parsed = new URL(value);
			return parsed.protocol === 'https:' || parsed.protocol === 'http:';
		} catch {
			return false;
		}
	};

	let club = $derived(preview.data);
	let meetingLabel = $derived(formatWeeklyMeetingLabel(club?.meetingDay ?? null, club?.meetingTime ?? null));
	let clubVideoUrl = $derived(isValidVideoUrl(club?.videoUrl ?? null) ? club?.videoUrl ?? null : null);

	$effect(() => {
		void clubVideoUrl;
		videoLoadFailed = false;
	});

	$effect(() => {
		if (!browser) return;
		const currentPath = `/onboarding/join-club/${data.code}`;
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
		params.set('next', `/onboarding/join-club/${data.code}`);
		params.set('forceSignup', '1');
		return `/auth/sign-up?${params.toString()}`;
	};

	const joinClub = async () => {
		pending = true;
		errorMessage = '';
		try {
			if (auth.isLoading) {
				errorMessage = 'Checking your session. Please try again.';
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
			const message = error instanceof Error ? error.message : 'Unable to continue right now.';
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

<FlowShell step={2} total={5} showSideIllustration={true}>
	{#snippet headerSupplement()}
		<div class="flex items-center justify-between gap-4">
			<a
				href="/onboarding/join-club"
				class="inline-flex w-fit items-center text-gray-500 transition-colors duration-200 hover:text-gray-700"
				aria-label="Go back"
			>
				<ChevronLeftIcon class="size-7" />
			</a>
		</div>
	{/snippet}
	<div class="mx-auto flex w-full max-w-[28.75rem] flex-1 flex-col gap-6">

		{#if preview.isLoading}
			<div class="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-5">
				<p class="text-base text-gray-600">Loading club details...</p>
			</div>
		{:else if !club}
			<div class="flex flex-col gap-4 rounded-lg border border-red-200 bg-red-50 p-5">
				<h1 class="text-2xl font-bold text-gray-900">Invalid club code</h1>
				<p class="text-base text-red-700">This invite code is invalid or has expired.</p>
				<Button href="/onboarding/join-club" variant="outline" size="xl" class="h-12 w-full">
					Enter another code
				</Button>
			</div>
		{:else if forcedGoogleSignupRecoveryPending}
			<div class="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-5">
				<h1 class="text-2xl font-bold text-gray-900">Checking your account…</h1>
				<p class="text-base text-gray-600">
					We&apos;re returning you to sign up so you can continue from the same step.
				</p>
			</div>
		{:else}
			<div class="flex flex-col gap-5">
				<div class="flex flex-col gap-2">
					<h1 class="type-step-title text-gray-900">{club.name}</h1>
					<p class="text-[1.125rem] leading-8 text-gray-600">
						{club.description ??
							'Join this Curiosity Club to learn, collaborate, and build projects with a local learning community.'}
					</p>
				</div>

				<div class="flex flex-wrap gap-2">
					{#if club.location}
						<div
							class="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-500"
						>
							<MapPinIcon class="size-4" />
							<span>{club.location}</span>
						</div>
					{/if}

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
				<p class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p>
			{/if}

			<div class="mt-auto flex flex-col gap-3 pb-2 sm:pb-6">
				<Button
					variant="default"
					size="xl"
					class="h-12 w-full"
					disabled={pending || auth.isLoading}
					onclick={() => void joinClub()}
				>
					{pending ? 'Continuing...' : 'Join as a learner'}
				</Button>
			</div>
		{/if}
	</div>
</FlowShell>
