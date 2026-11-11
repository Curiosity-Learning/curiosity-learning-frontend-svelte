<script lang="ts">
	// CL-780: one reviewing-guide dimension (Alignment / Motivation / Readiness) scored 1-5. A
	// native radio group so it works with the keyboard and screen readers without extra wiring;
	// the scale labels come from the review guide so the form and the guide page never disagree.
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import {
		REVIEW_SCORE_VALUES,
		reviewGuide,
		reviewScaleLabel,
		type ReviewDimension
	} from '$lib/domain/application-review-guide';
	import { _ } from '$lib/i18n';
	import { cn } from '$lib/utils.js';

	type Props = {
		dimension: ReviewDimension;
		value: number | null;
		disabled?: boolean;
	};

	let { dimension, value = $bindable(), disabled = false }: Props = $props();

	let selectedStep = $derived(reviewGuide.scale.find((step) => step.value === value) ?? null);
</script>

<fieldset class="flex flex-col gap-2" {disabled}>
	<legend class="flex flex-col gap-0.5 pb-2">
		<span class="type-lead-bold text-foreground">{dimension.title}</span>
		<span class="type-sm text-muted-foreground">{dimension.question}</span>
	</legend>

	<div class="grid grid-cols-5 gap-1.5">
		{#each REVIEW_SCORE_VALUES as score (score)}
			<label
				class={cn(
					'type-lead-bold flex h-11 cursor-pointer items-center justify-center rounded-lg border tabular-nums transition-colors',
					'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-orange-300',
					value === score
						? 'border-orange-500 bg-orange-500 text-white'
						: 'border-border bg-white text-foreground hover:border-orange-200 hover:bg-orange-50',
					disabled && 'cursor-not-allowed opacity-60'
				)}
				title={reviewScaleLabel(score)}
			>
				<input
					type="radio"
					class="sr-only"
					name={`score-${dimension.key}`}
					value={score}
					checked={value === score}
					onchange={() => (value = score)}
					aria-label={`${score}: ${reviewScaleLabel(score)}`}
				/>
				{score}
			</label>
		{/each}
	</div>
	<p class="type-sm min-h-5 text-muted-foreground">
		{#if selectedStep}
			<span class="type-sm-bold text-foreground">{selectedStep.label}.</span>
			{selectedStep.description}
		{:else}
			{$_('applicationDetail.pickScore')}
		{/if}
	</p>

	<details class="group rounded-lg bg-gray-50 px-3 py-2">
		<summary
			class="type-sm-bold flex cursor-pointer list-none items-center justify-between gap-2 text-foreground"
		>
			{$_('applicationDetail.whatToLookFor')}
			<ChevronDownIcon class="size-4 transition-transform group-open:rotate-180" />
		</summary>
		<div class="flex flex-col gap-2 pt-2">
			{#if dimension.intro}
				<p class="type-sm text-muted-foreground">{dimension.intro}</p>
			{/if}
			<ul class="type-sm flex list-disc flex-col gap-1 pl-5 text-foreground">
				{#each dimension.indications as indication (indication)}
					<li>{indication}</li>
				{/each}
			</ul>
			{#if dimension.misunderstandings}
				<p class="type-sm text-muted-foreground">{dimension.misunderstandings.intro}</p>
				<ul class="type-sm flex list-disc flex-col gap-1 pl-5 text-foreground">
					{#each dimension.misunderstandings.items as item (item)}
						<li>{item}</li>
					{/each}
				</ul>
			{/if}
		</div>
	</details>
</fieldset>
