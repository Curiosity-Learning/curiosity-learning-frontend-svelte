<script lang="ts">
	import { _ } from '$lib/i18n';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

	// Public pages reached from links in emails (CL-770: unsubscribe). No account needed.
	let { children } = $props();
</script>

<div
	class="app-texture-background relative flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-8"
>
	<div class="flex w-full max-w-md flex-col gap-4">
		<Card>
			<CardHeader>
				<CardTitle class="text-2xl">{$_('common.appName')}</CardTitle>
			</CardHeader>
			<CardContent class="flex flex-col gap-4">
				{@render children()}
			</CardContent>
		</Card>
	</div>
</div>
