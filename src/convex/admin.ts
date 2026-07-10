import { query } from './_generated/server';
import { requireGlobalAdmin } from './permissions';

// CL-693: minimal Overview stub for the /admin route group. The real dashboard is CL-732 — this
// is deliberately just a few trivial counts, but it is the template every future admin
// query/mutation should copy: requireGlobalAdmin first, no route-gating-only reliance.
export const getOverviewCounts = query({
	args: {},
	handler: async (ctx) => {
		await requireGlobalAdmin(ctx);

		const [clubs, profiles, openReports] = await Promise.all([
			ctx.db.query('clubs').collect(),
			ctx.db.query('profiles').collect(),
			ctx.db
				.query('reports')
				.withIndex('by_status_and_created', (q) => q.eq('status', 'open'))
				.collect()
		]);

		return {
			clubCount: clubs.length,
			profileCount: profiles.length,
			openReportCount: openReports.length
		};
	}
});
