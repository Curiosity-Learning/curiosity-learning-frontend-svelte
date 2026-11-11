<script lang="ts">
	// CL-780: the reviewing guide for Guides, written by Ron. Linked from the review queue and from
	// the scoring form on every application. Content: $lib/domain/application-review-guide.
	import { PageHeaderBackButton, PageHeaderTitle, Section } from '$lib/components/app';
	import { reviewGuide } from '$lib/domain/application-review-guide';
	import { _ } from '$lib/i18n';
	import { routes } from '$lib/routes';
</script>

<PageHeaderTitle title={$_('applicationReviewGuide.title')} />
<PageHeaderBackButton fallbackHref={routes.applicationsReview} />

<div class="flex w-full max-w-3xl flex-col gap-4 py-6">
	<div class="flex flex-col gap-2">
		<h1 class="type-h4-bold text-foreground">{$_('applicationReviewGuide.title')}</h1>
		<p class="type-body text-muted-foreground">{reviewGuide.thanks}</p>
	</div>

	<Section title={$_('applicationReviewGuide.overviewTitle')}>
		<p class="type-body text-foreground">
			<span class="type-body-bold">{$_('applicationReviewGuide.purposeTitle')}:</span>
			{reviewGuide.purpose}
		</p>
		{#each reviewGuide.overview as paragraph (paragraph)}
			<p class="type-body text-foreground">{paragraph}</p>
		{/each}
	</Section>

	<Section title={$_('applicationReviewGuide.processTitle')}>
		<ol class="type-body flex list-decimal flex-col gap-1.5 pl-5 text-foreground">
			{#each reviewGuide.steps as step (step)}
				<li>{step}</li>
			{/each}
		</ol>
		<div class="flex flex-col gap-1.5 rounded-lg bg-gray-50 p-3">
			<p class="type-sm-bold text-foreground">{reviewGuide.notAgainst.intro}</p>
			<ul class="type-sm flex list-disc flex-col gap-1 pl-5 text-foreground">
				{#each reviewGuide.notAgainst.items as item (item)}
					<li>{item}</li>
				{/each}
			</ul>
		</div>
	</Section>

	<Section title={$_('applicationReviewGuide.dimensionsTitle')}>
		{#each reviewGuide.dimensions as dimension (dimension.key)}
			<div class="flex flex-col gap-2 border-b border-border/60 pb-4 last:border-b-0 last:pb-0">
				<h2 class="type-h6-bold text-foreground">{dimension.title}</h2>
				<p class="type-body text-foreground">{dimension.question}</p>
				{#if dimension.intro}
					<p class="type-body text-muted-foreground">{dimension.intro}</p>
				{/if}
				<p class="type-sm-bold text-foreground">{$_('applicationReviewGuide.indicationsTitle')}</p>
				<ul class="type-body flex list-disc flex-col gap-1 pl-5 text-foreground">
					{#each dimension.indications as indication (indication)}
						<li>{indication}</li>
					{/each}
				</ul>
				{#if dimension.misunderstandings}
					<div class="flex flex-col gap-1.5 rounded-lg bg-gray-50 p-3">
						<p class="type-sm text-foreground">{dimension.misunderstandings.intro}</p>
						<ul class="type-sm flex list-disc flex-col gap-1 pl-5 text-foreground">
							{#each dimension.misunderstandings.items as item (item)}
								<li>{item}</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/each}
	</Section>

	<Section title={$_('applicationReviewGuide.scaleTitle')}>
		<dl class="flex flex-col gap-2">
			{#each reviewGuide.scale as step (step.value)}
				<div class="flex items-start gap-3">
					<dt
						class="type-lead-bold flex size-8 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600 tabular-nums"
					>
						{step.value}
					</dt>
					<dd class="flex flex-col">
						<span class="type-body-bold text-foreground">{step.label}</span>
						<span class="type-sm text-muted-foreground">{step.description}</span>
					</dd>
				</div>
			{/each}
		</dl>
	</Section>

	<Section title={$_('applicationReviewGuide.clarifyTitle')}>
		<p class="type-body text-foreground">{$_('applicationReviewGuide.clarifyIntro')}</p>
		<ul class="type-body flex list-disc flex-col gap-1 pl-5 text-foreground">
			{#each reviewGuide.clarifyExamples as example (example)}
				<li>{example}</li>
			{/each}
		</ul>
	</Section>

	<Section title={$_('applicationReviewGuide.importantTitle')}>
		{#each reviewGuide.important as paragraph (paragraph)}
			<p class="type-body text-foreground">{paragraph}</p>
		{/each}
	</Section>
</div>
