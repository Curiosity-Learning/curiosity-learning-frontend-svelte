import { v } from 'convex/values';
import { internalMutation } from './_generated/server';

export const clubRoleKeyValidator = v.union(v.literal('guide'), v.literal('learner'));
export type ClubRoleKey = 'guide' | 'learner';

export const projectRoleKeyValidator = v.union(v.literal('creator'), v.literal('contributor'));
export type ProjectRoleKey = 'creator' | 'contributor';

// Canonical clubRoles.permissions sets. This is the source of truth for what Guide/Learner
// *should* have — keep in sync with every `hasPermission`/`requirePermission` string checked
// across src/convex (grep for `:` permission literals if adding a new capability). There is no
// seeding path left in the app (the old public `bootstrap.ts` seeder was deleted in 01501f5 —
// "Remove client-triggered default seeding"); clubRoles rows are managed directly in the
// database. That means a brand-new environment (or one that predates a permission addition,
// e.g. CL-709's session:cancel/session_rsvp:*/session_photo:create/club_member:promote/
// club_join_request:decide) has clubRoles rows missing flags that current code already checks
// for, silently breaking every gated action.
//
// DEPLOY STEP (required after every deploy that adds to these lists, including the first
// deploy of this file to a new environment such as prod):
//   npx convex run roles:syncRolePermissions [--prod]
// It is idempotent — adds missing canonical flags to existing rows, never removes custom/extra
// permissions a row already has, and is a no-op if rows are already in sync. Safe to re-run.
//
// `club_member:invite_guide` (CL-714) was removed from this canonical set when guide invite codes
// were ripped out (CEO decision — see clubs.ts history): guides are only ever added by promoting
// an existing Learner (clubs.promoteMember), never by a standalone invite code. Because this sync
// is add-only, any clubRoles row that was already synced with the old flag still has it sitting on
// the row — harmless (nothing checks it anymore) but not worth writing a removal migration for.
const canonicalGuidePermissions = [
	'club:read',
	'club:edit',
	'club_member:read_active',
	'club_member:kick',
	'club_member:promote',
	'club_join_request:decide',
	'session:read',
	'session:create',
	'session:update',
	'session:delete',
	'session:cancel',
	'session_rsvp:set',
	'session_rsvp:read_all',
	'session_photo:create',
	'session_activity:read',
	'session_activity:create',
	'session_activity:update',
	'session_activity:delete',
	'session_activity_building_block:read',
	'session_activity_building_block:create',
	'session_activity_building_block:update',
	'session_activity_building_block:delete',
	'attendance:read',
	'attendance:create',
	'attendance:delete',
	'project:read',
	'project:create',
	'project:update',
	'project:link',
	'project:unlink',
	'updates:read',
	'updates:create',
	'updates:update'
];

const canonicalLearnerPermissions = [
	'club:read',
	'club_member:read_active',
	'session:read',
	'session_rsvp:set',
	'session_activity:read',
	'project:read',
	'attendance:read',
	'updates:read'
];

const mergePermissions = (existing: string[], desired: string[]) => {
	const set = new Set([...existing, ...desired]);
	return Array.from(set);
};

// Idempotent permission sync for existing clubRoles rows (CL-709 follow-up). See DEPLOY STEP
// comment above. Adds any canonical flag a row is missing; never removes flags already present,
// so hand-added/custom permissions on a role survive a sync.
export const syncRolePermissions = internalMutation({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query('clubRoles').collect();
		let updated = 0;
		for (const row of rows) {
			const desired =
				row.key === 'guide' ? canonicalGuidePermissions : canonicalLearnerPermissions;
			const merged = mergePermissions(row.permissions, desired);
			if (merged.length !== row.permissions.length) {
				await ctx.db.patch(row._id, { permissions: merged });
				updated += 1;
			}
		}
		return { rowsChecked: rows.length, rowsUpdated: updated };
	}
});
