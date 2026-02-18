<script lang="ts">
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import {
		canMutateOnline as canMutateOnlineStore,
		connectivityMessage as connectivityMessageStore
	} from '$lib/app/connectivity';
	import { fromStore } from 'svelte/store';

	const canMutateOnlineState = fromStore(canMutateOnlineStore);
	const connectivityMessageState = fromStore(connectivityMessageStore);

	let canMutateOnline = $derived(canMutateOnlineState.current);
	let connectivityMessage = $derived(connectivityMessageState.current);
</script>

{#if !canMutateOnline}
	<div class="pointer-events-none fixed inset-x-0 top-3 z-40 flex justify-center px-4">
		<div class="pointer-events-auto w-full max-w-xl rounded-lg border border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur">
			<div class="flex items-center gap-2">
				<Loader2Icon class="size-4 animate-spin text-primary" />
				<p class="type-body-medium">Trying to reconnect…</p>
			</div>
			<p class="pl-6 type-sm text-muted-foreground">{connectivityMessage}</p>
		</div>
	</div>
{/if}
