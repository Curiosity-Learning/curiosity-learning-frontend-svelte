<script lang="ts">
	import { page } from '$app/state';
	import { HeaderTabs, PageHeaderBanner } from '$lib/components/app';

	let { children } = $props();

	let sessionId = $derived((page.params as Record<string, string | undefined>).sessionId ?? '');
	let tabs = $derived(
		sessionId
			? [
					{
						label: 'Activities',
						href: `/session/${sessionId}/activities`,
						aliases: [`/session/${sessionId}`]
					},
					{
						label: 'Attendees',
						href: `/session/${sessionId}/attendees`
					}
				]
			: []
	);
</script>

{#if tabs.length}
	<PageHeaderBanner>
		<HeaderTabs ariaLabel="Session tabs" {tabs} />
	</PageHeaderBanner>
{/if}

{@render children()}
