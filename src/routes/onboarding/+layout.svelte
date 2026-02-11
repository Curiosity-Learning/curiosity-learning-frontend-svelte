<script lang="ts">
	let { children } = $props();
</script>

<div
	class="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top,_var(--color-primary)/10,_transparent_40%),linear-gradient(to_bottom,_var(--color-background),var(--color-secondary)/30)]"
>
	<div class="flex w-full max-w-5xl flex-1 flex-col gap-6 self-center px-4 py-8 sm:px-6 lg:px-8">
		{@render children()}
	</div>
</div>
