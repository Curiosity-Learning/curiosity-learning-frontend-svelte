import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { getProjectRoleByKey, getRelatedProfile, requireIdentity, requireProfile } from './permissions';
import { ensureProjectRoom } from './chatModel';
import { dispatchNotification } from './notificationsModel';
import {
	applyAttributionOverlapOnJoin,
	canViewProject,
	insertProjectChangeLog
} from './projectsModel';

const memberDisplayName = (member: {
	firstName?: string | null;
	lastName?: string | null;
	username?: string | null;
}) => [member.firstName ?? '', member.lastName ?? ''].join(' ').trim() || member.username || 'A member';

/**
 * PRD 6.6.10: any user who CAN VIEW a project (per `canViewProject` — visibility-gated) and
 * isn't already an active member can request to join. No chat is created for this (CL-722
 * deliberately simplifies the PRD's `join_request` chat type, which stays club-scoped only).
 */
export const requestToJoin = mutation({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const project = await ctx.db.get(args.projectId);
		if (!project) {
			throw new ConvexError('Project not found');
		}
		if (project.archivedAt) {
			throw new ConvexError('Archived projects cannot accept join requests');
		}

		const canView = await canViewProject(ctx, args.projectId, identity.subject);
		if (!canView) {
			throw new ConvexError('Permission denied');
		}

		const existingMemberships = await ctx.db
			.query('projectMembers')
			.withIndex('by_project_and_profile', (q) =>
				q.eq('projectId', args.projectId).eq('profileId', profile._id)
			)
			.collect();
		if (existingMemberships.some((membership) => !membership.leftAt)) {
			throw new ConvexError('You are already a project member');
		}

		const existingRequests = await ctx.db
			.query('projectJoinRequests')
			.withIndex('by_project_and_requester', (q) =>
				q.eq('projectId', args.projectId).eq('requesterProfileId', profile._id)
			)
			.collect();
		if (existingRequests.some((request) => request.status === 'pending')) {
			throw new ConvexError('You already have a pending request to join this project');
		}

		const now = Date.now();
		const requestId = await ctx.db.insert('projectJoinRequests', {
			projectId: args.projectId,
			requesterProfileId: profile._id,
			status: 'pending',
			createdAt: now
		});

		const requesterName = memberDisplayName(profile);
		const activeMemberships = await ctx.db
			.query('projectMembers')
			.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
			.collect();
		for (const membership of activeMemberships) {
			if (membership.leftAt || membership.doneDate) continue;
			await dispatchNotification(ctx, {
				recipientProfileId: membership.profileId,
				kind: 'project_join_request',
				title: 'New join request',
				message: `${requesterName} requested to join "${project.name}".`,
				url: `/project/${args.projectId}`
			});
		}

		return await ctx.db.get(requestId);
	}
});

/** The current viewer's own join request for this project (any status). */
export const getMyRequestForProject = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const requests = await ctx.db
			.query('projectJoinRequests')
			.withIndex('by_project_and_requester', (q) =>
				q.eq('projectId', args.projectId).eq('requesterProfileId', profile._id)
			)
			.order('desc')
			.collect();

		return requests[0] ?? null;
	}
});

/** Pending join requests for a project, visible to any current active project member. */
export const listPendingRequests = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const viewerMemberships = await ctx.db
			.query('projectMembers')
			.withIndex('by_project_and_profile', (q) =>
				q.eq('projectId', args.projectId).eq('profileId', profile._id)
			)
			.collect();
		const viewerIsActive = viewerMemberships.some(
			(membership) => !membership.leftAt && !membership.doneDate
		);
		if (!viewerIsActive) {
			return [];
		}

		const requests = await ctx.db
			.query('projectJoinRequests')
			.withIndex('by_project_and_status', (q) =>
				q.eq('projectId', args.projectId).eq('status', 'pending')
			)
			.collect();

		const result = [];
		for (const request of requests) {
			const requester = await getRelatedProfile(ctx, request.requesterProfileId);
			if (!requester) continue;
			result.push({
				requestId: request._id,
				requesterProfileId: request.requesterProfileId,
				requesterName: memberDisplayName(requester),
				requesterUsername: requester.username ?? null,
				createdAt: request.createdAt
			});
		}
		return result;
	}
});

export const cancelRequest = mutation({
	args: {
		requestId: v.id('projectJoinRequests')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const request = await ctx.db.get(args.requestId);
		if (!request) {
			throw new ConvexError('Join request not found');
		}
		if (request.requesterProfileId !== profile._id) {
			throw new ConvexError('You can only cancel your own request');
		}
		if (request.status !== 'pending') {
			throw new ConvexError('This request has already been decided');
		}

		await ctx.db.patch(args.requestId, {
			status: 'cancelled',
			decidedAt: Date.now()
		});

		return { success: true };
	}
});

/**
 * PRD 6.6.10: any ACTIVE project member can accept a join request. Applies the CL-722
 * attribution-overlap default and writes "X joined the project" per PRD wording (distinct from
 * the invite path's "X was invited by Y").
 */
export const acceptRequest = mutation({
	args: {
		requestId: v.id('projectJoinRequests')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const deciderProfile = await requireProfile(ctx, identity.subject);

		const request = await ctx.db.get(args.requestId);
		if (!request) {
			throw new ConvexError('Join request not found');
		}
		if (request.status !== 'pending') {
			throw new ConvexError('This request has already been decided');
		}

		const deciderMemberships = await ctx.db
			.query('projectMembers')
			.withIndex('by_project_and_profile', (q) =>
				q.eq('projectId', request.projectId).eq('profileId', deciderProfile._id)
			)
			.collect();
		const deciderIsActive = deciderMemberships.some(
			(membership) => !membership.leftAt && !membership.doneDate
		);
		if (!deciderIsActive) {
			throw new ConvexError('Permission denied');
		}

		const project = await ctx.db.get(request.projectId);
		if (!project) {
			throw new ConvexError('Project not found');
		}
		if (project.archivedAt) {
			throw new ConvexError('Archived projects cannot accept new members');
		}

		const requesterProfile = await ctx.db.get(request.requesterProfileId);
		if (!requesterProfile) {
			throw new ConvexError('Requester profile not found');
		}

		const existingMemberships = await ctx.db
			.query('projectMembers')
			.withIndex('by_project_and_profile', (q) =>
				q.eq('projectId', request.projectId).eq('profileId', requesterProfile._id)
			)
			.collect();
		const activeMembership = existingMemberships.find((membership) => !membership.leftAt);
		if (activeMembership) {
			throw new ConvexError('User is already a project member');
		}
		const historicalMembership = existingMemberships.find((membership) => membership.leftAt);

		const contributorRole = await getProjectRoleByKey(ctx, 'contributor');
		if (!contributorRole) {
			throw new ConvexError('Default role Contributor is not configured');
		}

		await ensureProjectRoom(ctx, request.projectId);

		if (historicalMembership) {
			await ctx.db.patch(historicalMembership._id, {
				profileId: requesterProfile._id,
				leftAt: undefined,
				doneDate: undefined,
				roleId: contributorRole._id,
				firstName: requesterProfile.firstName,
				lastName: requesterProfile.lastName,
				username: requesterProfile.username,
				coverPhotoUrl: requesterProfile.coverPhotoUrl
			});
		} else {
			await ctx.db.insert('projectMembers', {
				projectId: request.projectId,
				profileId: requesterProfile._id,
				roleId: contributorRole._id,
				firstName: requesterProfile.firstName,
				lastName: requesterProfile.lastName,
				username: requesterProfile.username,
				coverPhotoUrl: requesterProfile.coverPhotoUrl,
				createdAt: Date.now()
			});
		}

		await insertProjectChangeLog(ctx, {
			projectId: request.projectId,
			actorProfileId: requesterProfile._id,
			entryType: 'member_joined',
			text: `${memberDisplayName(requesterProfile)} joined the project`
		});

		// CL-721/6.6.2 smart default: auto-attribute the unambiguous club overlap.
		await applyAttributionOverlapOnJoin(ctx, request.projectId, requesterProfile._id);

		await ctx.db.patch(args.requestId, {
			status: 'accepted',
			decidedAt: Date.now()
		});

		await dispatchNotification(ctx, {
			recipientProfileId: requesterProfile._id,
			kind: 'project_join_request_decision',
			title: 'Join request accepted',
			message: `Your request to join "${project.name}" was accepted. Welcome!`,
			url: `/project/${request.projectId}`
		});

		return { success: true };
	}
});

export const declineRequest = mutation({
	args: {
		requestId: v.id('projectJoinRequests')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const deciderProfile = await requireProfile(ctx, identity.subject);

		const request = await ctx.db.get(args.requestId);
		if (!request) {
			throw new ConvexError('Join request not found');
		}
		if (request.status !== 'pending') {
			throw new ConvexError('This request has already been decided');
		}

		const deciderMemberships = await ctx.db
			.query('projectMembers')
			.withIndex('by_project_and_profile', (q) =>
				q.eq('projectId', request.projectId).eq('profileId', deciderProfile._id)
			)
			.collect();
		const deciderIsActive = deciderMemberships.some(
			(membership) => !membership.leftAt && !membership.doneDate
		);
		if (!deciderIsActive) {
			throw new ConvexError('Permission denied');
		}

		const project = await ctx.db.get(request.projectId);
		await ctx.db.patch(args.requestId, {
			status: 'declined',
			decidedAt: Date.now()
		});

		await dispatchNotification(ctx, {
			recipientProfileId: request.requesterProfileId,
			kind: 'project_join_request_decision',
			title: 'Join request declined',
			message: `Your request to join "${project?.name ?? 'the project'}" was declined.`
		});

		return { success: true };
	}
});
