<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { LoadingState } from '$lib/components/app';
	import { useConvexClient } from 'convex-svelte';
	import { routes } from '$lib/routes';
	import { t } from '$lib/i18n';

	// CL-734: entry point into "View as Child". Parent-facing emails (chat notifications, critical
	// notices, the consent sign-in link) still point here, so this page switches the parent's
	// session into viewing as the child and forwards them into the child's own interface:
	// `?room=` (a chat email) opens that chat, anything else opens the child's home. The one
	// exception is `?settings=emails` (the chat email's "add an email address" note): that setting
	// is the parent's own, so it switches back to the parent and opens it in Settings.

	let childProfileId = $derived(
		(page.params as Record<string, string | undefined>).childProfileId as Id<'profiles'>
	);

	const convexClient = useConvexClient();
	let failed = $state(false);

	onMount(async () => {
		try {
			// A parent whose consent predates link-at-approval may land here before the link is
			// claimed; claim first so starting the view can find it.
			await convexClient.mutation(api.parentAccounts.syncParentLinks, {}).catch(() => undefined);
			if (page.url.searchParams.get('settings') === 'emails') {
				await convexClient.mutation(api.viewAs.stopViewing, {});
				await goto(`${routes.settings}#child-notifications`, {
					replaceState: true,
					invalidateAll: true
				});
				return;
			}
			await convexClient.mutation(api.viewAs.startViewing, { childProfileId });
			const roomId = page.url.searchParams.get('room');
			await goto(roomId ? `${routes.chat}?room=${encodeURIComponent(roomId)}` : '/', {
				replaceState: true,
				invalidateAll: true
			});
		} catch {
			failed = true;
		}
	});
</script>

<div class="flex w-full flex-col gap-4 py-4">
	{#if failed}
		<Alert variant="destructive">
			<AlertTitle>{t('parentAccounts.notFoundTitle')}</AlertTitle>
			<AlertDescription>{t('parentAccounts.notFoundDescription')}</AlertDescription>
		</Alert>
		<Button href="/" variant="outline" class="w-fit">{t('viewAs.exitAction')}</Button>
	{:else}
		<LoadingState class="min-h-48" label="Opening your child's account" />
	{/if}
</div>
