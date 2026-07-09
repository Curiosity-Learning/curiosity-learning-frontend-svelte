import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';

export const ensureClubRoom = async (ctx: MutationCtx, clubId: Id<'clubs'>) => {
	const existing = await ctx.db
		.query('rooms')
		.withIndex('by_club_id', (q) => q.eq('clubId', clubId))
		.first();
	if (existing) {
		return existing._id;
	}

	return await ctx.db.insert('rooms', {
		contextType: 'club',
		clubId
	});
};

export const ensureProjectRoom = async (ctx: MutationCtx, projectId: Id<'projects'>) => {
	const existing = await ctx.db
		.query('rooms')
		.withIndex('by_project_id', (q) => q.eq('projectId', projectId))
		.first();
	if (existing) {
		return existing._id;
	}

	return await ctx.db.insert('rooms', {
		contextType: 'project',
		projectId
	});
};

export const ensureClubApplicationRoom = async (
	ctx: MutationCtx,
	clubApplicationId: Id<'clubApplications'>
) => {
	const existing = await ctx.db
		.query('rooms')
		.withIndex('by_club_application_id', (q) => q.eq('clubApplicationId', clubApplicationId))
		.first();
	if (existing) {
		return existing._id;
	}

	return await ctx.db.insert('rooms', {
		contextType: 'clubApplication',
		clubApplicationId
	});
};

export const ensureJoinRequestRoom = async (
	ctx: MutationCtx,
	joinRequestId: Id<'joinRequests'>
) => {
	const existing = await ctx.db
		.query('rooms')
		.withIndex('by_join_request_id', (q) => q.eq('joinRequestId', joinRequestId))
		.first();
	if (existing) {
		return existing._id;
	}

	return await ctx.db.insert('rooms', {
		contextType: 'joinRequest',
		joinRequestId
	});
};
