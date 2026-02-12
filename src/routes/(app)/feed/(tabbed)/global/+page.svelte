<script lang="ts">
	import { authClient } from '$lib/auth-client';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';

	const session = authClient.useSession();
</script>

{#if !$session.data}
	<Alert>
		<AlertTitle>Sign in required</AlertTitle>
		<AlertDescription>Sign in to view the global feed.</AlertDescription>
	</Alert>
{:else}
	<Card>
		<CardHeader>
			<CardTitle>Global</CardTitle>
			<CardDescription>Updates across the wider network will appear here.</CardDescription>
		</CardHeader>
		<CardContent>
			<p>Global feed is not wired yet.</p>
		</CardContent>
	</Card>
{/if}
