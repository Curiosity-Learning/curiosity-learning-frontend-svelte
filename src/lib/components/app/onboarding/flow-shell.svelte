<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import { _ } from '$lib/i18n';
	import onboardingIllustration from '$lib/assets/images/get_started.svg';

	type Props = {
		step: number;
		total: number;
		accountHref?: string;
		accountLabel?: string;
		showAccountLink?: boolean;
		showProgressBar?: boolean;
		showSideIllustration?: boolean;
		desktopContentScrollable?: boolean;
		edgeToEdgePanel?: boolean;
		appFrame?: boolean;
		headerSupplement?: import('svelte').Snippet;
		children: import('svelte').Snippet;
	};

	let {
		step,
		total,
		accountHref = '/auth/sign-in',
		accountLabel,
		showAccountLink = true,
		showProgressBar = true,
		showSideIllustration = false,
		desktopContentScrollable = false,
		edgeToEdgePanel = false,
		appFrame = false,
		headerSupplement,
		children
	}: Props = $props();

	let progress = $derived(total > 0 ? Math.min(100, Math.max(0, (step / total) * 100)) : 0);
	let effectiveShowProgressBar = $derived(!appFrame && showProgressBar);
	let effectiveShowAccountLink = $derived(!appFrame && showAccountLink);
	let effectiveShowSideIllustration = $derived(!appFrame && showSideIllustration);
	let showHeader = $derived(!appFrame);
	let contentTopPadding = $derived(
		appFrame ? 'pt-0' : edgeToEdgePanel ? 'pt-0' : showHeader ? 'pt-6 sm:pt-8' : 'pt-2 sm:pt-6'
	);
</script>

<div
	class={`app-texture-background flex flex-1 ${appFrame ? 'w-full overflow-visible py-0' : edgeToEdgePanel ? 'overflow-x-hidden py-0' : 'justify-center overflow-x-hidden py-4 sm:py-6 lg:py-8'}`}
>
	<div
		class={`app-texture-background w-full ${appFrame ? 'max-w-none px-0' : edgeToEdgePanel ? 'max-w-none px-0' : 'max-w-6xl px-4 sm:px-8'} ${effectiveShowSideIllustration && !edgeToEdgePanel ? 'lg:px-12' : ''}`}
	>
		<div
			class={effectiveShowSideIllustration
				? `${edgeToEdgePanel ? 'min-h-[100dvh] gap-0 lg:min-h-screen lg:grid-cols-2' : 'min-h-[calc(100dvh-2rem)] gap-6 lg:min-h-[calc(100vh-4rem)] lg:grid-cols-2 lg:gap-14'} grid items-stretch`
				: `${appFrame ? 'min-h-0' : edgeToEdgePanel ? 'min-h-[100dvh] lg:min-h-screen' : 'min-h-[calc(100dvh-2rem)] lg:min-h-[calc(100vh-4rem)]'} flex flex-col`}
		>
			<div
				class={effectiveShowSideIllustration
					? `onboarding-shell-panel ${edgeToEdgePanel ? 'onboarding-shell-panel--edge' : ''} flex w-full min-w-0 ${edgeToEdgePanel ? 'min-h-[100dvh] max-w-none px-0 lg:min-h-screen' : 'min-h-[calc(100dvh-2rem)] px-1 lg:min-h-[calc(100vh-4rem)]'} flex-1 flex-col ${desktopContentScrollable && !edgeToEdgePanel ? 'lg:max-h-[calc(100vh-4rem)]' : ''}`
					: `onboarding-shell-panel ${appFrame ? 'onboarding-shell-panel--app min-h-0 max-w-none px-0 pb-0' : edgeToEdgePanel ? 'onboarding-shell-panel--edge min-h-[100dvh] px-0 lg:min-h-screen' : 'mx-auto min-h-[calc(100dvh-2rem)] px-1 lg:min-h-[calc(100vh-4rem)]'} flex w-full min-w-0 flex-1 flex-col`}
			>
				{#if showHeader}
					<div class="sticky top-0 z-10 bg-transparent">
						<header class="flex flex-col gap-4">
							<div class="flex items-center justify-between gap-4">
								<a href="/onboarding/get-started" aria-label={$_('common.appName')} class="shrink-0">
									<img src="/brand/curiosity-learning-logo.png" alt={$_('common.appName')} class="h-9 w-auto" />
								</a>

								{#if effectiveShowAccountLink}
									<a
										href={accountHref}
										class="inline-flex items-center gap-2 text-sm font-bold text-orange-500 transition-colors duration-200 hover:text-orange-600 sm:text-base"
									>
										<span>{accountLabel ?? $_('onboarding.getStarted.iHaveAccount')}</span>
										<ArrowRightIcon class="size-4 sm:size-5" />
									</a>
								{/if}
							</div>

							<div class="flex min-w-0 flex-col gap-2 sm:gap-3">
								{#if effectiveShowProgressBar}
									<div class="h-2 w-full rounded-full bg-gray-200">
										<div
											class="h-full rounded-full bg-orange-500 transition-[width] duration-200"
											style={`width:${progress}%`}
										></div>
									</div>
								{/if}
							</div>
						</header>

						{#if headerSupplement}
							<div class="pt-6 sm:pt-8">
								{@render headerSupplement()}
							</div>
						{/if}
					</div>
				{/if}

				<div
					class={`flex min-h-0 flex-1 flex-col ${contentTopPadding} ${desktopContentScrollable ? 'lg:overflow-y-auto' : ''}`}
				>
					{@render children()}
				</div>
			</div>

			{#if effectiveShowSideIllustration}
				<div
					class={`hidden min-w-0 ${edgeToEdgePanel ? 'justify-center bg-white lg:h-screen' : 'justify-center lg:h-[calc(100vh-4rem)]'} lg:flex lg:items-center`}
				>
					<img
						src={onboardingIllustration}
						alt={$_('onboarding.getStarted.illustrationAlt')}
						class={`h-auto w-full object-contain ${edgeToEdgePanel ? 'max-w-[36rem]' : 'max-w-[32rem]'}`}
					/>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	@media (min-width: 1024px) {
		.onboarding-shell-panel {
			padding-top: 0;
			padding-bottom: 2rem;
		}

		.onboarding-shell-panel--edge {
			padding-top: 0;
			padding-bottom: 0;
		}

		.onboarding-shell-panel--app {
			padding-top: 0;
			padding-bottom: 0;
		}
	}

	@media (min-width: 1024px) and (min-height: 980px) {
		.onboarding-shell-panel {
			padding-top: 120px;
			padding-bottom: 120px;
		}

		.onboarding-shell-panel--edge {
			padding-top: 0;
			padding-bottom: 0;
		}

		.onboarding-shell-panel--app {
			padding-top: 0;
			padding-bottom: 0;
		}
	}
</style>
