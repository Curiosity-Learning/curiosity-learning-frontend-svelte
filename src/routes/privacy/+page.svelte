<script lang="ts">
	import LegalDocumentScreen from '$lib/components/app/legal/legal-document-screen.svelte';
	import { _ } from '$lib/i18n';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<LegalDocumentScreen
	title={$_('legal.privacyTitle')}
	content={data.document?.content ?? null}
	updatedAt={data.document?.updatedAt ?? null}
	emptyMessage={$_('legal.privacyEmpty')}
/>
