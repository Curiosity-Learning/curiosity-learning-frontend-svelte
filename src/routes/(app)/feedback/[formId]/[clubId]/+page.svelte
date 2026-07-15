<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$convex/_generated/api';
	import type { Id } from '$convex/_generated/dataModel';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { FieldError } from '$lib/components/ui/field';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group';
	import { LoadingState, PageHeaderBackButton, PageHeaderTitle } from '$lib/components/app';
	import { showGlobalSnackbar } from '$lib/components/app/snackbar';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { captureUnexpectedOperationalError } from '$lib/monitoring/capture';
	import { routes } from '$lib/routes';
	import { t } from '$lib/i18n';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const convexClient = useConvexClient();
	const formResponse = useStableQuery(api.forms.getFormForSubmission, () => ({
		formId: data.formId as Id<'forms'>,
		clubId: data.clubId as Id<'clubs'>
	}));

	type AnswerValue = string | number | boolean;
	let answers = $state<Record<string, AnswerValue>>({});
	let touched = $state<Record<string, boolean>>({});
	let submitting = $state(false);
	let submitError = $state('');

	const audienceLabel = (audience: 'guide' | 'learner') =>
		audience === 'guide' ? t('feedback.audienceGuide') : t('feedback.audienceLearner');

	const scaleOptions = Array.from({ length: 10 }, (_, index) => index + 1);

	const isAnswerMissing = (questionId: string, required: boolean) => {
		if (!required) return false;
		const value = answers[questionId];
		if (value === undefined) return true;
		if (typeof value === 'string') return value.trim().length === 0;
		return false;
	};

	const submit = async () => {
		const form = formResponse.data;
		if (!form) return;

		touched = Object.fromEntries(form.questions.map((question) => [question.id, true]));
		const hasMissing = form.questions.some((question) =>
			isAnswerMissing(question.id, question.required)
		);
		if (hasMissing) return;

		submitting = true;
		submitError = '';
		try {
			await convexClient.mutation(api.forms.submitResponse, {
				formId: form.formId,
				clubId: form.clubId,
				answers: form.questions
					.filter((question) => answers[question.id] !== undefined)
					.map((question) => ({
						questionId: question.id,
						value: answers[question.id]
					}))
			});
			showGlobalSnackbar({ title: t('feedback.submitSuccessTitle') });
			await goto(resolve(routes.feedback), { invalidateAll: true });
		} catch (error) {
			captureUnexpectedOperationalError(error, {
				area: 'backend',
				operation: 'forms:submitResponse'
			});
			const message = error instanceof Error ? error.message : 'Please try again.';
			submitError = message;
			showGlobalSnackbar({ title: t('feedback.submitFailureTitle'), description: message });
		} finally {
			submitting = false;
		}
	};
</script>

<PageHeaderBackButton fallbackHref={routes.feedback} />
<PageHeaderTitle title={t('feedback.pageTitle')} />

<div class="flex w-full flex-col gap-4 py-4">
	{#if formResponse.error}
		<Alert variant="destructive">
			<AlertTitle>{t('feedback.formLoadErrorTitle')}</AlertTitle>
			<AlertDescription>{formResponse.error.message}</AlertDescription>
		</Alert>
	{:else if formResponse.isLoading && !formResponse.data}
		<LoadingState label="Loading form" />
	{:else if formResponse.data}
		{@const form = formResponse.data}
		<Card>
			<CardHeader class="flex flex-col gap-1">
				<CardTitle
					>{t('feedback.cardTitle')
						.replace('{club}', form.clubName)
						.replace('{audience}', audienceLabel(form.audience))}</CardTitle
				>
			</CardHeader>
			<CardContent class="flex flex-col gap-6">
				{#if submitError}
					<Alert variant="destructive">
						<AlertTitle>{t('feedback.submitFailureTitle')}</AlertTitle>
						<AlertDescription>{submitError}</AlertDescription>
					</Alert>
				{/if}

				{#each form.questions as question (question.id)}
					<div class="flex flex-col gap-2">
						<Label for={`question-${question.id}`}>
							{question.label}{#if question.required}<span class="text-destructive"> *</span
								>{/if}
						</Label>

						{#if question.kind === 'scale_1_10'}
							<p class="type-sm text-muted-foreground">{t('feedback.scaleQuestionHint')}</p>
							<ToggleGroup
								type="single"
								size="lg"
								value={answers[question.id] !== undefined ? String(answers[question.id]) : ''}
								onValueChange={(value) => {
									touched[question.id] = true;
									if (value) {
										answers[question.id] = Number(value);
									} else {
										delete answers[question.id];
									}
								}}
								class="flex-wrap"
							>
								{#each scaleOptions as option (option)}
									<ToggleGroupItem value={String(option)} aria-label={String(option)}>
										{option}
									</ToggleGroupItem>
								{/each}
							</ToggleGroup>
						{:else if question.kind === 'yes_no'}
							<ToggleGroup
								type="single"
								size="lg"
								value={answers[question.id] === undefined
									? ''
									: answers[question.id]
										? 'yes'
										: 'no'}
								onValueChange={(value) => {
									touched[question.id] = true;
									if (value === 'yes') answers[question.id] = true;
									else if (value === 'no') answers[question.id] = false;
									else delete answers[question.id];
								}}
							>
								<ToggleGroupItem value="yes">{t('feedback.yesOption')}</ToggleGroupItem>
								<ToggleGroupItem value="no">{t('feedback.noOption')}</ToggleGroupItem>
							</ToggleGroup>
						{:else}
							<Textarea
								id={`question-${question.id}`}
								rows={4}
								value={typeof answers[question.id] === 'string'
									? (answers[question.id] as string)
									: ''}
								oninput={(event) => {
									touched[question.id] = true;
									answers[question.id] = event.currentTarget.value;
								}}
							/>
						{/if}

						{#if touched[question.id] && isAnswerMissing(question.id, question.required)}
							<FieldError>{t('feedback.requiredFieldError')}</FieldError>
						{/if}
					</div>
				{/each}

				<Button disabled={submitting} onclick={() => void submit()}>
					{submitting ? t('feedback.submitting') : t('feedback.submitAction')}
				</Button>
			</CardContent>
		</Card>
	{/if}
</div>
