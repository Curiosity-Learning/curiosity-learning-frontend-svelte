<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { routes } from '$lib/routes';
	import { api } from '$convex/_generated/api';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';

	const auth = useAuth();
	let isAuthReady = $derived(!auth.isLoading && auth.isAuthenticated);
	const clubsResponse = useStableQuery(api.clubs.getMyClubs, () => (isAuthReady ? {} : 'skip'));
	const activeContextResponse = useStableQuery(api.clubs.getActiveClubContext, () =>
		isAuthReady ? {} : 'skip'
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
		if (!clubId) {
			redirected = true;
			void goto(routes.noClub);
			return;
		}

		redirected = true;
		const target = `/club/${clubId}`;
		if (page.url.pathname !== target) void goto(target);
	});
</script>

<p class="p-4 text-sm text-muted-foreground">Loading...</p>
