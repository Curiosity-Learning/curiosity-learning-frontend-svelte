<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import { Button } from '$lib/components/ui/button';
	import { PageHeaderTitle } from '$lib/components/app';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import { _, t } from '$lib/i18n';
	import { routes } from '$lib/routes';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$convex/_generated/api';

	const CODE_LENGTH = 6;
	const JOIN_CLUB_CODE_STORAGE_KEY = 'cl_join_club_code_v1';
	const convexClient = useConvexClient();

	let codeChars = $state<string[]>(Array.from({ length: CODE_LENGTH }, () => ''));
	let inputRefs: Array<HTMLInputElement | null> = Array.from({ length: CODE_LENGTH }, () => null);
	let validatingCode = $state(false);
	let codeError = $state('');

	let canContinue = $derived(codeChars.every((char) => char.length === 1));
	let joinedCode = $derived(codeChars.join(''));
	let isAppNewClubFlow = $derived(page.url.pathname.startsWith(routes.newClubJoin));
	let joinClubPath = $derived(isAppNewClubFlow ? routes.newClubJoin : routes.onboardingJoinClub);
	let publicClubsPath = $derived(
		isAppNewClubFlow ? routes.newClubPublicClubs : routes.onboardingPublicClubs
	);
	let backPath = $derived(isAppNewClubFlow ? routes.newClub : routes.onboardingGetStarted);
	let contentClass = $derived(
		isAppNewClubFlow
			? 'flex w-full min-w-0 flex-col gap-6'
			: 'mx-auto flex w-full max-w-[28.75rem] min-w-0 flex-1 flex-col gap-8'
	);

	const normalizeCode = (value: string) => value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

	const writeStoredCode = (value: string) => {
		if (!browser) return;
		try {
			if (value) {
				sessionStorage.setItem(JOIN_CLUB_CODE_STORAGE_KEY, value);
				return;
			}
			sessionStorage.removeItem(JOIN_CLUB_CODE_STORAGE_KEY);
		} catch {
			// Ignore storage errors.
		}
	};

	const readStoredCode = () => {
		if (!browser) return '';
		try {
			return normalizeCode(sessionStorage.getItem(JOIN_CLUB_CODE_STORAGE_KEY) ?? '').slice(
				0,
				CODE_LENGTH
			);
		} catch {
			return '';
		}
	};

	const focusInput = (index: number) => {
		if (index < 0 || index >= CODE_LENGTH) return;
		const node = inputRefs[index];
		node?.focus();
		node?.select();
	};

	const fillFrom = (startIndex: number, value: string) => {
		const normalized = normalizeCode(value).slice(0, CODE_LENGTH - startIndex);
		for (let i = 0; i < normalized.length; i += 1) {
			codeChars[startIndex + i] = normalized[i] ?? '';
		}
		const nextIndex = Math.min(startIndex + normalized.length, CODE_LENGTH - 1);
		focusInput(nextIndex);
	};

	const handleInput = (index: number, event: Event) => {
		const target = event.currentTarget as HTMLInputElement;
		const normalized = normalizeCode(target.value);

		if (!normalized) {
			codeChars[index] = '';
			return;
		}

		if (normalized.length === 1) {
			codeChars[index] = normalized;
			if (index < CODE_LENGTH - 1) {
				focusInput(index + 1);
			}
			return;
		}

		fillFrom(index, normalized);
	};

	const handleKeyDown = (index: number, event: KeyboardEvent) => {
		if (event.key === 'Backspace') {
			event.preventDefault();
			if (codeChars[index]) {
				codeChars[index] = '';
				return;
			}
			if (index > 0) {
				codeChars[index - 1] = '';
				focusInput(index - 1);
			}
			return;
		}

		if (event.key === 'ArrowLeft' && index > 0) {
			event.preventDefault();
			focusInput(index - 1);
			return;
		}

		if (event.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
			event.preventDefault();
			focusInput(index + 1);
		}
	};

	const handlePaste = (index: number, event: ClipboardEvent) => {
		const pasted = normalizeCode(event.clipboardData?.getData('text') ?? '');
		if (!pasted) return;
		event.preventDefault();
		fillFrom(index, pasted);
	};

	const continueToPreview = async () => {
		if (!canContinue) return;
		validatingCode = true;
		codeError = '';
		try {
			const preview = await convexClient.query(api.clubs.getClubPreviewByCode, {
				code: joinedCode
			});
			if (!preview) {
				codeError = t('onboarding.joinClub.notFound');
				return;
			}
			await goto(`${joinClubPath}/${joinedCode}`);
		} catch {
			codeError = t('onboarding.joinClub.validateFailure');
		} finally {
			validatingCode = false;
		}
	};

	const viewPublicClubs = async () => {
		await goto(publicClubsPath);
	};

	onMount(() => {
		const storedCode = readStoredCode();
		if (storedCode) {
			fillFrom(0, storedCode);
			const firstEmptyIndex = codeChars.findIndex((char) => char.length === 0);
			focusInput(firstEmptyIndex >= 0 ? firstEmptyIndex : CODE_LENGTH - 1);
			return;
		}
		focusInput(0);
	});

	$effect(() => {
		void joinedCode;
		writeStoredCode(joinedCode);
		codeError = '';
	});
</script>

{#if isAppNewClubFlow}
	<PageHeaderTitle title={$_('onboarding.joinClub.title')} />
{/if}

<FlowShell step={1} total={5} showSideIllustration={true} appFrame={isAppNewClubFlow}>
	{#snippet headerSupplement()}
		<div class="flex items-center justify-between gap-4">
			<a
				href={backPath}
				class="inline-flex w-fit items-center text-gray-500 transition-colors duration-200 hover:text-gray-700"
				aria-label={$_('common.goBack')}
			>
				<ChevronLeftIcon class="size-7" />
			</a>
		</div>
	{/snippet}
	<div class={contentClass}>
		<section class="flex flex-col gap-6">
			<div class="flex flex-col gap-2">
				{#if !isAppNewClubFlow}
					<h1 class="type-step-title text-gray-900">{$_('onboarding.joinClub.title')}</h1>
				{/if}
				<p class="text-base leading-7 text-gray-600">{$_('onboarding.joinClub.description')}</p>
			</div>

			<div class="grid w-full grid-cols-6 gap-1.5 sm:gap-2.5">
				{#each codeChars as char, index (index)}
					<input
						bind:this={inputRefs[index]}
						inputmode="text"
						autocapitalize="characters"
						autocomplete={index === 0 ? 'one-time-code' : 'off'}
						maxlength={6}
						value={char}
						oninput={(event) => handleInput(index, event)}
						onkeydown={(event) => handleKeyDown(index, event)}
						onpaste={(event) => handlePaste(index, event)}
						class={`h-12 w-full min-w-0 rounded-md border bg-white px-0 text-center text-lg font-semibold text-gray-900 transition-[border-color,box-shadow] duration-200 outline-none sm:h-14 sm:text-xl ${char ? 'border-orange-500' : 'border-gray-300'} focus:border-orange-500 focus:ring-2 focus:ring-orange-200`}
					/>
				{/each}
			</div>

			<div
				class="relative z-20 flex flex-wrap items-center gap-x-2 gap-y-1 text-base leading-7 text-gray-600"
			>
				<span>{$_('onboarding.joinClub.noCode')}</span>
				<button
					type="button"
					class="pointer-events-auto inline-flex cursor-pointer items-center font-bold text-orange-500 transition-colors duration-200 hover:text-orange-600"
					onclick={() => void viewPublicClubs()}
				>
					{$_('onboarding.joinClub.publicClubs')}
				</button>
			</div>
		</section>

		{#if codeError}
			<p class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
				{codeError}
			</p>
		{/if}

		<div
			class={isAppNewClubFlow
				? 'flex max-w-[28.75rem] flex-col gap-3'
				: 'mt-auto flex flex-col gap-3 pb-2 sm:pb-6'}
		>
			<Button
				variant="default"
				size="xl"
				class="h-14 w-full min-w-0 rounded-md px-4 text-center whitespace-normal"
				disabled={!canContinue || validatingCode}
				onclick={() => void continueToPreview()}
			>
				{validatingCode ? $_('onboarding.joinClub.checking') : $_('onboarding.joinClub.continue')}
			</Button>
		</div>
	</div>
</FlowShell>
