import { v } from 'convex/values';
import { internalMutation } from './_generated/server';

export const clubRoleKeyValidator = v.union(v.literal('guide'), v.literal('learner'));
export type ClubRoleKey = 'guide' | 'learner';

export const projectRoleKeyValidator = v.union(v.literal('creator'), v.literal('contributor'));
export type ProjectRoleKey = 'creator' | 'contributor';

export const legacyClubRoleName: Record<ClubRoleKey, string> = {
	guide: 'Guide',
	learner: 'Learner'
};

export const legacyProjectRoleName: Record<ProjectRoleKey, string> = {
	creator: 'Creator',
	contributor: 'Contributor'
};

export const backfillStableKeys = internalMutation({
	args: {},
	returns: v.object({
		clubRolesUpdated: v.number(),
		projectRolesUpdated: v.number()
	}),
	handler: async (ctx) => {
		let clubRolesUpdated = 0;
		for (const [key, name] of Object.entries(legacyClubRoleName) as Array<[ClubRoleKey, string]>) {
			const role = await ctx.db
				.query('clubRoles')
				.withIndex('by_name', (q) => q.eq('name', name))
				.unique();
			if (role && !role.key) {
				await ctx.db.patch(role._id, { key });
				clubRolesUpdated += 1;
			}
		}

		let projectRolesUpdated = 0;
		for (const [key, name] of Object.entries(legacyProjectRoleName) as Array<
			[ProjectRoleKey, string]
		>) {
			const role = await ctx.db
				.query('projectRoles')
				.withIndex('by_name', (q) => q.eq('name', name))
				.unique();
			if (role && !role.key) {
				await ctx.db.patch(role._id, { key });
				projectRolesUpdated += 1;
			}
		}

		return { clubRolesUpdated, projectRolesUpdated };
	}
});
