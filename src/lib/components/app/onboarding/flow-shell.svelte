<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import onboardingIllustration from '$lib/assets/images/image.svg';

	type Props = {
		step: number;
		total: number;
		accountHref?: string;
		accountLabel?: string;
		showAccountLink?: boolean;
		showProgressBar?: boolean;
		showSideIllustration?: boolean;
		children: import('svelte').Snippet;
	};

	let {
		step,
		total,
		accountHref = '/auth/sign-in',
		accountLabel = 'I have an account',
		showAccountLink = true,
		showProgressBar = true,
		showSideIllustration = false,
		children
	}: Props = $props();

	let progress = $derived(total > 0 ? Math.min(100, Math.max(0, (step / total) * 100)) : 0);
	let showHeader = $derived(showProgressBar || showAccountLink);
</script>

<div
	class={`flex flex-1 justify-center py-6 sm:py-8 ${showSideIllustration ? 'items-start' : 'items-center'}`}
>
	<div class={`w-full max-w-6xl px-4 sm:px-8 ${showSideIllustration ? 'lg:px-12' : ''}`}>
		<div
			class={showSideIllustration
				? 'grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,28.75rem)] lg:gap-14'
				: 'flex flex-col'}
		>
			{#if showSideIllustration}
				<div class="hidden justify-center lg:sticky lg:top-8 lg:flex lg:h-[calc(100vh-4rem)] lg:items-center lg:self-start">
					<img
						src={onboardingIllustration}
						alt="Curiosity Learning illustration"
						class="h-auto w-full max-w-[32rem] object-contain"
					/>
				</div>
			{/if}

			<div class={showSideIllustration ? 'mx-auto flex w-full max-w-[28.75rem] flex-1 flex-col' : 'mx-auto flex w-full flex-1 flex-col'}>
				{#if showHeader}
					<header
						class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 sm:gap-8"
					>
						<div class="flex min-w-0 flex-col gap-2 sm:gap-3 sm:pt-1">
							{#if showProgressBar}
								<div class="h-2 w-full rounded-full bg-gray-200">
									<div
										class="h-full rounded-full bg-orange-500 transition-[width] duration-200"
										style={`width:${progress}%`}
									></div>
								</div>
							{/if}
						</div>

						{#if showAccountLink}
							<a
								href={accountHref}
								class="mt-1 hidden items-center gap-2 text-base font-bold text-orange-500 transition-colors duration-200 hover:text-orange-600 sm:inline-flex"
							>
								<span>{accountLabel}</span>
								<ArrowRightIcon class="size-5" />
							</a>
						{/if}
					</header>
				{/if}

				<div class={`flex flex-1 flex-col ${showHeader ? 'pt-8 sm:pt-14' : 'pt-2 sm:pt-6'}`}>
					{@render children()}
				</div>
			</div>
		</div>
	</div>
</div>
