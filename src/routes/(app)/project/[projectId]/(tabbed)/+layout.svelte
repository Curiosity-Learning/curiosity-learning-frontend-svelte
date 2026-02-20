<script lang="ts">
	import { page } from '$app/state';
	import { HeaderTabs, PageHeaderBanner } from '$lib/components/app';

	let { children } = $props();

	let projectId = $derived((page.params as Record<string, string | undefined>).projectId ?? '');
	let tabs = $derived(
		projectId
			? [
					{
						label: 'Overview',
						href: `/project/${projectId}/overview`,
						aliases: [`/project/${projectId}`]
					},
					{
						label: 'Members',
						href: `/project/${projectId}/members`
					}
				]
			: []
	);
</script>

{#if tabs.length}
	<PageHeaderBanner>
		<HeaderTabs ariaLabel="Project tabs" {tabs} />
	</PageHeaderBanner>
{/if}

{@render children()}
