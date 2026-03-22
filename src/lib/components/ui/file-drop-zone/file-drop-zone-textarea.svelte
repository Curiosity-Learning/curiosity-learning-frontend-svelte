<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { useFileDropZoneTextarea } from './file-drop-zone.svelte.js';
	import { box, mergeProps } from 'svelte-toolbelt';
	import type { WithChild } from 'bits-ui';

	type Props = HTMLAttributes<HTMLTextAreaElement>;

	let { onpaste, ondragenter, ondragover, ondragleave, ondrop, child, ...rest }: WithChild & Props =
		$props();

	const fileDropZoneTextareaState = useFileDropZoneTextarea({
		ondragenter: box.with(() => ondragenter),
		onpaste: box.with(() => onpaste),
		ondragover: box.with(() => ondragover),
		ondragleave: box.with(() => ondragleave),
		ondrop: box.with(() => ondrop)
	});

	const mergedProps = $derived(mergeProps(fileDropZoneTextareaState.props, rest));
</script>

{#if child}
	{@render child({ props: mergedProps })}
{:else}
	<textarea {...mergedProps}></textarea>
{/if}
