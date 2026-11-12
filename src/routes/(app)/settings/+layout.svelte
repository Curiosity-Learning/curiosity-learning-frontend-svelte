<script lang="ts">
	import { useConvexClient } from 'convex-svelte';
	import { page } from '$app/state';
	import { getViewAsContext, stopViewingAsChild } from '$lib/app/view-as';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { PageHeaderTitle } from '$lib/components/app';
	import { showGlobalSnackbar } from '$lib/components/app/snackbar';
	import { formatT, t } from '$lib/i18n';

	let { children } = $props();

	// Parent "View as Child" (CL-801): Settings belong to the signed-in account, so while a parent
	// is viewing as their child they would mix the child's profile with the parent's sign-in and
	// devices, and every save is refused anyway. Show a way back instead; it stays on this page.
	const viewAs = getViewAsContext();
	const convexClient = useConvexClient();
	let pending = $state(false);
	const switchBack = async () => {
		if (pending) return;
		pending = true;
		try {
			await stopViewingAsChild(convexClient, {
				to: `${page.url.pathname}${page.url.search}${page.url.hash}`,
				replaceState: true
			});
		} catch {
			showGlobalSnackbar({ title: t('viewAs.exitFailure') });
		} finally {
			pending = false;
		}
	};
</script>

{#if viewAs.isViewingAsChild}
	<PageHeaderTitle title="Settings" />
	<Alert class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex flex-col gap-1">
			<AlertTitle>{t('viewAs.settingsTitle')}</AlertTitle>
			<AlertDescription>
				{formatT('viewAs.settingsDescription', { name: viewAs.viewingChildName ?? '' })}
			</AlertDescription>
		</div>
		<Button variant="outline" disabled={pending} onclick={() => void switchBack()}>
			{t('viewAs.exitAction')}
		</Button>
	</Alert>
{:else}
	{@render children()}
{/if}
