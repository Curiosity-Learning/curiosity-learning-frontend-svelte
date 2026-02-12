<script lang="ts">
	import { HeaderTabs, PageHeaderBanner } from '$lib/components/app';
	import { routes } from '$lib/routes';

	let { children } = $props();

	const tabs = [
		{
			label: 'My clubs',
			href: routes.feedMyClubs,
			aliases: [routes.feed]
		},
		{
			label: 'Global',
			href: routes.feedGlobal
		}
	];
</script>

<PageHeaderBanner>
	<HeaderTabs ariaLabel="Feed tabs" {tabs} />
</PageHeaderBanner>

{@render children()}
