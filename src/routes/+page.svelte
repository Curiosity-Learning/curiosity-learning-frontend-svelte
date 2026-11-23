<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import { LoadingState } from '$lib/components/app';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { clubLessLandingPath } from '$lib/auth/no-club-allowlist';
	import {
		SIGNED_IN_VIA_LINK_PARAM,
		SIGNED_IN_VIA_LINK_VALUE,
		withSignedInViaLinkMarker
	} from '$lib/auth/magic-link';

	const auth = useAuth();
	let isAuthReady = $derived(!auth.isLoading && auth.isAuthenticated);
	const clubsResponse = useStableQuery(api.clubs.getMyClubs, () => (isAuthReady ? {} : 'skip'));
	const activeContextResponse = useStableQuery(api.clubs.getActiveClubContext, () =>
		isAuthReady ? {} : 'skip'
	);
	// Edge case 14: a club-less parent lands on Settings (the View as bar), not /new-club.
	const firstLinkedChildResponse = useStableQuery(api.parentAccounts.getMyFirstLinkedChildId, () =>
		isAuthReady && clubsResponse.data?.length === 0 ? {} : 'skip'
	);

	const pickClubId = () => {
		const clubs = clubsResponse.data ?? [];
		if (!clubs.length) return null;

		// Instant redirect if we have a remembered club.
		try {
			const remembered = localStorage.getItem('cl_last_club_id');
			if (remembered && clubs.some((c) => c.clubId === remembered)) return remembered;
		} catch {
			// ignore
		}

		const activeClubId = activeContextResponse.data?.activeClubId;
		if (activeClubId && clubs.some((c) => c.clubId === activeClubId)) return activeClubId;

		// clubs[0] is the first club for the current logged-in user (not global).
		return clubs[0].clubId;
	};

	let redirected = $state(false);
	$effect(() => {
		if (redirected) return;

		// Wait for auth state to settle before deciding where to go.
		if (auth.isLoading) return;

		// Not signed in: send to onboarding (fast, no server work).
		if (!auth.isAuthenticated) {
			redirected = true;
			void goto('/onboarding/get-started');
			return;
		}

		if (clubsResponse.isLoading || activeContextResponse.isLoading) return;

		if (clubsResponse.error || activeContextResponse.error) return;

		const clubId = pickClubId();
		// A sign-in link to `/` (the sign-in page's own links) arrives as `/?via=link`: pass the
		// marker on, so the app layout offers "Not your device?" wherever this lands (CL-807,
		// CL-801).
		const viaLink =
			page.url.searchParams.get(SIGNED_IN_VIA_LINK_PARAM) === SIGNED_IN_VIA_LINK_VALUE;
		const withMarker = (path: string) => (viaLink ? withSignedInViaLinkMarker(path) : path);

		if (!clubId) {
			const firstLinkedChildId = firstLinkedChildResponse.error
				? null
				: firstLinkedChildResponse.data;
			if (firstLinkedChildId === undefined) return;
			redirected = true;
			void goto(withMarker(clubLessLandingPath(firstLinkedChildId)));
			return;
		}

		redirected = true;
		const target = `/club/${clubId}`;
		if (page.url.pathname !== target) void goto(withMarker(target));
	});
</script>

<LoadingState variant="page" size="lg" label="Loading Curiosity Learning" />
