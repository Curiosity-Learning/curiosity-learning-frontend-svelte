<script lang="ts">
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { cn } from '$lib/utils.js';

	type Person = {
		name: string;
		imageUrl?: string | null;
	};

	type Props = {
		people: Person[];
		max?: number;
		sizeClass?: string;
	};

	let { people, max = 4, sizeClass = 'size-9' }: Props = $props();

	const initialsFor = (name: string) => {
		const cleaned = name.trim();
		if (!cleaned) return '?';
		const parts = cleaned.split(/\s+/g).filter(Boolean);
		const letters = [parts[0]?.[0] ?? '', parts.at(-1)?.[0] ?? '']
			.join('')
			.toUpperCase();
		return letters || cleaned.slice(0, 2).toUpperCase();
	};

	let visiblePeople = $derived(people.slice(0, Math.max(0, max)));
	let remaining = $derived(Math.max(0, people.length - visiblePeople.length));

	const widthClassFor = (count: number) => {
		if (count <= 1) return 'w-10';
		if (count === 2) return 'w-16';
		if (count === 3) return 'w-20';
		if (count === 4) return 'w-24';
		return 'w-28';
	};

	const translateClassFor = (index: number) => {
		if (index === 0) return 'translate-x-0';
		if (index === 1) return 'translate-x-4';
		if (index === 2) return 'translate-x-8';
		if (index === 3) return 'translate-x-12';
		return 'translate-x-16';
	};
</script>

<div class={cn('relative h-9', widthClassFor(Math.min(max, people.length) + (remaining ? 1 : 0)))}>
	{#each visiblePeople as person, index (person.name + index)}
		<div class={cn('absolute left-0 top-0', translateClassFor(index))} style:z-index={50 - index}>
			<Avatar class={cn(sizeClass, 'ring-2 ring-background')}>
				{#if person.imageUrl}
					<AvatarImage src={person.imageUrl} alt={person.name} />
				{/if}
				<AvatarFallback class="text-xs font-semibold">{initialsFor(person.name)}</AvatarFallback>
			</Avatar>
		</div>
	{/each}

	{#if remaining}
		<div
			class={cn('absolute left-0 top-0', translateClassFor(visiblePeople.length))}
			style:z-index={0}
		>
			<div
				class={cn(
					sizeClass,
					'flex items-center justify-center rounded-full bg-accent text-sm font-semibold text-primary ring-2 ring-background'
				)}
			>
				+{remaining}
			</div>
		</div>
	{/if}
</div>
