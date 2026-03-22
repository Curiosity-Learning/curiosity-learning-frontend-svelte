<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import { Button } from '$lib/components/ui/button';
	import FlowShell from '$lib/components/app/onboarding/flow-shell.svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '$convex/_generated/api';

	const CODE_LENGTH = 6;
	const convexClient = useConvexClient();

	let codeChars = $state<string[]>(Array.from({ length: CODE_LENGTH }, () => ''));
	let inputRefs: Array<HTMLInputElement | null> = Array.from({ length: CODE_LENGTH }, () => null);
	let validatingCode = $state(false);
	let codeError = $state('');

	let canContinue = $derived(codeChars.every((char) => char.length === 1));
	let joinedCode = $derived(codeChars.join(''));

	const normalizeCode = (value: string) => value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

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
			const preview = await convexClient.query(api.clubs.getClubPreviewByCode, { code: joinedCode });
			if (!preview) {
				codeError = 'No club found for this code. Please check and try again.';
				return;
			}
			await goto(`/onboarding/join-club/${joinedCode}`);
		} catch {
			codeError = 'Unable to validate this code right now. Please try again.';
		} finally {
			validatingCode = false;
		}
	};

	onMount(() => {
		focusInput(0);
	});

	$effect(() => {
		joinedCode;
		codeError = '';
	});
</script>

<FlowShell step={1} total={5} showSideIllustration={true}>
	<div class="mx-auto flex w-full min-w-0 max-w-[28.75rem] flex-1 flex-col gap-8 overflow-x-hidden">
		<section class="flex flex-col gap-6">
			<a
				href="/onboarding/get-started"
				class="inline-flex w-fit items-center text-gray-500 transition-colors duration-200 hover:text-gray-700"
				aria-label="Go back"
			>
				<ChevronLeftIcon class="size-7" />
			</a>

			<div class="flex flex-col gap-2">
				<h1 class="type-step-title text-gray-900">Join a club</h1>
				<p class="text-base leading-7 text-gray-600">Please enter a club code to join:</p>
			</div>

			<div class="grid w-full grid-cols-6 gap-1.5 sm:gap-2.5">
				{#each codeChars as char, index}
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
						class={`h-12 min-w-0 w-full rounded-md border bg-white px-0 text-center text-lg font-semibold text-gray-900 outline-none transition-[border-color,box-shadow] duration-200 sm:h-14 sm:text-xl ${char ? 'border-orange-500' : 'border-gray-300'} focus:border-orange-500 focus:ring-2 focus:ring-orange-200`}
					/>
				{/each}
			</div>

			<p class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base leading-7 text-gray-600">
				<span>Don’t have a code?</span>
				<button type="button" class="min-w-0 text-left font-bold text-orange-500">
					View public clubs near you.
				</button>
			</p>
		</section>

		{#if codeError}
			<p class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{codeError}</p>
		{/if}

		<div class="mt-auto flex flex-col gap-3 pb-2 sm:pb-6">
			<Button
				variant="default"
				size="xl"
				class="h-14 w-full min-w-0 rounded-md px-4 text-center whitespace-normal"
				disabled={!canContinue || validatingCode}
				onclick={() => void continueToPreview()}
			>
				{validatingCode ? 'Checking...' : 'Continue'}
			</Button>
		</div>
	</div>
</FlowShell>
