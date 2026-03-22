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
		desktopContentScrollable?: boolean;
		headerSupplement?: import('svelte').Snippet;
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
		desktopContentScrollable = true,
		headerSupplement,
		children
	}: Props = $props();

	let progress = $derived(total > 0 ? Math.min(100, Math.max(0, (step / total) * 100)) : 0);
	let hasHeaderSupplement = $derived(Boolean(headerSupplement));
	let showHeader = $derived(showProgressBar || showAccountLink || hasHeaderSupplement);
	let contentTopPadding = $derived(
		showHeader
			? hasHeaderSupplement
				? 'pt-6 sm:pt-8'
				: 'pt-8 sm:pt-14'
			: 'pt-2 sm:pt-6'
	);
</script>

<div class="flex flex-1 justify-center py-4 sm:py-6 lg:items-center lg:py-8">
	<div class={`w-full max-w-6xl px-4 sm:px-8 ${showSideIllustration ? 'lg:px-12' : ''}`}>
		<div
			class={showSideIllustration
				? 'grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28.75rem)] lg:items-center lg:gap-14'
				: 'flex min-h-[calc(100dvh-2rem)] flex-col lg:min-h-0'}
		>
			{#if showSideIllustration}
				<div class="hidden justify-center lg:flex lg:h-[calc(100vh-4rem)] lg:items-center">
					<img
						src={onboardingIllustration}
						alt="Curiosity Learning illustration"
						class="h-auto w-full max-w-[32rem] object-contain"
					/>
				</div>
			{/if}

			<div
				class={showSideIllustration
					? `mx-auto flex w-full max-w-[28.75rem] min-h-[calc(100dvh-2rem)] flex-1 flex-col lg:min-h-0 ${
							desktopContentScrollable ? 'lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto' : ''
						}`
					: 'mx-auto flex w-full min-h-[calc(100dvh-2rem)] flex-1 flex-col lg:min-h-0'}
			>
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

					{#if headerSupplement}
						<div class="pt-6 sm:pt-8">
							{@render headerSupplement()}
						</div>
					{/if}
				{/if}

				<div class={`flex min-h-0 flex-1 flex-col ${contentTopPadding}`}>
					{@render children()}
				</div>
			</div>
		</div>
	</div>
</div>
