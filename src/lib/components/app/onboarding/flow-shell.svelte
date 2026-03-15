<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import loginLogo from '$lib/assets/images/login_image.svg';
	import onboardingIllustration from '$lib/assets/images/image.svg';

	type Props = {
		step: number;
		total: number;
		accountHref?: string;
		accountLabel?: string;
		showAccountLink?: boolean;
		showSideIllustration?: boolean;
		children: import('svelte').Snippet;
	};

	let {
		step,
		total,
		accountHref = '/auth/sign-in',
		accountLabel = 'I have an account',
		showAccountLink = true,
		showSideIllustration = false,
		children
	}: Props = $props();

	let progress = $derived(total > 0 ? Math.min(100, Math.max(0, (step / total) * 100)) : 0);
</script>

<div class="flex flex-1 items-center justify-center py-6 sm:py-8">
	<div class={`w-full max-w-6xl px-4 sm:px-8 ${showSideIllustration ? 'lg:px-12' : ''}`}>
		<div
			class={showSideIllustration
				? 'grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,28.75rem)] lg:gap-14'
				: 'flex flex-col'}
		>
			{#if showSideIllustration}
				<div class="hidden justify-center lg:flex">
					<img
						src={onboardingIllustration}
						alt="Curiosity Learning illustration"
						class="h-auto w-full max-w-[32rem] object-contain"
					/>
				</div>
			{/if}

			<div class={showSideIllustration ? 'mx-auto flex w-full max-w-[28.75rem] flex-1 flex-col' : 'mx-auto flex w-full flex-1 flex-col'}>
				<header
					class="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-8"
				>
					<img src={loginLogo} alt="Curiosity Learning" class="hidden h-11 w-auto sm:block" />

					<div class="col-span-full flex min-w-0 flex-col gap-2 sm:col-span-1 sm:gap-3 sm:pt-1">
						<div class="h-2 w-full rounded-full bg-gray-200">
							<div
								class="h-full rounded-full bg-orange-500 transition-[width] duration-200"
								style={`width:${progress}%`}
							></div>
						</div>
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

				<div class="flex flex-1 flex-col pt-8 sm:pt-14">
					{@render children()}
				</div>
			</div>
		</div>
	</div>
</div>
