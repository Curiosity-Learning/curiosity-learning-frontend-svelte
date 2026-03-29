<script lang="ts">
	import favicon from '$lib/assets/svg/favicon.svg';
</script>

<div class="launcher-screen" role="status" aria-live="polite" aria-label="Launching Curiosity Learning">
	<img src={favicon} alt="Curiosity Learning" class="launcher-icon" />
</div>

<style>
	.launcher-screen {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		background: #ffffff;
	}

	.launcher-icon {
		width: 88px;
		height: 88px;
		animation: launcher-fade 1.2s ease-in-out infinite alternate;
	}

	@keyframes launcher-fade {
		from {
			opacity: 0.35;
		}

		to {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.launcher-icon {
			animation: none;
			opacity: 1;
		}
	}
</style>
