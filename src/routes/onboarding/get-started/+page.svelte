<script lang="ts">
	import Flower2Icon from '@lucide/svelte/icons/flower-2';
	import Globe2Icon from '@lucide/svelte/icons/globe-2';
	import HeartHandshakeIcon from '@lucide/svelte/icons/heart-handshake';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { clearOnboardingFlowState } from '$lib/auth/onboarding-state';
	import { _ } from '$lib/i18n';
	import { routes } from '$lib/routes';
	import onboardingIllustration from '$lib/assets/images/get_started.svg';

	const featureCards = [
		{
			icon: SparklesIcon,
			titleKey: 'onboarding.getStarted.featureCuriousTitle',
			descriptionKey: 'onboarding.getStarted.featureCuriousDescription',
			tone: 'sun'
		},
		{
			icon: Globe2Icon,
			titleKey: 'onboarding.getStarted.featureTogetherTitle',
			descriptionKey: 'onboarding.getStarted.featureTogetherDescription',
			tone: 'earth'
		},
		{
			icon: HeartHandshakeIcon,
			titleKey: 'onboarding.getStarted.featureImpactTitle',
			descriptionKey: 'onboarding.getStarted.featureImpactDescription',
			tone: 'leaf'
		},
		{
			icon: Flower2Icon,
			titleKey: 'onboarding.getStarted.featureJourneyTitle',
			descriptionKey: 'onboarding.getStarted.featureJourneyDescription',
			tone: 'flower'
		}
	] as const;

	onMount(() => {
		clearOnboardingFlowState();
	});
</script>

<svelte:head>
	<title>{$_('common.appName')}</title>
</svelte:head>

<svg class="chalk-filter-definition" xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true">
	<filter id="chalk" x="-5%" y="-5%" width="110%" height="110%">
		<feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="5" result="wobble" />
		<feDisplacementMap
			in="SourceGraphic"
			in2="wobble"
			scale="6"
			xChannelSelector="R"
			yChannelSelector="G"
			result="wobbled"
		/>
		<feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" seed="2" result="grain" />
		<feDisplacementMap
			in="wobbled"
			in2="grain"
			scale="3"
			xChannelSelector="R"
			yChannelSelector="G"
		/>
	</filter>
</svg>

<div class="flex flex-1 px-4 py-4 sm:px-6 sm:py-6 lg:px-12 lg:py-8">
	<section
		class="relative mx-auto flex min-h-[calc(100dvh-2rem)] w-full max-w-7xl flex-col overflow-hidden px-1 py-2 sm:min-h-[calc(100dvh-3rem)] sm:px-2 sm:py-3 lg:min-h-[calc(100dvh-4rem)] lg:px-0 lg:py-0"
	>
		<div class="pointer-events-none absolute top-24 -left-7 h-48 w-16 rotate-12 rounded-[100%] bg-[#f5a7b8]/55 blur-[1px]"></div>
		<div class="pointer-events-none absolute top-24 right-3 size-28 text-yellow-400/90 sm:right-9 sm:size-36">
			<div class="doodle-sun"></div>
		</div>
		<div class="pointer-events-none absolute right-[-3rem] top-48 hidden size-40 rounded-[46%] bg-green-600/75 lg:block"></div>
		<div class="pointer-events-none absolute bottom-56 left-[38%] hidden h-4 w-20 rotate-[-18deg] rounded-full border-4 border-green-600/80 border-r-0 border-l-0 lg:block"></div>

		<header class="relative z-10 flex items-center justify-between gap-4">
			<a href={routes.onboardingGetStarted} aria-label={$_('common.appName')} class="shrink-0">
				<img src="/brand/curiosity-learning-logo.png" alt={$_('common.appName')} class="h-9 w-auto" />
			</a>

			<nav aria-label="Get started" class="flex items-center gap-2 sm:gap-3">
				<Button
					href={routes.onboardingJoinClub}
					variant="outline"
					size="lg"
					class="hidden border-green-700/60 px-4 text-green-800 hover:border-green-700 hover:bg-green-50 hover:text-green-800 sm:inline-flex"
				>
					{$_('onboarding.getStarted.joinClub')}
				</Button>
				<Button href={routes.onboardingStartClub} size="lg" class="px-4">
					{$_('onboarding.getStarted.startClub')}
				</Button>
			</nav>
		</header>

		<div class="relative z-10 grid flex-1 items-center gap-8 py-8 lg:grid-cols-[0.84fr_1.16fr] lg:gap-12 lg:py-4">
			<div class="flex max-w-[27rem] flex-col items-center gap-6 text-center lg:items-start lg:text-left">
				<div class="flex flex-col gap-4">
					<h1 class="hero-title max-w-[11ch] text-neutral-black">
						{$_('onboarding.getStarted.subtitle')}
					</h1>
					<p class="max-w-[22rem] text-lg leading-7 text-gray-700 sm:text-xl sm:leading-8">
						{$_('onboarding.getStarted.kicker')}
					</p>
				</div>

				<div class="flex w-full max-w-[17rem] flex-col gap-3">
					<Button href={routes.onboardingJoinClub} size="xl" class="h-13 w-full">
						{$_('onboarding.getStarted.joinClub')}
					</Button>
					<Button href={routes.onboardingStartClub} variant="outline" size="xl" class="h-13 w-full">
						{$_('onboarding.getStarted.startClub')}
					</Button>
					<Button
						href={`/auth/sign-in?next=${encodeURIComponent(routes.profile)}`}
						variant="ghost"
						size="lg"
						class="w-full"
					>
						{$_('onboarding.getStarted.iHaveAccount')}
					</Button>
				</div>
			</div>

			<div class="relative flex min-h-[18rem] items-end justify-center lg:min-h-[31rem]">
				<div class="absolute bottom-8 left-4 size-10 rounded-full bg-yellow-400/85 sm:left-10"></div>
				<div class="absolute bottom-2 right-16 size-9 rounded-full bg-purple-500/75"></div>
				<div class="absolute top-8 left-10 hidden h-5 w-14 rotate-[-18deg] rounded-full border-4 border-green-700/80 border-r-0 border-l-0 sm:block"></div>

				<img
					src={onboardingIllustration}
					alt={$_('onboarding.getStarted.illustrationAlt')}
					class="chalk-filter relative z-10 h-auto w-full max-w-[24rem] object-contain drop-shadow-[0_16px_26px_rgba(67,45,23,0.12)] sm:max-w-[34rem] lg:max-w-[42rem]"
				/>
			</div>
		</div>

		<div class="relative z-10 grid gap-5 pb-1 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
			{#each featureCards as feature}
				<div class="flex flex-col items-center gap-3 text-center">
					<div class={`chalk-filter feature-icon feature-icon--${feature.tone}`}>
						<svelte:component this={feature.icon} class="size-8" />
					</div>
					<div class="flex flex-col gap-1.5">
						<h2 class="text-lg leading-6 text-green-700">{$_(feature.titleKey)}</h2>
						<p class="text-sm leading-6 text-gray-600">{$_(feature.descriptionKey)}</p>
					</div>
				</div>
			{/each}
		</div>
	</section>
</div>

<style>
	.chalk-filter-definition {
		position: absolute;
		pointer-events: none;
	}

	.chalk-filter {
		filter: url('#chalk');
	}

	.hero-title {
		font-family: var(--font-family-heading-h1);
		font-size: clamp(3.5rem, 9vw, 6.75rem);
		line-height: 0.9;
		font-weight: 400;
		text-wrap: balance;
	}

	.doodle-sun {
		position: relative;
		width: 100%;
		height: 100%;
		border-radius: 9999px;
		background: currentColor;
		clip-path: polygon(
			50% 0,
			58% 32%,
			86% 14%,
			68% 42%,
			100% 50%,
			68% 58%,
			86% 86%,
			58% 68%,
			50% 100%,
			42% 68%,
			14% 86%,
			32% 58%,
			0 50%,
			32% 42%,
			14% 14%,
			42% 32%
		);
	}

	.doodle-sun::after {
		position: absolute;
		inset: 38%;
		border-radius: 9999px;
		background: #fff9ed;
		content: '';
	}

	.feature-icon {
		display: inline-flex;
		width: 3.75rem;
		height: 3.75rem;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
	}

	.feature-icon--sun {
		color: #c46117;
		background: #fde4d2;
	}

	.feature-icon--earth {
		color: #204b3e;
		background: #d8ebe5;
	}

	.feature-icon--leaf {
		color: #204b3e;
		background: #e3f1d9;
	}

	.feature-icon--flower {
		color: #565990;
		background: #eff0fa;
	}
</style>
