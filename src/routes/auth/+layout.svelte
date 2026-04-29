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
	<div class="relative flex min-h-screen flex-col bg-white">
		{@render children()}
	</div>
{:else}
	<div
		class="relative flex min-h-screen flex-col items-center justify-center gap-6 bg-[radial-gradient(circle_at_top,_var(--color-primary)/12,_transparent_45%),linear-gradient(to_bottom,_var(--color-secondary)/35,_var(--color-background))] px-4 py-8"
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
