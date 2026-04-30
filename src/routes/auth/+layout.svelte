<script lang="ts">
	import { page } from '$app/state';
	import { _ } from '$lib/i18n';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';

	let { children } = $props();
	let isOnboardingStyleRoute = $derived(
		page.url.pathname === '/auth/sign-up' ||
			page.url.pathname === '/auth/post-signup' ||
			page.url.pathname === '/auth/sign-in' ||
			page.url.pathname === '/auth/reset-password'
	);
</script>

{#if isOnboardingStyleRoute}
	<div class="app-texture-background relative flex min-h-screen flex-col">
		{@render children()}
	</div>
{:else}
	<div
		class="app-texture-background relative flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-8"
	>
		<div class="flex w-full max-w-md flex-col gap-4">
			<Card>
				<CardHeader class="flex flex-col gap-2">
					<CardTitle class="text-2xl">{$_('common.appName')}</CardTitle>
					<CardDescription>{$_('authLayout.description')}</CardDescription>
				</CardHeader>
				<CardContent class="flex flex-col gap-4">
					{@render children()}
				</CardContent>
			</Card>
		</div>
	</div>
{/if}
