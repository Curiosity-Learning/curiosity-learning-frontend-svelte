<script lang="ts">
	import Flower2Icon from '@lucide/svelte/icons/flower-2';
	import Globe2Icon from '@lucide/svelte/icons/globe-2';
	import HeartHandshakeIcon from '@lucide/svelte/icons/heart-handshake';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { onMount } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
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

	// Desktop only: stop rubber-banding, and stop scrolling altogether while the whole page fits
	// the viewport. When it does not fit (short laptop screens), the page scrolls so no button or
	// card is ever out of reach.
	const desktopScrollLock: Attachment<HTMLElement> = (page) => {
		const root = document.documentElement;
		const desktopQuery = window.matchMedia('(min-width: 1024px)');
		const sync = () => {
			const desktop = desktopQuery.matches;
			root.classList.toggle('get-started-desktop', desktop);
			root.classList.toggle(
				'get-started-lock',
				desktop && page.getBoundingClientRect().height <= root.clientHeight + 1
			);
		};

		const pageObserver = new ResizeObserver(sync);
		pageObserver.observe(page);
		window.addEventListener('resize', sync);
		sync();

		return () => {
			pageObserver.disconnect();
			window.removeEventListener('resize', sync);
			root.classList.remove('get-started-desktop', 'get-started-lock');
		};
	};
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

<div class="get-started" {@attach desktopScrollLock}>
	<div class="get-started__frame">
		<div class="get-started__decor" aria-hidden="true">
			<div class="get-started__blob get-started__blob--pink"></div>
			<div class="chalk-filter get-started__blob get-started__blob--sun">
				<div class="doodle-sun"></div>
			</div>
			<div class="chalk-filter get-started__blob get-started__blob--green"></div>
			<div class="chalk-filter get-started__blob get-started__blob--stroke"></div>
		</div>

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
	/* Desktop only, toggled from onMount: no rubber-banding past the texture, and no scrolling
	   at all while the whole page fits the viewport. */
	:global(html.get-started-desktop),
	:global(html.get-started-desktop body) {
		overscroll-behavior: none;
	}

	:global(html.get-started-lock),
	:global(html.get-started-lock body) {
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
		display: flex;
		flex-direction: column;
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
			padding: 1.25rem 3rem;
		}
	}

	/* Spans the content column plus 1rem of the page padding on each side (the padding is never
	   less than 1rem), so the doodles sit where they do in the content but are clipped before
	   they can cause horizontal scrolling. Offsets below are the content offsets + 1rem. */
	.get-started__decor {
		position: absolute;
		inset: 0 -1rem;
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
		color: color-mix(in oklab, var(--color-yellow-400) 90%, transparent);
	}

	.get-started__blob--green {
		position: absolute;
		top: 12rem;
		right: 1rem;
		display: none;
		width: 10rem;
		height: 10rem;
		border-radius: 46%;
		background: color-mix(in oklab, var(--color-green-600) 75%, transparent);
	}

	.get-started__blob--stroke {
		position: absolute;
		bottom: 14rem;
		left: calc(1rem + (100% - 2rem) * 0.38);
		display: none;
		width: 5rem;
		height: 1rem;
		rotate: -18deg;
		border-radius: 9999px;
		border: 4px solid color-mix(in oklab, var(--color-green-600) 80%, transparent);
		border-right: 0;
		border-left: 0;
	}

	@media (min-width: 640px) {
		.get-started__blob--sun {
			right: 3.25rem;
			width: 9rem;
			height: 9rem;
		}
	}

	@media (min-width: 1024px) {
		.get-started__blob--green,
		.get-started__blob--stroke {
			display: block;
		}
	}

	.get-started__frame {
		position: relative;
		z-index: 10;
		display: grid;
		flex: 1 0 auto;
		grid-template-rows: auto 1fr auto;
		width: 100%;
		max-width: 80rem;
		margin-inline: auto;
		gap: 0;
	}

	/* Rows grow with their content, so nothing can be clipped: when the viewport is too short
	   the page scrolls instead (the lock in onMount then stays off). */
	.get-started__header,
	.get-started__hero,
	.get-started__footer {
		position: relative;
	}

	.get-started__header {
		display: flex;
		align-items: center;
	}

	.get-started__hero {
		display: grid;
		align-content: center;
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
			grid-template-columns: 1fr 1fr;
			align-items: center;
			gap: 2.5rem;
			padding-block: 0.5rem;
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
		background: color-mix(in oklab, var(--color-yellow-400) 85%, transparent);
	}

	.get-started__art-dot--purple {
		right: 4rem;
		bottom: 0.5rem;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 9999px;
		background: color-mix(in oklab, var(--color-purple-500) 75%, transparent);
	}

	.get-started__art-stroke {
		top: 2rem;
		left: 2.5rem;
		display: none;
		width: 3.5rem;
		height: 1.25rem;
		rotate: -18deg;
		border-radius: 9999px;
		border: 4px solid color-mix(in oklab, var(--color-green-700) 80%, transparent);
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
