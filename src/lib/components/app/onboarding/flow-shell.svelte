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
		headerSupplement?: import('svelte').Snippet;
		children: import('svelte').Snippet;
	};

	let {
		step,
		total,
		accountHref = '/auth/sign-in',
		accountLabel,
		showAccountLink = false,
		showProgressBar = true,
		showSideIllustration = false,
		desktopContentScrollable = false,
		edgeToEdgePanel = false,
		headerSupplement,
		children
	}: Props = $props();

	let progress = $derived(total > 0 ? Math.min(100, Math.max(0, (step / total) * 100)) : 0);
	let hasHeaderSupplement = $derived(Boolean(headerSupplement));
	let showHeader = $derived(showProgressBar || showAccountLink || hasHeaderSupplement);
	let contentTopPadding = $derived(
		edgeToEdgePanel ? 'pt-0' : showHeader ? 'pt-6 sm:pt-8' : 'pt-2 sm:pt-6'
	);
</script>

<div class={`flex flex-1 overflow-x-hidden ${edgeToEdgePanel ? 'py-0' : 'justify-center py-4 sm:py-6 lg:py-8'}`}>
	<div
		class={`w-full ${edgeToEdgePanel ? 'max-w-none px-0' : 'max-w-6xl px-4 sm:px-8'} ${showSideIllustration && !edgeToEdgePanel ? 'lg:px-12' : ''}`}
	>
		<div
			class={showSideIllustration
				? `${edgeToEdgePanel ? 'gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-h-[100dvh] lg:min-h-screen' : 'gap-6 lg:gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,28.75rem)] min-h-[calc(100dvh-2rem)] lg:min-h-[calc(100vh-4rem)]'} grid items-stretch`
				: `${edgeToEdgePanel ? 'min-h-[100dvh] lg:min-h-screen' : 'min-h-[calc(100dvh-2rem)] lg:min-h-[calc(100vh-4rem)]'} flex flex-col`}
		>
			{#if showSideIllustration}
				<div class={`hidden ${edgeToEdgePanel ? 'justify-center bg-white lg:h-screen' : 'justify-center lg:h-[calc(100vh-4rem)]'} lg:flex lg:items-center`}>
					<img
						src={onboardingIllustration}
						alt={$_('onboarding.getStarted.illustrationAlt')}
						class={`h-auto w-full object-contain ${edgeToEdgePanel ? 'max-w-[36rem]' : 'max-w-[32rem]'}`}
					/>
				</div>
			{/if}

			<div
				class={showSideIllustration
					? `onboarding-shell-panel ${edgeToEdgePanel ? 'onboarding-shell-panel--edge' : 'mx-auto'} flex min-w-0 w-full ${edgeToEdgePanel ? 'max-w-none min-h-[100dvh] px-0 lg:min-h-screen' : 'max-w-[28.75rem] min-h-[calc(100dvh-2rem)] px-1 lg:min-h-[calc(100vh-4rem)]'} flex-1 flex-col ${desktopContentScrollable && !edgeToEdgePanel ? 'lg:max-h-[calc(100vh-4rem)]' : ''}`
					: `onboarding-shell-panel ${edgeToEdgePanel ? 'onboarding-shell-panel--edge min-h-[100dvh] px-0 lg:min-h-screen' : 'mx-auto min-h-[calc(100dvh-2rem)] px-1 lg:min-h-[calc(100vh-4rem)]'} flex min-w-0 w-full flex-1 flex-col`}
			>
				{#if showHeader}
					<div class={`sticky top-0 z-10 ${edgeToEdgePanel ? 'bg-transparent' : 'bg-white'}`}>
						<header class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 sm:gap-8">
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
									<span>{accountLabel ?? $_('onboarding.getStarted.iHaveAccount')}</span>
									<ArrowRightIcon class="size-5" />
								</a>
							{/if}
						</header>

						{#if headerSupplement}
							<div class="pt-6 sm:pt-8">
								{@render headerSupplement()}
							</div>
						{/if}
					</div>
				{/if}

				<div class={`flex min-h-0 flex-1 flex-col ${contentTopPadding} ${desktopContentScrollable ? 'lg:overflow-y-auto' : ''}`}>
					{@render children()}
				</div>
			</div>
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
	}
</style>
