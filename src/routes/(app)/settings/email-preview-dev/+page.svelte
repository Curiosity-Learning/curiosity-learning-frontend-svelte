<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { PageHeaderBackButton, PageHeaderTitle } from '$lib/components/app';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import * as Tabs from '$lib/components/ui/tabs';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let selectedId = $state(page.url.searchParams.get('template') ?? '');
	let selectedPreview = $derived(
		data.previews.find((preview) => preview.id === selectedId) ?? data.previews[0]
	);

	const selectPreview = async (id: string) => {
		selectedId = id;
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.set('template', id);
		await goto(`${page.url.pathname}?${params.toString()}`, {
			keepFocus: true,
			noScroll: true,
			replaceState: true
		});
	};
</script>

<PageHeaderBackButton fallbackHref="/settings" />
<PageHeaderTitle title="Email previews" />

<div class="flex flex-col gap-5">
	<div class="flex flex-col gap-2">
		<div class="flex flex-wrap items-center gap-2">
			<h1 class="text-2xl font-bold text-gray-900">Transactional email previews</h1>
			<Badge variant="outline">Dev</Badge>
		</div>
		<p class="max-w-3xl text-sm leading-6 text-muted-foreground">
			Preview the source-controlled email templates used by Better Auth and parent consent.
			These previews render local HTML only; they do not send email.
		</p>
	</div>

	<div class="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
		<Card class="h-fit">
			<CardHeader>
				<CardTitle>Templates</CardTitle>
				<CardDescription>Select a template to inspect.</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-2">
				{#each data.previews as preview (preview.id)}
					<Button
						variant={preview.id === selectedPreview.id ? 'default' : 'outline'}
						class="h-auto justify-start whitespace-normal px-3 py-2 text-left"
						onclick={() => void selectPreview(preview.id)}
					>
						<span class="flex flex-col gap-1">
							<span class="font-semibold">{preview.label}</span>
							<span class="text-xs opacity-80">{preview.subject}</span>
						</span>
					</Button>
				{/each}
			</CardContent>
		</Card>

		<Card>
			<CardHeader class="gap-2">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div class="flex flex-col gap-1">
						<CardTitle>{selectedPreview.label}</CardTitle>
						<CardDescription>{selectedPreview.description}</CardDescription>
					</div>
					<Badge>{selectedPreview.subject}</Badge>
				</div>
			</CardHeader>
			<CardContent>
				<Tabs.Root value="html" class="flex flex-col gap-4">
					<Tabs.List>
						<Tabs.Trigger value="html">HTML</Tabs.Trigger>
						<Tabs.Trigger value="text">Text</Tabs.Trigger>
						<Tabs.Trigger value="source">Source</Tabs.Trigger>
					</Tabs.List>
					<Tabs.Content value="html">
						<div class="overflow-hidden rounded-md border border-border bg-white">
							<iframe
								title={`${selectedPreview.label} HTML preview`}
								srcdoc={selectedPreview.html}
								class="h-[44rem] w-full bg-white"
							></iframe>
						</div>
					</Tabs.Content>
					<Tabs.Content value="text">
						<pre class="overflow-auto rounded-md border border-border bg-muted p-4 text-sm leading-6 whitespace-pre-wrap">{selectedPreview.text}</pre>
					</Tabs.Content>
					<Tabs.Content value="source">
						<pre class="max-h-[44rem] overflow-auto rounded-md border border-border bg-muted p-4 text-xs leading-5 whitespace-pre-wrap">{selectedPreview.html}</pre>
					</Tabs.Content>
				</Tabs.Root>
			</CardContent>
		</Card>
	</div>
</div>
