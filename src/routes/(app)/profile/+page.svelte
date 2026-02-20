<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import { routes } from '$lib/routes';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Separator } from '$lib/components/ui/separator';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { api } from '$convex/_generated/api';
	import { useQuery } from 'convex-svelte';

	const profileResponse = useQuery(api.profiles.getMe, {});
	const clubsResponse = useQuery(api.clubs.getMyClubs, {});
	const activeContext = useQuery(api.clubs.getActiveClubContext, {});

	let activeClubItem = $derived(
		(clubsResponse.data ?? []).find((club) => club.clubId === activeContext.data?.activeClubId) ??
			null
	);

	const fullName = $derived(
		[profileResponse.data?.firstName, profileResponse.data?.lastName].filter(Boolean).join(' ').trim()
	);
	const handle = $derived(profileResponse.data?.username ? `@${profileResponse.data.username}` : '');
	const fallback = $derived(
		(profileResponse.data?.username ?? profileResponse.data?.firstName ?? 'Me').slice(0, 2)
	);
	const clubHomeHref = $derived(
		activeContext.data?.activeClubId
			? routes.clubHome(activeContext.data.activeClubId)
			: routes.onboardingGetStarted
	);

	const signOut = async () => {
		await authClient.signOut();
		await goto(resolve('/auth/sign-in'));
	};
</script>

<div class="grid grid-cols-1 gap-4">
	<Card>
		<CardHeader class="flex flex-col gap-2">
			<CardTitle>Profile</CardTitle>
			<CardDescription>Manage your account and club context.</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
				<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div class="flex items-center gap-4">
						<Avatar class="size-14">
							<AvatarImage src={profileResponse.data?.coverPhotoUrl ?? undefined} alt="Profile" />
							<AvatarFallback>{fallback.toUpperCase()}</AvatarFallback>
						</Avatar>
						<div class="flex flex-col gap-1">
							<p class="text-lg font-semibold">{fullName || 'Your account'}</p>
							<div class="flex flex-wrap items-center gap-2">
								{#if handle}
									<Badge variant="outline">{handle}</Badge>
								{/if}
								{#if profileResponse.data?.email}
									<Badge variant="secondary">{profileResponse.data.email}</Badge>
								{/if}
								{#if profileResponse.data?.isVerified}
									<Badge>Verified</Badge>
								{:else}
									<Badge variant="destructive">Not verified</Badge>
								{/if}
							</div>
						</div>
					</div>

				<div class="flex flex-wrap gap-2">
					<Button href="/settings" variant="outline">Settings</Button>
					<Button href="/notifications" variant="outline">Notifications</Button>
					<Button variant="destructive" onclick={() => void signOut()}>Sign out</Button>
				</div>
			</div>

			<Separator />

			<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
				<div class="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-4">
					<p class="text-xs tracking-wide text-muted-foreground uppercase">Active club</p>
					{#if activeClubItem}
						<p class="text-lg font-semibold">{activeClubItem.clubName}</p>
					{:else}
						<p class="text-sm text-muted-foreground">
							No active club selected. Start or join a club to unlock club features.
						</p>
						<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
							<Button href="/onboarding/start-club">Start a club</Button>
							<Button href="/onboarding/join-club" variant="outline">Join a club</Button>
						</div>
					{/if}
				</div>

				<div class="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-4">
					<p class="text-xs tracking-wide text-muted-foreground uppercase">Shortcuts</p>
					<div class="flex flex-col gap-2">
						<Button href={clubHomeHref} variant="outline">Club home</Button>
						<Button href="/feed" variant="outline">Feed</Button>
						<Button href="/chat" variant="outline">Chat</Button>
					</div>
				</div>
			</div>
		</CardContent>
	</Card>
</div>
