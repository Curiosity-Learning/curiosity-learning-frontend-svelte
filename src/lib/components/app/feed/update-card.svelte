<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { ClassValue } from 'svelte/elements';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { TagChip } from '$lib/components/ui/badge';
	import { cn } from '$lib/utils';

	type RelatedEntity = {
		label: string;
		href?: string;
		navigationState?: App.PageState;
	};

	type Props = {
		class?: ClassValue;
		authorName?: string | null;
		authorImageUrl?: string | null;
		createdAt: number;
		content: string;
		relatedQuestion?: RelatedEntity | null;
		relatedProject?: RelatedEntity | null;
	};

	let {
		class: className,
		authorName = null,
		authorImageUrl = null,
		createdAt,
		content,
		relatedQuestion = null,
		relatedProject = null
	}: Props = $props();

	let displayAuthorName = $derived(authorName?.trim() || 'Unknown');

	const initialsFor = (name: string) =>
		name
			.split(' ')
			.map((part) => part.trim())
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('');

	const formatRelativeTime = (timestamp: number) => {
		const diff = Date.now() - timestamp;
		if (diff <= 0) return 'now';

		const minutes = Math.floor(diff / 60_000);
		if (minutes < 1) return 'now';
		if (minutes < 60) return `${minutes}m`;

		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h`;

		const days = Math.floor(hours / 24);
		if (days < 7) return `${days}d`;

		return new Date(timestamp).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric'
		});
	};

	let cardClass = $derived(cn('gap-0 rounded-3xl border border-border/90 bg-card py-0', className));
	let timestampLabel = $derived(formatRelativeTime(createdAt));

	const handleLinkClick = (event: MouseEvent, href?: string, navigationState?: App.PageState) => {
		if (!href || !navigationState || event.defaultPrevented) return;
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		void goto(resolve(href as any), { state: navigationState });
	};
</script>

<Card class={cardClass}>
	<CardContent class="flex flex-col gap-4 p-6">
		<div class="flex min-w-0 items-center gap-3">
			<Avatar class="size-10">
				{#if authorImageUrl}
					<AvatarImage src={authorImageUrl} alt={displayAuthorName} />
				{/if}
				<AvatarFallback class="type-body-bold">{initialsFor(displayAuthorName)}</AvatarFallback>
			</Avatar>

			<div class="flex min-w-0 items-center gap-3">
				<p class="truncate type-h6-bold text-foreground">{displayAuthorName}</p>
				<p class="shrink-0 type-lead text-muted-foreground">{timestampLabel}</p>
			</div>
		</div>

		{#if relatedQuestion}
			<div class="flex">
				{#if relatedQuestion.href}
					<a
						href={resolve(relatedQuestion.href as any)}
						class="inline-flex"
						data-sveltekit-preload-code="hover"
						data-sveltekit-preload-data="hover"
						onclick={(event) =>
							handleLinkClick(event, relatedQuestion.href, relatedQuestion.navigationState)}
					>
						<TagChip tone="muted" label={relatedQuestion.label} />
					</a>
				{:else}
					<TagChip tone="muted" label={relatedQuestion.label} />
				{/if}
			</div>
		{/if}

		{#if relatedProject}
			{#if relatedProject.href}
				<a
					href={resolve(relatedProject.href as any)}
					class="type-h4-bold text-primary"
					data-sveltekit-preload-code="hover"
					data-sveltekit-preload-data="hover"
					onclick={(event) =>
						handleLinkClick(event, relatedProject.href, relatedProject.navigationState)}
				>
					{relatedProject.label}
				</a>
			{:else}
				<p class="type-h4-bold text-primary">{relatedProject.label}</p>
			{/if}
		{/if}

		<p class="type-h5 text-foreground">{content}</p>
	</CardContent>
</Card>
