<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { t } from '$lib/i18n';

	type Props = {
		open: boolean;
		title: string;
		description?: string;
		confirmLabel: string;
		cancelLabel?: string;
		variant?: 'default' | 'destructive';
		onConfirm: () => void | Promise<void>;
	};

	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel,
		cancelLabel,
		variant = 'default',
		onConfirm
	}: Props = $props();

	let pending = $state(false);

	const handleConfirm = async () => {
		if (pending) return;
		pending = true;
		try {
			await onConfirm();
		} finally {
			pending = false;
			open = false;
		}
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			{#if description}
				<Dialog.Description>{description}</Dialog.Description>
			{/if}
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" disabled={pending} onclick={() => (open = false)}>
				{cancelLabel ?? t('common.cancel')}
			</Button>
			<Button
				variant={variant === 'destructive' ? 'destructive' : 'default'}
				disabled={pending}
				onclick={() => void handleConfirm()}
			>
				{confirmLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
