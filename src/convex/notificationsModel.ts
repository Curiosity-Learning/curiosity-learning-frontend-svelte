import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internal } from './_generated/api';

// Central notification dispatch (CL-715 / PRD 6.13).
//
// Every in-app/email notification flows through `dispatchNotification`, which maps a
// notification `kind` to a tier and a user-preference key:
//
// - critical: always delivered in-app AND by email. Ignores user preferences entirely
//   (these are account-level notices the user must see).
// - high: delivered in-app AND by email, but muteable. Muting suppresses BOTH the email
//   and the in-app row (the simplest honest interpretation of "mute"); the master
//   `notificationsEnabled` switch mutes all non-critical kinds the same way.
// - medium: delivered in-app only (no email), muteable with the same semantics as high.
//
// Child accounts have synthetic `username@children.curiosity.local` auth emails that are
// undeliverable. Emails for CRITICAL kinds are rerouted to the approved parent email from
// `parentChildConsents`; for high kinds no email is sent to child accounts.
export type NotificationKind =
	// critical
	| 'application_status' // club application moved to interview / accepted / rejected
	| 'kicked_from_club'
	| 'parental_consent_request' // classification only; the consent email flow itself lives in childSignup.ts
	// high
	| 'session_reminder' // 24h before session start
	| 'session_cancelled'
	| 'attendance_reminder' // guides: attendance unmarked 1h after start
	| 'join_request_received' // guides: someone requested to join
	| 'join_request_decision' // requester: accepted / declined
	| 'promoted_to_guide'
	| 'project_invite' // invitee: someone invited you to a project (CL-722)
	| 'project_invite_decision' // inviter: your invite was accepted/declined (CL-722)
	| 'project_join_request' // active project members: someone requested to join (CL-722)
	| 'project_join_request_decision' // requester: your join request was accepted/declined (CL-722)
	// medium
	| 'member_joined'; // guides: a new member joined the club
// TODO kinds (no producers exist yet; add here when they land):
// - 'project_update' / 'project_completed' (medium, preference: projectCompleted)
// - chat message emails/digests are OUT OF SCOPE for v1 (deliberate anti-spam decision;
//   PRD 6.13 allows this simplification). The `chatMessages` preference field is reserved.

export type NotificationTier = 'critical' | 'high' | 'medium';

// Preference keys re-use the existing userPreferences.notificationPreferences booleans
// (schema.ts) so no schema migration is needed. Keys not referenced here are reserved
// for future producers (see TODO kinds above).
export type NotificationPreferenceKey =
	| 'clubMemberChanges'
	| 'projectDeadlineReminder'
	| 'projectMemberAdded'
	| 'projectCompleted'
	| 'sessionReminder'
	| 'sessionActivityChanges'
	| 'updateLikes'
	| 'updateComments'
	| 'chatMessages';

type KindConfig = {
	tier: NotificationTier;
	// null for critical kinds: they cannot be muted.
	preferenceKey: NotificationPreferenceKey | null;
};

export const notificationKindConfig: Record<NotificationKind, KindConfig> = {
	application_status: { tier: 'critical', preferenceKey: null },
	kicked_from_club: { tier: 'critical', preferenceKey: null },
	parental_consent_request: { tier: 'critical', preferenceKey: null },
	session_reminder: { tier: 'high', preferenceKey: 'sessionReminder' },
	session_cancelled: { tier: 'high', preferenceKey: 'sessionActivityChanges' },
	attendance_reminder: { tier: 'high', preferenceKey: 'sessionActivityChanges' },
	join_request_received: { tier: 'high', preferenceKey: 'clubMemberChanges' },
	join_request_decision: { tier: 'high', preferenceKey: 'clubMemberChanges' },
	promoted_to_guide: { tier: 'high', preferenceKey: 'clubMemberChanges' },
	project_invite: { tier: 'high', preferenceKey: 'projectMemberAdded' },
	project_invite_decision: { tier: 'high', preferenceKey: 'projectMemberAdded' },
	project_join_request: { tier: 'high', preferenceKey: 'projectMemberAdded' },
	project_join_request_decision: { tier: 'high', preferenceKey: 'projectMemberAdded' },
	member_joined: { tier: 'medium', preferenceKey: 'clubMemberChanges' }
};

const isKindMuted = async (
	ctx: MutationCtx,
	profileId: Id<'profiles'>,
	preferenceKey: NotificationPreferenceKey
) => {
	const preferences = await ctx.db
		.query('userPreferences')
		.withIndex('by_profile', (q) => q.eq('profileId', profileId))
		.unique();
	// No stored preferences means everything defaults to ON.
	if (!preferences) return false;
	if (!preferences.notificationsEnabled) return true;
	return preferences.notificationPreferences[preferenceKey] === false;
};

export type DispatchNotificationArgs = {
	recipientProfileId: Id<'profiles'>;
	kind: NotificationKind;
	title: string;
	message: string;
	url?: string;
	clubId?: Id<'clubs'>;
};

// Creates the in-app notification row and (for critical/high tiers) schedules the email
// delivery. Returns the notification id, or null when the kind was muted by the recipient.
export const dispatchNotification = async (ctx: MutationCtx, args: DispatchNotificationArgs) => {
	const config = notificationKindConfig[args.kind];

	if (config.tier !== 'critical' && config.preferenceKey) {
		if (await isKindMuted(ctx, args.recipientProfileId, config.preferenceKey)) {
			return null;
		}
	}

	const notificationId = await ctx.db.insert('notifications', {
		profileId: args.recipientProfileId,
		clubId: args.clubId,
		title: args.title,
		message: args.message,
		url: args.url,
		isRead: false,
		createdAt: Date.now()
	});

	if (config.tier === 'critical' || config.tier === 'high') {
		await ctx.scheduler.runAfter(0, internal.notifications.sendNotificationEmail, {
			recipientProfileId: args.recipientProfileId,
			critical: config.tier === 'critical',
			title: args.title,
			message: args.message,
			url: args.url
		});
	}

	return notificationId;
};

// Notifies every active Guide of a club (except the new member) that someone joined.
// Shared by the join-by-code flows and accepted join requests.
export const notifyGuidesOfNewMember = async (
	ctx: MutationCtx,
	clubId: Id<'clubs'>,
	newMember: { _id: Id<'profiles'>; firstName?: string; lastName?: string; username?: string }
) => {
	const club = await ctx.db.get(clubId);
	const fullName = [newMember.firstName, newMember.lastName].filter(Boolean).join(' ').trim();
	const memberName = fullName || newMember.username || 'A new member';

	const members = await ctx.db
		.query('clubMembers')
		.withIndex('by_club', (q) => q.eq('clubId', clubId))
		.collect();
	for (const member of members) {
		if (member.leftAt) continue;
		if (member.profileId === newMember._id) continue;
		const role = await ctx.db.get(member.roleId);
		if (role?.key !== 'guide') continue;
		await dispatchNotification(ctx, {
			recipientProfileId: member.profileId,
			kind: 'member_joined',
			clubId,
			title: 'New member joined',
			message: `${memberName} joined ${club?.name ?? 'your club'}.`,
			url: `/club/${clubId}/members`
		});
	}
};
