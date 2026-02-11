import { mutation } from './_generated/server';

const guidePermissions = [
	'club:read',
	'club:edit',
	'club_member:read_active',
	'club_member:kick',
	'session:read',
	'session:create',
	'session:update',
	'session:delete',
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

const learnerPermissions = [
	'club:read',
	'session:read',
	'project:read',
	'attendance:read',
	'updates:read'
];

const projectCreatorPermissions = [
	'project:read',
	'project:update',
	'project:link',
	'project:unlink'
];
const projectContributorPermissions = ['project:read', 'project:update'];

const mergePermissions = (existing: string[] | undefined, desired: string[]) => {
	const set = new Set([...(existing ?? []), ...desired]);
	return Array.from(set);
};

export const seedDefaults = mutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();

		const guideRole = await ctx.db
			.query('clubRoles')
			.withIndex('by_name', (q) => q.eq('name', 'Guide'))
			.first();
		if (!guideRole) {
			await ctx.db.insert('clubRoles', {
				name: 'Guide',
				description: 'Club guide with management permissions',
				color: '#F97316',
				permissions: guidePermissions,
				order: 10,
				createdAt: now
			});
		} else {
			const merged = mergePermissions(guideRole.permissions, guidePermissions);
			if (merged.length !== guideRole.permissions.length) {
				await ctx.db.patch(guideRole._id, { permissions: merged });
			}
		}

		const learnerRole = await ctx.db
			.query('clubRoles')
			.withIndex('by_name', (q) => q.eq('name', 'Learner'))
			.first();
		if (!learnerRole) {
			await ctx.db.insert('clubRoles', {
				name: 'Learner',
				description: 'Learner with read-only access',
				color: '#2563EB',
				permissions: learnerPermissions,
				order: 100,
				createdAt: now
			});
		} else {
			const merged = mergePermissions(learnerRole.permissions, learnerPermissions);
			if (merged.length !== learnerRole.permissions.length) {
				await ctx.db.patch(learnerRole._id, { permissions: merged });
			}
		}

		const creatorRole = await ctx.db
			.query('projectRoles')
			.withIndex('by_name', (q) => q.eq('name', 'Creator'))
			.first();
		if (!creatorRole) {
			await ctx.db.insert('projectRoles', {
				name: 'Creator',
				permissions: projectCreatorPermissions,
				order: 10,
				createdAt: now
			});
		} else {
			const merged = mergePermissions(creatorRole.permissions, projectCreatorPermissions);
			if (merged.length !== creatorRole.permissions.length) {
				await ctx.db.patch(creatorRole._id, { permissions: merged });
			}
		}

		const contributorRole = await ctx.db
			.query('projectRoles')
			.withIndex('by_name', (q) => q.eq('name', 'Contributor'))
			.first();
		if (!contributorRole) {
			await ctx.db.insert('projectRoles', {
				name: 'Contributor',
				permissions: projectContributorPermissions,
				order: 50,
				createdAt: now
			});
		} else {
			const merged = mergePermissions(contributorRole.permissions, projectContributorPermissions);
			if (merged.length !== contributorRole.permissions.length) {
				await ctx.db.patch(contributorRole._id, { permissions: merged });
			}
		}

		const activePolicy = await ctx.db
			.query('privacyPolicy')
			.withIndex('by_active', (q) => q.eq('isActive', true))
			.first();
		if (!activePolicy) {
			await ctx.db.insert('privacyPolicy', {
				title: 'Privacy Policy',
				content: 'Privacy policy content has not been configured yet.',
				version: '1.0',
				isActive: true,
				createdAt: now,
				updatedAt: now
			});
		}

		const baseBlocks = [
			{
				name: 'Icebreaker',
				slug: 'icebreaker',
				description: 'Opening activity to start the session.'
			},
			{
				name: 'Core Build',
				slug: 'core-build',
				description: 'Main collaborative building activity.'
			},
			{ name: 'Reflection', slug: 'reflection', description: 'Group reflection and close-out.' }
		];

		for (const block of baseBlocks) {
			const existing = await ctx.db
				.query('buildingBlocks')
				.withIndex('by_slug', (q) => q.eq('slug', block.slug))
				.first();
			if (!existing) {
				await ctx.db.insert('buildingBlocks', {
					name: block.name,
					slug: block.slug,
					description: block.description,
					createdAt: now
				});
			}
		}

		return { success: true };
	}
});
