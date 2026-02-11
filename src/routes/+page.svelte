<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import { authClient } from '$lib/auth-client';
	import { ensureProfileOnce, profileReady, setProfileInitUser } from '$lib/app/client-init';
	import { useConvexClient, useQuery } from 'convex-svelte';

	const session = authClient.useSession();
	const convexClient = useConvexClient();

	const viewerIdentity = useQuery(api.auth.getViewerIdentity, () => ($session.data ? {} : 'skip'));

	// Kick off profile init as soon as Convex auth is confirmed; do not block UI.
	$effect(() => {
		if (!$session.data) {
			setProfileInitUser(null);
			return;
		}

		const userId = viewerIdentity.data?.userId ?? null;
		if (!userId) return;

		setProfileInitUser(userId);
		void ensureProfileOnce(convexClient, api).catch(() => {});
	});

	const clubsResponse = useQuery(api.clubs.getMyClubs, () => ($profileReady ? {} : 'skip'));
	const profileResponse = useQuery(api.profiles.getMe, () => ($profileReady ? {} : 'skip'));

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

		const activeClubId = profileResponse.data?.activeClubId;
		if (activeClubId && clubs.some((c) => c.clubId === activeClubId)) return activeClubId;

		// clubs[0] is the first club for the current logged-in user (not global).
		return clubs[0].clubId;
	};

	let redirected = $state(false);
	$effect(() => {
		if (redirected) return;

		// Wait for Better Auth to settle before deciding where to go.
		if ($session.isPending) return;

		// Not signed in: send to onboarding (fast, no server work).
		if (!$session.data) {
			redirected = true;
			void goto('/onboarding/get-started');
			return;
		}

		// Signed in but profile init isn't ready yet.
		if (!$profileReady) return;

		const clubId = pickClubId();
		if (!clubId) return; // still loading clubs

		redirected = true;
		const target = `/${clubId}/sessions`;
		if (page.url.pathname !== target) void goto(target);
	});
</script>

<p class="p-4 text-sm text-muted-foreground">Loading...</p>
