<script lang="ts">
	import { page } from '$app/state';
	import { HeaderTabs, PageHeaderBanner } from '$lib/components/app';
	import { t } from '$lib/i18n';

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
					},
					{
						label: t('sessionPhotos.title'),
						href: `/session/${sessionId}/photos`
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
