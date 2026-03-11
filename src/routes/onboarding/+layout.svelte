<script lang="ts">
	let { children } = $props();
</script>

<div
	class="flex min-h-screen flex-col bg-white"
>
	<div class="flex w-full max-w-5xl flex-1 flex-col gap-6 self-center px-4 py-8 sm:px-6 lg:px-8">
		{@render children()}
	</div>
</div>
