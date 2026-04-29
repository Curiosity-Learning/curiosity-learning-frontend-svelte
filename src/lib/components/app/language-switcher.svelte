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

	type Props = {
		class?: string;
	};

	const languageOptions: Array<{
		value: SupportedLocale;
		labelKey: 'settings.language.english' | 'settings.language.dutch';
	}> = [
		{ value: 'en', labelKey: 'settings.language.english' }
	];

	let { class: className = '' }: Props = $props();
</script>

<div class={className}>
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
				<DropdownMenuItem class="justify-between gap-3 py-2" onSelect={() => setAppLocale(option.value)}>
					<span>{$_(option.labelKey)}</span>
					{#if $locale === option.value}
						<CheckIcon class="size-4 text-orange-500" />
					{/if}
				</DropdownMenuItem>
			{/each}
		</DropdownMenuContent>
	</DropdownMenu>
</div>
