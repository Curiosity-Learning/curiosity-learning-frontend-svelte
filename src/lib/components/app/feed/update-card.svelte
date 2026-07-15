<script lang="ts">
	import { goto } from '$app/navigation';
	import PlayIcon from '@lucide/svelte/icons/play';
	import VideoIcon from '@lucide/svelte/icons/video';
	import UsersIcon from '@lucide/svelte/icons/users';
	import type { ClassValue } from 'svelte/elements';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import ReportIssueDialog from '$lib/components/app/report-issue-dialog.svelte';
	import CommentsSection from '$lib/components/app/feed/comments-section.svelte';
	import { cn } from '$lib/utils';
	import { formatRelativeTime } from '$lib/domain/date';
	import { routes } from '$lib/routes';
	import { t } from '$lib/i18n';
	import type { Id } from '$convex/_generated/dataModel';

	type RelatedEntity = {
		label: string;
		href?: string;
		navigationState?: App.PageState;
	};

	export type UpdateCardMediaItem = {
		assetId: string;
		kind: 'image' | 'video';
		url: string | null;
	};

	type Props = {
		class?: ClassValue;
		/** System/change-log entries render a visually quiet variant with no author block. */
		variant?: 'default' | 'system';
		/** Enables the report flag in the card header. Omitted for system entries. */
		updateId?: Id<'updates'> | null;
		authorProfileId?: Id<'profiles'> | null;
		authorName?: string | null;
		authorImageUrl?: string | null;
		createdAt: number;
		content: string;
		relatedProject?: RelatedEntity | null;
		relatedClub?: RelatedEntity | null;
		relatedQuestion?: RelatedEntity | null;
		media?: UpdateCardMediaItem[];
		/** Show the project/club context line. Set to false inside the project's own timeline. */
		showProjectContext?: boolean;
	};

	let {
		class: className,
		variant = 'default',
		updateId = null,
		authorProfileId = null,
		authorName = null,
		authorImageUrl = null,
		createdAt,
		content,
		relatedProject = null,
		relatedClub = null,
		relatedQuestion = null,
		media = [],
		showProjectContext = true
	}: Props = $props();

	let displayAuthorName = $derived(authorName?.trim() || t('feed.unknownAuthor'));

	const initialsFor = (name: string) =>
		name
			.split(' ')
			.map((part) => part.trim())
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('');

	let timestampLabel = $derived(formatRelativeTime(createdAt));

	const CONTENT_CLAMP_LENGTH = 260;
	let expanded = $state(false);
	let trimmedContent = $derived(content.trim());
	let isLongContent = $derived(trimmedContent.length > CONTENT_CLAMP_LENGTH);

	const handleLinkClick = (event: MouseEvent, href?: string, navigationState?: App.PageState) => {
		if (!href || !navigationState || event.defaultPrevented) return;
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		void goto(href, { state: navigationState });
	};

	let visibleMedia = $derived(media.slice(0, 4));
	let mediaOverflowCount = $derived(Math.max(media.length - visibleMedia.length, 0));

	const mediaTileClass = (index: number, count: number) => {
		if (count === 1) return 'aspect-video';
		if (count === 2) return 'aspect-square';
		if (count === 3 && index === 0) return 'aspect-square row-span-2';
		return 'aspect-square';
	};

	let mediaGridClass = $derived.by(() => {
		const count = visibleMedia.length;
		if (count <= 1) return 'grid-cols-1';
		if (count === 3) return 'grid-cols-2';
		return 'grid-cols-2';
	});
</script>

<Card
	class={cn(
		'gap-0 rounded-2xl border border-border/80 bg-card py-0 shadow-sm',
		variant === 'system' && 'border-dashed border-border/60 bg-muted/30 shadow-none',
		className
	)}
>
	<CardContent class={cn('flex flex-col gap-3', variant === 'system' ? 'p-4' : 'p-5')}>
		{#if variant === 'system'}
			<div class="flex min-w-0 items-center gap-2">
				<Badge variant="outline" size="sm" class="type-caption shrink-0 text-muted-foreground">
					{t('feed.systemBadge')}
				</Badge>
				<p class="type-sm min-w-0 flex-1 text-muted-foreground">{trimmedContent}</p>
				<p class="type-caption shrink-0 text-muted-foreground">{timestampLabel}</p>
			</div>
		{:else}
			<div class="flex min-w-0 items-center gap-3">
				{#if authorProfileId}
					<a
						href={routes.profileDetail(authorProfileId)}
						class="flex min-w-0 flex-1 items-center gap-3"
						data-sveltekit-preload-code="hover"
						data-sveltekit-preload-data="hover"
					>
						<Avatar class="size-10 shrink-0">
							{#if authorImageUrl}
								<AvatarImage src={authorImageUrl} alt={displayAuthorName} />
							{/if}
							<AvatarFallback class="type-body-bold">{initialsFor(displayAuthorName)}</AvatarFallback>
						</Avatar>

						<div class="flex min-w-0 flex-1 items-center gap-2">
							<p class="truncate type-body-bold text-foreground hover:underline">
								{displayAuthorName}
							</p>
							<span class="shrink-0 text-muted-foreground">&middot;</span>
							<p class="shrink-0 type-sm text-muted-foreground">{timestampLabel}</p>
						</div>
					</a>
				{:else}
					<Avatar class="size-10 shrink-0">
						{#if authorImageUrl}
							<AvatarImage src={authorImageUrl} alt={displayAuthorName} />
						{/if}
						<AvatarFallback class="type-body-bold">{initialsFor(displayAuthorName)}</AvatarFallback>
					</Avatar>

					<div class="flex min-w-0 flex-1 items-center gap-2">
						<p class="truncate type-body-bold text-foreground">{displayAuthorName}</p>
						<span class="shrink-0 text-muted-foreground">&middot;</span>
						<p class="shrink-0 type-sm text-muted-foreground">{timestampLabel}</p>
					</div>
				{/if}

				{#if updateId}
					<ReportIssueDialog
						targetType="project_update"
						targetId={updateId}
						contextText={content}
						triggerAriaLabel={t('feed.reportUpdateAction')}
					/>
				{/if}
			</div>

			{#if showProjectContext && (relatedProject || relatedClub)}
				<div class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 pl-[3.25rem] -mt-1">
					{#if relatedProject}
						{#if relatedProject.href}
							<a
								href={relatedProject.href}
								class="type-sm-bold min-w-0 truncate text-orange-500 hover:text-orange-600 hover:underline"
								data-sveltekit-preload-code="hover"
								data-sveltekit-preload-data="hover"
								onclick={(event) =>
									handleLinkClick(event, relatedProject!.href, relatedProject!.navigationState)}
							>
								{relatedProject.label}
							</a>
						{:else}
							<p class="type-sm-bold min-w-0 truncate text-orange-500">{relatedProject.label}</p>
						{/if}
					{/if}

					{#if relatedProject && relatedClub}
						<span class="shrink-0 text-muted-foreground">in</span>
					{/if}

					{#if relatedClub}
						<span class="inline-flex min-w-0 shrink items-center gap-1 type-sm text-muted-foreground">
							<UsersIcon class="size-3.5 shrink-0" />
							{#if relatedClub.href}
								<a
									href={relatedClub.href}
									class="min-w-0 truncate hover:text-foreground hover:underline"
									data-sveltekit-preload-code="hover"
									data-sveltekit-preload-data="hover"
									onclick={(event) =>
										handleLinkClick(event, relatedClub!.href, relatedClub!.navigationState)}
								>
									{relatedClub.label}
								</a>
							{:else}
								<span class="min-w-0 truncate">{relatedClub.label}</span>
							{/if}
						</span>
					{/if}
				</div>
			{/if}

			{#if relatedQuestion}
				<div class="flex min-w-0 pl-[3.25rem]">
					{#if relatedQuestion.href}
						<a
							href={relatedQuestion.href}
							class="type-sm truncate text-muted-foreground hover:text-foreground hover:underline"
							data-sveltekit-preload-code="hover"
							data-sveltekit-preload-data="hover"
							onclick={(event) =>
								handleLinkClick(event, relatedQuestion!.href, relatedQuestion!.navigationState)}
						>
							{relatedQuestion.label}
						</a>
					{:else}
						<p class="type-sm truncate text-muted-foreground">{relatedQuestion.label}</p>
					{/if}
				</div>
			{/if}

			<div class="flex flex-col gap-1">
				<p
					class={cn(
						'type-body whitespace-pre-wrap text-foreground',
						isLongContent && !expanded && 'line-clamp-4'
					)}
				>
					{trimmedContent}
				</p>
				{#if isLongContent}
					<Button variant="link" class="type-sm-bold w-fit" onclick={() => (expanded = !expanded)}>
						{expanded ? t('feed.readLess') : t('feed.readMore')}
					</Button>
				{/if}
			</div>

			{#if visibleMedia.length > 0}
				<div class={cn('grid gap-2', mediaGridClass)}>
					{#each visibleMedia as item, index (item.assetId)}
						<div
							class={cn(
								'relative overflow-hidden rounded-xl border border-border/70 bg-muted/30',
								mediaTileClass(index, visibleMedia.length)
							)}
						>
							{#if item.url}
								{#if item.kind === 'video'}
									<!-- svelte-ignore a11y_media_has_caption -->
									<video
										src={item.url}
										controls
										preload="metadata"
										class="size-full bg-black object-cover"
										aria-label={t('feed.videoAttachment')}
									></video>
									<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
										<span
											class="flex size-11 items-center justify-center rounded-full bg-black/50 text-white"
											aria-hidden="true"
										>
											<PlayIcon class="size-5 translate-x-0.5 fill-current" />
										</span>
									</div>
								{:else}
									<img src={item.url} alt={t('feed.attachmentAlt')} class="size-full object-cover" />
								{/if}
							{:else if item.kind === 'video'}
								<div class="flex size-full flex-col items-center justify-center gap-2 p-4 text-center">
									<VideoIcon class="size-6 text-muted-foreground" />
									<p class="type-caption text-muted-foreground">{t('feed.mediaPreparing')}</p>
								</div>
							{:else}
								<div class="flex size-full items-center justify-center p-4 text-center">
									<p class="type-caption text-muted-foreground">{t('feed.mediaPreparing')}</p>
								</div>
							{/if}

							{#if index === visibleMedia.length - 1 && mediaOverflowCount > 0}
								<div
									class="absolute inset-0 flex items-center justify-center bg-black/50 type-h5-bold text-white"
								>
									+{mediaOverflowCount}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			{#if updateId}
				<CommentsSection {updateId} />
			{/if}
		{/if}
	</CardContent>
</Card>
