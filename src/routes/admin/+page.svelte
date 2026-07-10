<script lang="ts">
	import { api } from '$convex/_generated/api';
	import { useStableQuery } from '$lib/convex/use-stable-query.svelte';
	import { t } from '$lib/i18n';

	// CL-693: minimal Overview stub. The real dashboard is CL-732 — this just proves the
	// admin-gated query template (admin.getOverviewCounts) end to end.
	const countsResponse = useStableQuery(api.admin.getOverviewCounts, {});
	let counts = $derived(countsResponse.data ?? null);
</script>

<h1 class="text-xl font-semibold">{t('admin.overviewTitle')}</h1>

<div class="mt-4 grid grid-cols-3 gap-3">
	<div class="rounded border border-neutral-300 bg-white p-4">
		<p class="text-2xl font-semibold">{counts?.clubCount ?? '—'}</p>
		<p class="text-sm text-neutral-500">{t('admin.overviewClubs')}</p>
	</div>
	<div class="rounded border border-neutral-300 bg-white p-4">
		<p class="text-2xl font-semibold">{counts?.profileCount ?? '—'}</p>
		<p class="text-sm text-neutral-500">{t('admin.overviewProfiles')}</p>
	</div>
	<div class="rounded border border-neutral-300 bg-white p-4">
		<p class="text-2xl font-semibold">{counts?.openReportCount ?? '—'}</p>
		<p class="text-sm text-neutral-500">{t('admin.overviewOpenReports')}</p>
	</div>
</div>
