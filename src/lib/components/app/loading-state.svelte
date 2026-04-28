<script lang="ts">
	import favicon from '$lib/assets/svg/favicon.svg';
	import { Spinner } from '$lib/components/ui/spinner';
	import { cn } from '$lib/utils';

	type Props = {
		label?: string;
		variant?: 'page' | 'block' | 'inline';
		size?: 'sm' | 'md' | 'lg';
		class?: string;
	};

	let {
		label = 'Loading',
		variant = 'block',
		size = 'md',
		class: className = ''
	}: Props = $props();

	const variantClasses = {
		page: 'min-h-screen bg-white',
		block: 'min-h-32',
		inline: 'min-h-10 py-2'
	};

	const sizeClasses = {
		sm: 'size-7',
		md: 'size-12',
		lg: 'size-[5.5rem]'
	};

	const inlineSizeClasses = {
		sm: 'size-4',
		md: 'size-5',
		lg: 'size-6'
	};
</script>

{#if variant === 'inline'}
	<div class={cn('flex items-center justify-center', variantClasses.inline, className)}>
		<Spinner ariaLabel={label} class={cn('text-muted-foreground', inlineSizeClasses[size])} />
	</div>
{:else}
	<div
		role="status"
		aria-live="polite"
		aria-label={label}
		class={cn('flex items-center justify-center', variantClasses[variant], className)}
	>
		<img src={favicon} alt="" class={cn('loading-logo', sizeClasses[size])} />
		<span class="sr-only">{label}</span>
	</div>
{/if}

<style>
	.loading-logo {
		animation: logo-pulse 1.8s ease-in-out infinite;
	}

	@keyframes logo-pulse {
		0%,
		100% {
			opacity: 0.38;
			transform: scale(0.96);
		}

		50% {
			opacity: 1;
			transform: scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.loading-logo {
			animation: none;
			opacity: 1;
			transform: none;
		}
	}
</style>
