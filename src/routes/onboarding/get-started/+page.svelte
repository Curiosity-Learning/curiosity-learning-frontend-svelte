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

		const desktopQuery = window.matchMedia('(min-width: 1024px)');
		const syncDesktopLock = () => {
			document.documentElement.classList.toggle('get-started-lock', desktopQuery.matches);
		};

		syncDesktopLock();
		desktopQuery.addEventListener('change', syncDesktopLock);

		return () => {
			desktopQuery.removeEventListener('change', syncDesktopLock);
			document.documentElement.classList.remove('get-started-lock');
		};
	});
</script>

<svelte:head>
	<title>{$_('common.appName')}</title>
</svelte:head>

<svg class="chalk-defs" xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true">
	<filter id="chalk" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
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

<div class="get-started">
	<div class="get-started__decor" aria-hidden="true">
		<div class="get-started__blob get-started__blob--pink"></div>
		<div class="chalk-filter get-started__blob get-started__blob--sun">
			<div class="doodle-sun"></div>
		</div>
		<div class="chalk-filter get-started__blob get-started__blob--green"></div>
		<div class="chalk-filter get-started__blob get-started__blob--stroke"></div>
	</div>

	<div class="get-started__frame">
		<header class="get-started__header">
			<a href={routes.onboardingGetStarted} aria-label={$_('common.appName')} class="shrink-0">
				<img
					src="/brand/curiosity-learning-logo.png"
					alt={$_('common.appName')}
					class="h-9 w-auto"
				/>
			</a>
		</header>

		<section class="get-started__hero">
			<div class="get-started__copy">
				<div class="flex w-full flex-col gap-3 sm:gap-4">
					<h1 class="hero-title text-neutral-black">
						{$_('onboarding.getStarted.subtitle')}
					</h1>
					<p class="w-full text-lg leading-7 text-gray-700 sm:text-xl sm:leading-8 lg:text-lg lg:leading-7">
						{$_('onboarding.getStarted.kicker')}
					</p>
				</div>

				<div class="flex w-full flex-col gap-3">
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

			<div class="get-started__art">
				<div class="chalk-filter get-started__art-dot get-started__art-dot--yellow"></div>
				<div class="chalk-filter get-started__art-dot get-started__art-dot--purple"></div>
				<div class="chalk-filter get-started__art-stroke"></div>

				<img
					src={onboardingIllustration}
					alt={$_('onboarding.getStarted.illustrationAlt')}
					class="get-started__illustration"
				/>
			</div>
		</section>

		<footer class="get-started__footer">
			{#each featureCards as feature (feature.titleKey)}
				{@const Icon = feature.icon}
				<div class="get-started__feature">
					<div class={`feature-icon feature-icon--${feature.tone}`}>
						<svg class="chalk-filter feature-icon-background" viewBox="0 0 60 60" aria-hidden="true">
							<circle cx="30" cy="30" r="28" />
						</svg>
						<Icon class="chalk-filter relative z-10 size-8" />
					</div>
					<div class="flex flex-col gap-1.5">
						<h2 class="text-lg leading-6 text-green-700">{$_(feature.titleKey)}</h2>
						<p class="text-sm leading-6 text-gray-600 lg:leading-5">{$_(feature.descriptionKey)}</p>
					</div>
				</div>
			{/each}
		</footer>
	</div>
</div>

<style>
	/* Desktop-only: stop document rubber-banding while this page is mounted. */
	:global(html.get-started-lock),
	:global(html.get-started-lock body) {
		height: 100%;
		overflow: hidden;
		overscroll-behavior: none;
	}

	:global(html.get-started-lock #main-content),
	:global(html.get-started-lock #main-content > .app-texture-background) {
		height: 100%;
		overflow: hidden;
	}

	.chalk-defs {
		position: absolute;
		width: 0;
		height: 0;
		overflow: hidden;
		pointer-events: none;
	}

	.chalk-filter {
		filter: url('#chalk');
	}

	.get-started {
		position: relative;
		isolation: isolate;
		box-sizing: border-box;
		min-height: 100dvh;
		overflow-x: clip;
		padding: 1rem;
	}

	@media (min-width: 640px) {
		.get-started {
			padding: 1.5rem;
		}
	}

	@media (min-width: 1024px) {
		.get-started {
			height: 100dvh;
			max-height: 100dvh;
			overflow: clip;
			overscroll-behavior: none;
			padding: 1.25rem 3rem;
		}
	}

	.get-started__decor {
		position: absolute;
		inset: 0;
		overflow: clip;
		pointer-events: none;
	}

	.get-started__blob--pink {
		position: absolute;
		top: 6rem;
		left: 1rem;
		width: 4rem;
		height: 12rem;
		rotate: 12deg;
		border-radius: 100%;
		background: rgb(245 167 184 / 0.55);
		filter: url('#chalk') blur(1px);
	}

	.get-started__blob--sun {
		position: absolute;
		top: 6rem;
		right: 1.75rem;
		width: 7rem;
		height: 7rem;
		color: rgb(250 204 21 / 0.9);
	}

	.get-started__blob--green {
		position: absolute;
		top: 12rem;
		right: 1rem;
		display: none;
		width: 10rem;
		height: 10rem;
		border-radius: 46%;
		background: rgb(22 163 74 / 0.75);
	}

	.get-started__blob--stroke {
		position: absolute;
		bottom: 14rem;
		left: 38%;
		display: none;
		width: 5rem;
		height: 1rem;
		rotate: -18deg;
		border-radius: 9999px;
		border: 4px solid rgb(22 163 74 / 0.8);
		border-right: 0;
		border-left: 0;
	}

	@media (min-width: 640px) {
		.get-started__blob--sun {
			right: 3rem;
			width: 9rem;
			height: 9rem;
		}
	}

	@media (min-width: 1024px) {
		.get-started__blob--pink {
			left: 3rem;
		}

		.get-started__blob--sun {
			right: 4rem;
		}

		.get-started__blob--green,
		.get-started__blob--stroke {
			display: block;
		}
	}

	.get-started__frame {
		position: relative;
		z-index: 10;
		display: grid;
		width: 100%;
		max-width: 80rem;
		min-height: inherit;
		margin-inline: auto;
		gap: 0;
	}

	@media (min-width: 1024px) {
		.get-started__frame {
			height: 100%;
			min-height: 0;
			grid-template-rows: auto minmax(0, 1fr) auto;
		}
	}

	.get-started__header {
		display: flex;
		align-items: center;
	}

	.get-started__hero {
		display: grid;
		gap: 2rem;
		padding-block: 4rem 2.5rem;
	}

	@media (min-width: 640px) {
		.get-started__hero {
			padding-block: 5rem 3rem;
		}
	}

	@media (min-width: 1024px) {
		.get-started__hero {
			height: 100%;
			min-height: 0;
			grid-template-columns: 1fr 1fr;
			align-items: center;
			gap: 2.5rem;
			overflow: clip;
			padding-block: 0.75rem;
		}
	}

	.get-started__copy {
		display: flex;
		width: 100%;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
		text-align: center;
	}

	@media (min-width: 1024px) {
		.get-started__copy {
			align-items: flex-start;
			gap: 1.25rem;
			text-align: left;
		}
	}

	.get-started__art {
		position: relative;
		display: none;
		width: 100%;
		min-height: 0;
		align-items: flex-end;
		justify-content: center;
		overflow: clip;
	}

	@media (min-width: 1024px) {
		.get-started__art {
			display: flex;
			height: 100%;
			max-height: 100%;
		}
	}

	.get-started__art-dot,
	.get-started__art-stroke {
		position: absolute;
	}

	.get-started__art-dot--yellow {
		bottom: 2rem;
		left: 1rem;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 9999px;
		background: rgb(250 204 21 / 0.85);
	}

	.get-started__art-dot--purple {
		right: 4rem;
		bottom: 0.5rem;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 9999px;
		background: rgb(168 85 247 / 0.75);
	}

	.get-started__art-stroke {
		top: 2rem;
		left: 2.5rem;
		display: none;
		width: 3.5rem;
		height: 1.25rem;
		rotate: -18deg;
		border-radius: 9999px;
		border: 4px solid rgb(21 128 61 / 0.8);
		border-right: 0;
		border-left: 0;
	}

	@media (min-width: 640px) {
		.get-started__art-dot--yellow {
			left: 2.5rem;
		}

		.get-started__art-stroke {
			display: block;
		}
	}

	.get-started__illustration {
		position: relative;
		z-index: 10;
		width: 100%;
		max-width: 42rem;
		height: auto;
		max-height: min(28rem, 42dvh);
		object-fit: contain;
		filter: url('#chalk') drop-shadow(0 16px 26px rgba(67, 45, 23, 0.12));
	}

	@media (min-width: 1280px) {
		.get-started__illustration {
			max-height: min(34rem, 48dvh);
		}
	}

	.get-started__footer {
		display: grid;
		gap: 1.25rem;
		padding-block: 1.5rem 0.25rem;
	}

	@media (min-width: 640px) {
		.get-started__footer {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (min-width: 1024px) {
		.get-started__footer {
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 1.5rem;
			padding-block: 1rem 0;
		}
	}

	.get-started__feature {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		text-align: center;
	}

	@media (min-width: 1024px) {
		.get-started__feature {
			gap: 0.5rem;
		}
	}

	.hero-title {
		font-family: var(--font-family-heading-h1);
		font-size: clamp(3.25rem, 7vw, 5.5rem);
		line-height: 0.9;
		font-weight: 400;
		text-wrap: balance;
	}

	@media (max-width: 639px) {
		.hero-title {
			font-size: clamp(3.5rem, 12vw, 4.5rem);
		}
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
		position: relative;
		display: inline-flex;
		width: 3.75rem;
		height: 3.75rem;
		align-items: center;
		justify-content: center;
		background: transparent;
	}

	.feature-icon-background {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.feature-icon--sun {
		color: #c46117;
		fill: #fde4d2;
	}

	.feature-icon--earth {
		color: var(--green-500);
		fill: #d8ebe5;
	}

	.feature-icon--leaf {
		color: var(--green-500);
		fill: #e3f1d9;
	}

	.feature-icon--flower {
		color: #565990;
		fill: #eff0fa;
	}
</style>
