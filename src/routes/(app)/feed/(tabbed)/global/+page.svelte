<script lang="ts">
	import { authClient } from '$lib/auth-client';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { t } from '$lib/i18n';

	const session = authClient.useSession();
</script>

{#if !$session.data}
	<Alert>
		<AlertTitle>Sign in required</AlertTitle>
		<AlertDescription>Sign in to view the global feed.</AlertDescription>
	</Alert>
{:else}
	<div class="flex flex-col gap-4">
		<div class="rounded-2xl border border-dashed border-border/80 bg-card px-4 py-8 text-center">
			<p class="type-body-bold text-foreground">{t('feed.globalEmptyTitle')}</p>
			<p class="type-sm mt-1 text-muted-foreground">{t('feed.globalEmptyDescription')}</p>
		</div>
	</div>
{/if}
