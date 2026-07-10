<script lang="ts">
	import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { useConvexClient } from 'convex-svelte';
	import { Avatar, AvatarFallback } from '$lib/components/ui/avatar';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import ReportIssueDialog from '$lib/components/app/report-issue-dialog.svelte';
	import { formatRelativeTime } from '$lib/domain/date';
	import { formatT, t } from '$lib/i18n';

	type Props = {
		updateId: Id<'updates'>;
	};

	let { updateId }: Props = $props();

	const convexClient = useConvexClient();

	let expanded = $state(false);
	let draft = $state('');
	let submitting = $state(false);
	let submitError = $state('');

	const COMMENT_MAX_LENGTH = 1000;

	const countResponse = useStableQuery(api.updateComments.countComments, () => ({ updateId }));
	const canCommentResponse = useStableQuery(api.updateComments.canComment, () => ({ updateId }));
	const commentsResponse = useStableQuery(api.updateComments.listComments, () =>
		expanded ? { updateId } : 'skip'
	);

	let commentCount = $derived(countResponse.data ?? 0);
	let canPost = $derived(canCommentResponse.data ?? false);
	let comments = $derived(commentsResponse.data ?? []);

	const countLabel = $derived.by(() => {
		if (commentCount === 0) return t('comments.countZero');
		if (commentCount === 1) return t('comments.countOne');
		return formatT('comments.countOther', { count: commentCount });
	});

	const initialsFor = (name: string) =>
		name
			.split(' ')
			.map((part) => part.trim())
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? '')
			.join('');

	const submitComment = async () => {
		const trimmed = draft.trim();
		if (!trimmed || submitting) return;
		submitting = true;
		submitError = '';
		try {
			await convexClient.mutation(api.updateComments.addComment, {
				updateId,
				content: trimmed
			});
			draft = '';
		} catch (error) {
			submitError = error instanceof Error ? error.message : t('comments.submitFailure');
		} finally {
			submitting = false;
		}
	};
</script>

<div class="flex flex-col gap-2 pl-[3.25rem]">
	<button
		type="button"
		class="type-sm-bold flex w-fit items-center gap-1.5 text-muted-foreground hover:text-foreground"
		onclick={() => (expanded = !expanded)}
	>
		<MessageCircleIcon class="size-4" />
		{expanded ? t('comments.hideAction') : countLabel}
	</button>

	{#if expanded}
		<div class="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/20 p-3">
			{#if commentsResponse.isLoading}
				<p class="type-sm text-muted-foreground">{t('common.loading')}</p>
			{:else if commentsResponse.error}
				<p class="type-sm text-destructive">{t('comments.loadFailure')}</p>
			{:else if comments.length === 0}
				<p class="type-sm text-muted-foreground">{t('comments.emptyState')}</p>
			{:else}
				{#each comments as comment (comment.commentId)}
					<div class="flex min-w-0 items-start gap-2">
						<Avatar class="size-7 shrink-0">
							<AvatarFallback class="type-caption">{initialsFor(comment.authorName)}</AvatarFallback>
						</Avatar>
						<div class="flex min-w-0 flex-1 flex-col gap-0.5">
							<div class="flex min-w-0 items-center gap-2">
								<p class="truncate type-sm-bold text-foreground">{comment.authorName}</p>
								<span class="shrink-0 type-caption text-muted-foreground"
									>{formatRelativeTime(comment.createdAt)}</span
								>
								<div class="ml-auto shrink-0">
									<ReportIssueDialog
										targetType="comment"
										targetId={comment.commentId}
										contextText={comment.content}
										triggerAriaLabel={t('comments.reportCommentAction')}
									/>
								</div>
							</div>
							<p class="type-sm whitespace-pre-wrap text-foreground">{comment.content}</p>
						</div>
					</div>
				{/each}
			{/if}

			{#if canPost}
				<div class="flex flex-col gap-2">
					<Textarea
						bind:value={draft}
						rows={2}
						maxlength={COMMENT_MAX_LENGTH}
						placeholder={t('comments.composerPlaceholder')}
					/>
					{#if submitError}
						<p class="type-sm text-destructive">{submitError}</p>
					{/if}
					<Button
						size="sm"
						class="w-fit"
						disabled={submitting || !draft.trim()}
						onclick={() => void submitComment()}
					>
						{submitting ? t('comments.posting') : t('comments.postAction')}
					</Button>
				</div>
			{:else if canCommentResponse.data !== undefined}
				<p class="type-sm text-muted-foreground">{t('comments.ineligibleNotice')}</p>
			{/if}
		</div>
	{/if}
</div>
