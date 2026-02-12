<script lang="ts">
	import AvatarStack from '$lib/components/app/home/avatar-stack.svelte';

	type Person = {
		name: string;
		imageUrl?: string | null;
	};

	type Props = {
		people: Person[];
		max?: number;
		sizeClass?: string;
		emptyLabel?: string;
	};

	let { people, max = 6, sizeClass = 'size-11', emptyLabel = 'No attendees yet.' }: Props = $props();
</script>

{#if people.length === 0}
	<p class="type-lead text-slate-500">{emptyLabel}</p>
{:else}
	<AvatarStack {people} {max} {sizeClass} />
{/if}
