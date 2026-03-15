<script lang="ts">
	import LegalDocumentScreen from '$lib/components/app/legal/legal-document-screen.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<LegalDocumentScreen
	title={data.document?.fullName ?? 'Cookie Policy'}
	content={data.document?.content ?? null}
	updatedAt={data.document?.updatedAt ?? null}
	emptyMessage="No cookie policy content is configured yet."
/>
