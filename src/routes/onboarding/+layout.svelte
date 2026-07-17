<script lang="ts">
	let { children } = $props();
</script>

<div class="app-texture-background relative flex min-h-dvh flex-col">
	{@render children()}
</div>
