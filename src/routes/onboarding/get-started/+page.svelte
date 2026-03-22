<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import { Button } from '$lib/components/ui/button';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuLabel,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import { _, locale, setAppLocale, type SupportedLocale } from '$lib/i18n';
	import { routes } from '$lib/routes';
	import loginLogo from '$lib/assets/images/login_image.svg';
	import onboardingIllustration from '$lib/assets/images/image.svg';

	const languageOptions: Array<{
		value: SupportedLocale;
		labelKey: 'settings.language.english' | 'settings.language.dutch';
	}> = [
		{ value: 'en', labelKey: 'settings.language.english' },
		{ value: 'nl', labelKey: 'settings.language.dutch' }
	];
</script>

<div class="flex flex-1 items-center justify-center py-6 sm:py-8">
	<div class="relative w-full max-w-6xl">
		<div class="absolute top-3 right-5 z-10 sm:top-4 sm:right-8 lg:top-6 lg:right-12">
			<DropdownMenu>
				<DropdownMenuTrigger>
					<Button
						variant="ghost"
						size="icon"
						class="rounded-full border border-gray-200 bg-white/90 text-gray-700 shadow-sm backdrop-blur hover:bg-white hover:text-gray-900"
						aria-label={$_('settings.language.label')}
						title={$_('settings.language.label')}
					>
						<GlobeIcon class="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" class="w-44">
					<DropdownMenuLabel>{$_('settings.language.label')}</DropdownMenuLabel>
					{#each languageOptions as option (option.value)}
						<DropdownMenuItem
							class="justify-between gap-3 py-2"
							onSelect={() => setAppLocale(option.value)}
						>
							<span>{$_(option.labelKey)}</span>
							{#if $locale === option.value}
								<CheckIcon class="size-4 text-orange-500" />
							{/if}
						</DropdownMenuItem>
					{/each}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>

		<div
			class="grid w-full items-center gap-10 px-5 py-8 sm:px-8 sm:py-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-14 lg:px-12 lg:py-12"
		>
			<div class="hidden justify-center lg:flex">
				<img
					src={onboardingIllustration}
					alt={$_('onboarding.getStarted.illustrationAlt')}
					class="h-auto w-full max-w-[32rem] object-contain"
				/>
			</div>

			<div class="mx-auto flex w-full max-w-[22rem] flex-col items-center text-center">
				<img src={loginLogo} alt="Curiosity Learning" class="h-10 w-auto sm:h-12" />
				<img
					src={onboardingIllustration}
					alt={$_('onboarding.getStarted.illustrationAlt')}
					class="mt-8 h-auto w-full max-w-[16rem] object-contain lg:hidden"
				/>

				<h1
					class="mt-8 text-[1.75rem] leading-[1.2] text-neutral-black sm:text-[1.9rem]"
					style="font-family: var(--font-family-heading);"
				>
					{$_('onboarding.getStarted.welcome')}
				</h1>
				<p class="mt-3 text-base leading-6 text-gray-600">
					{$_('onboarding.getStarted.subtitle')}
				</p>

				<div class="mt-8 flex w-full flex-col gap-3">
					<Button href="/onboarding/join-club" variant="default" size="xl" class="w-full">
						{$_('onboarding.getStarted.joinClub')}
					</Button>
					<Button href="/onboarding/start-club" variant="outline" size="xl" class="w-full">
						{$_('onboarding.getStarted.startClub')}
					</Button>

					<Button
						href={`/auth/sign-in?next=${encodeURIComponent(routes.profile)}`}
						variant="ghost"
						size="lg"
						class="mt-2 w-full"
					>
						{$_('onboarding.getStarted.iHaveAccount')}
					</Button>
				</div>
			</div>
		</div>
	</div>
</div>
