<script lang="ts">
	import { cn } from '$lib/utils.js';

	type Props = {
		minColumnWidth?: string;
		maxColumns?: number;
		gap?: string;
		children?: import('svelte').Snippet;
		class?: string;
	};

	let {
		minColumnWidth = '17rem',
		maxColumns,
		gap = '0.75rem',
		children,
		class: className
	}: Props = $props();

	let hasMaxColumns = $derived(Boolean(maxColumns && maxColumns > 0));

	let gridClass = $derived(
		cn(
			'grid w-full [gap:var(--card-grid-gap)] [grid-template-columns:repeat(auto-fit,minmax(var(--card-grid-min-column),1fr))]',
			hasMaxColumns && 'mx-auto',
			className
		)
	);
	let gridStyle = $derived.by(() => {
		const tokens = [`--card-grid-min-column:min(100%,${minColumnWidth})`, `--card-grid-gap:${gap}`];
		if (hasMaxColumns && maxColumns) {
			tokens.push(`--card-grid-max-columns:${maxColumns}`);
			tokens.push(
				'max-inline-size:calc(var(--card-grid-max-columns)*var(--card-grid-min-column)+(var(--card-grid-max-columns)-1)*var(--card-grid-gap))'
			);
		}
		return `${tokens.join(';')};`;
	});
</script>

<div class={gridClass} style={gridStyle}>
	{@render children?.()}
</div>
