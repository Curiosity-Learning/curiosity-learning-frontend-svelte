import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import {
	getProjectRoleByKey,
	getRelatedProfile,
	isProjectPermissionAllowed,
	requireIdentity,
	requireProfile
} from './permissions';
import { ensureProjectRoom } from './chatModel';
import { dispatchNotification } from './notificationsModel';
import { applyAttributionOverlapOnJoin, assertNotDoneMember, insertProjectChangeLog } from './projectsModel';

const memberDisplayName = (member: {
	firstName?: string | null;
	lastName?: string | null;
	username?: string | null;
}) => [member.firstName ?? '', member.lastName ?? ''].join(' ').trim() || member.username || 'A member';

/**
 * PRD 6.6.10: any ACTIVE project member can invite any user on the platform. Guarded by the
 * same `project:update` permission as `projects.addMember` (active membership or a club-level
 * permission holder) — an invite is, at its core, a deferred `addMember`. One pending invite per
 * (projectId, inviteeProfileId) at a time; re-inviting after a decline/cancel is allowed (the
 * old row stays as historical record, a fresh row is inserted).
 */
export const inviteMember = mutation({
	args: {
		projectId: v.id('projects'),
		inviteeProfileId: v.id('profiles')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const canInvite = await isProjectPermissionAllowed(
			ctx,
			args.projectId,
			identity.subject,
			'project:update'
		);
		if (!canInvite) {
			throw new ConvexError('Permission denied');
		}
		// PRD 6.6.4/ticket: Done members cannot invite. `isProjectPermissionAllowed` alone doesn't
		// check doneDate (it also allows club-role holders who aren't project members at all), so
		// this explicit guard is needed on top, same as `projects.update`'s use of the helper.
		await assertNotDoneMember(ctx, args.projectId, identity.subject);

		const project = await ctx.db.get(args.projectId);
		if (!project) {
			throw new ConvexError('Project not found');
		}
		if (project.archivedAt) {
			throw new ConvexError('Archived projects cannot invite new members');
		}

		const inviterProfile = await requireProfile(ctx, identity.subject);
		const invitee = await ctx.db.get(args.inviteeProfileId);
		if (!invitee) {
			throw new ConvexError('User not found');
		}

		const existingMemberships = await ctx.db
			.query('projectMembers')
			.withIndex('by_project_and_profile', (q) =>
				q.eq('projectId', args.projectId).eq('profileId', args.inviteeProfileId)
			)
			.collect();
		if (existingMemberships.some((membership) => !membership.leftAt)) {
			throw new ConvexError('User is already a project member');
		}

		const existingInvites = await ctx.db
			.query('projectInvites')
			.withIndex('by_project_and_invitee', (q) =>
				q.eq('projectId', args.projectId).eq('inviteeProfileId', args.inviteeProfileId)
			)
			.collect();
		if (existingInvites.some((invite) => invite.status === 'pending')) {
			throw new ConvexError('This user already has a pending invite to this project');
		}

		const now = Date.now();
		const inviteId = await ctx.db.insert('projectInvites', {
			projectId: args.projectId,
			inviteeProfileId: args.inviteeProfileId,
			invitedByProfileId: inviterProfile._id,
			status: 'pending',
			createdAt: now
		});

		const inviterName = memberDisplayName(inviterProfile);
		await dispatchNotification(ctx, {
			recipientProfileId: args.inviteeProfileId,
			kind: 'project_invite',
			title: 'Project invitation',
			message: `${inviterName} invited you to join "${project.name}".`,
			url: `/project/${args.projectId}`
		});

		return await ctx.db.get(inviteId);
	}
});

/**
 * Pending invites for a project, visible to any current active project member (same bar as
 * inviting) so the "pending invites" list can show cancel controls.
 */
export const listPendingInvites = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const canView = await isProjectPermissionAllowed(
			ctx,
			args.projectId,
			identity.subject,
			'project:update'
		);
		if (!canView) {
			return [];
		}

		const invites = await ctx.db
			.query('projectInvites')
			.withIndex('by_project_and_status', (q) =>
				q.eq('projectId', args.projectId).eq('status', 'pending')
			)
			.collect();

		const result = [];
		for (const invite of invites) {
			const invitee = await getRelatedProfile(ctx, invite.inviteeProfileId);
			if (!invitee) continue;
			result.push({
				inviteId: invite._id,
				inviteeProfileId: invite.inviteeProfileId,
				inviteeName: memberDisplayName(invitee),
				inviteeUsername: invitee.username ?? null,
				createdAt: invite.createdAt
			});
		}
		return result;
	}
});

/**
 * The current viewer's own invite to this project (any status), so the project page can render
 * the invite Accept/Decline banner. Returns null if the viewer has no invite at all.
 */
export const getMyInviteForProject = query({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const invites = await ctx.db
			.query('projectInvites')
			.withIndex('by_project_and_invitee', (q) =>
				q.eq('projectId', args.projectId).eq('inviteeProfileId', profile._id)
			)
			.order('desc')
			.collect();

		const invite = invites[0] ?? null;
		if (!invite) return null;

		const inviter = await getRelatedProfile(ctx, invite.invitedByProfileId);
		return {
			...invite,
			inviterName: inviter ? memberDisplayName(inviter) : 'A member'
		};
	}
});

/**
 * PRD 6.6.10: on Accept the invitee is added as an Active member. This intentionally does NOT
 * reuse `projects.addMember` directly (that mutation is gated by `project:update`, which the
 * invitee themself typically does not hold) — it's a self-executed accept, explicitly bypassing
 * the manager gate because the invite row itself is the authorization. Applies the CL-722
 * attribution-overlap default and writes the "X was invited by Y" change-log entry per PRD.
 */
export const acceptInvite = mutation({
	args: {
		inviteId: v.id('projectInvites')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const invite = await ctx.db.get(args.inviteId);
		if (!invite) {
			throw new ConvexError('Invite not found');
		}
		if (invite.inviteeProfileId !== profile._id) {
			throw new ConvexError('This invite is not addressed to you');
		}
		if (invite.status !== 'pending') {
			throw new ConvexError('This invite has already been decided');
		}

		const project = await ctx.db.get(invite.projectId);
		if (!project) {
			throw new ConvexError('Project not found');
		}
		if (project.archivedAt) {
			throw new ConvexError('Archived projects cannot accept new members');
		}

		const existingMemberships = await ctx.db
			.query('projectMembers')
			.withIndex('by_project_and_profile', (q) =>
				q.eq('projectId', invite.projectId).eq('profileId', profile._id)
			)
			.collect();
		const activeMembership = existingMemberships.find((membership) => !membership.leftAt);
		if (activeMembership) {
			throw new ConvexError('You are already a project member');
		}
		const historicalMembership = existingMemberships.find((membership) => membership.leftAt);

		const contributorRole = await getProjectRoleByKey(ctx, 'contributor');
		if (!contributorRole) {
			throw new ConvexError('Default role Contributor is not configured');
		}

		await ensureProjectRoom(ctx, invite.projectId);

		if (historicalMembership) {
			await ctx.db.patch(historicalMembership._id, {
				profileId: profile._id,
				leftAt: undefined,
				doneDate: undefined,
				roleId: contributorRole._id,
				firstName: profile.firstName,
				lastName: profile.lastName,
				username: profile.username,
				coverPhotoUrl: profile.coverPhotoUrl
			});
		} else {
			await ctx.db.insert('projectMembers', {
				projectId: invite.projectId,
				profileId: profile._id,
				roleId: contributorRole._id,
				firstName: profile.firstName,
				lastName: profile.lastName,
				username: profile.username,
				coverPhotoUrl: profile.coverPhotoUrl,
				createdAt: Date.now()
			});
		}

		const inviter = await getRelatedProfile(ctx, invite.invitedByProfileId);
		await insertProjectChangeLog(ctx, {
			projectId: invite.projectId,
			actorProfileId: profile._id,
			entryType: 'member_invited',
			text: `${memberDisplayName(profile)} was invited by ${inviter ? memberDisplayName(inviter) : 'a member'}`
		});

		// CL-721/6.6.2 smart default: auto-attribute the unambiguous club overlap.
		await applyAttributionOverlapOnJoin(ctx, invite.projectId, profile._id);

		await ctx.db.patch(args.inviteId, {
			status: 'accepted',
			decidedAt: Date.now()
		});

		await dispatchNotification(ctx, {
			recipientProfileId: invite.invitedByProfileId,
			kind: 'project_invite_decision',
			title: 'Invite accepted',
			message: `${memberDisplayName(profile)} accepted your invite to "${project.name}".`,
			url: `/project/${invite.projectId}`
		});

		return { success: true };
	}
});

/**
 * PRD 6.6.10: on Decline, the notification is simply dismissed and no membership/change-log
 * record is created — only the invite row's status changes.
 */
export const declineInvite = mutation({
	args: {
		inviteId: v.id('projectInvites')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const invite = await ctx.db.get(args.inviteId);
		if (!invite) {
			throw new ConvexError('Invite not found');
		}
		if (invite.inviteeProfileId !== profile._id) {
			throw new ConvexError('This invite is not addressed to you');
		}
		if (invite.status !== 'pending') {
			throw new ConvexError('This invite has already been decided');
		}

		await ctx.db.patch(args.inviteId, {
			status: 'declined',
			decidedAt: Date.now()
		});

		return { success: true };
	}
});

/**
 * The inviter (or anyone with `project:update` on the project) can cancel a still-pending
 * invite.
 */
export const cancelInvite = mutation({
	args: {
		inviteId: v.id('projectInvites')
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const invite = await ctx.db.get(args.inviteId);
		if (!invite) {
			throw new ConvexError('Invite not found');
		}
		if (invite.status !== 'pending') {
			throw new ConvexError('This invite has already been decided');
		}

		const canCancel = await isProjectPermissionAllowed(
			ctx,
			invite.projectId,
			identity.subject,
			'project:update'
		);
		if (!canCancel) {
			throw new ConvexError('Permission denied');
		}
		await assertNotDoneMember(ctx, invite.projectId, identity.subject);

		await ctx.db.patch(args.inviteId, {
			status: 'cancelled',
			decidedAt: Date.now()
		});

		return { success: true };
	}
});
