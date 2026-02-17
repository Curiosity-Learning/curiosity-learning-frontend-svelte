<script lang="ts">
	import { page } from '$app/state';
	import { HeaderTabs, PageHeaderBanner } from '$lib/components/app';

	let { children } = $props();

	let clubId = $derived((page.params as Record<string, string | undefined>).clubId ?? '');
	let tabs = $derived(
		clubId
			? [
					{
						label: 'Current',
						href: `/club/${clubId}/projects/current`,
						aliases: [`/club/${clubId}/projects`]
					},
					{
						label: 'Completed',
						href: `/club/${clubId}/projects/completed`
					}
				]
			: []
	);
</script>

{#if tabs.length}
	<PageHeaderBanner>
		<HeaderTabs ariaLabel="Projects tabs" {tabs} />
	</PageHeaderBanner>
{/if}

{@render children()}
