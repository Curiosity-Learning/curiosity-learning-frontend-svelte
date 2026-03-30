<script lang="ts">
	import LanguageSwitcher from '$lib/components/app/language-switcher.svelte';

	let { children } = $props();
</script>

<div class="relative flex min-h-screen flex-col bg-white">
	<LanguageSwitcher class="absolute top-3 right-5 z-10 sm:top-4 sm:right-8 lg:top-6 lg:right-12" />
	{@render children()}
</div>
