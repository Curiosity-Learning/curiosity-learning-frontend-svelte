import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { getAuthUserEmail } from './authEmail';
import { CHILD_EMAIL_DOMAIN } from './childAccounts';
import { profileDisplayName } from './chatModel';
import type { NotificationTier } from './notificationsModel';

type Ctx = QueryCtx | MutationCtx;

// Who a notification email really goes to (CL-768/CL-769, review S6/D3/D7, edge case 5).
//
// Adult accounts: their own Better Auth email ('self'), subject to their own mutes.
//
// Child accounts have a synthetic @children.curiosity.local auth email that is never emailed.
// Their email can go to two audiences, always as SEPARATE emails (never one email with both on
// to/cc: the parent copy carries a one-time sign-in link):
// - 'self': the child's own `notificationEmail`, only once the child confirmed it
//   (`notificationEmailVerifiedAt`); a pending address counts as no address (review B3);
// - 'parent': the approved parent (`parentChildConsents.parentEmail`).
//
//   kind                         | no confirmed child email | confirmed child email
//   -----------------------------+--------------------------+--------------------------------------
//   critical (account actions,   | parent                   | parent AND child
//   review chats, ...)           |                          |
//   chat_activity (club/project) | parent (mandatory)       | child (child's mute) + parent copy if
//                                |                          |   parentNotificationSettings.chatCopies
//   other high kinds             | nobody                   | child (child's mute) + parent copy if
//                                |                          |   parentNotificationSettings.activityCopies
//   medium                       | in-app only              | in-app only
//
// Rules:
// 1. The child's own mute preferences (`selfMuted`) govern ONLY the 'self' copy. A child can
//    never silence what goes to the parent (review S6/D3); the in-app row stays subject to the
//    child's mute (notificationsModel.dispatchNotification).
// 2. Critical kinds ignore every setting and mute.
// 3. With no confirmed child email, club/project chat goes to the parent whatever the settings
//    say: otherwise nobody would hear about it.
// 4. A parent the child has unlinked (consent `unlinkedAt`, a 16+ child) gets no non-critical
//    email and no copies; critical notices still reach them for now (review S7, step 7 changes
//    this).

export type EmailAudience = 'self' | 'parent';
export type EmailRecipient = { to: string; audience: EmailAudience };
// Plus the child's display name, for parent-facing wording.
export type ResolvedEmailRecipient = EmailRecipient & { childName: string };

export type EmailRoutingArgs = {
	profile: Doc<'profiles'>;
	tier: NotificationTier;
	// Club/project/review chat emails (chat.ts), as opposed to dispatched notifications.
	chat: boolean;
	// The recipient's OWN mute for this kind (notificationsModel.isKindMuted). Ignored for
	// critical kinds; for a child account it only removes the child's own copy.
	selfMuted: boolean;
};

export const isSyntheticChildEmail = (email: string) =>
	email.toLowerCase().endsWith(`@${CHILD_EMAIL_DOMAIN}`);

// The pure matrix above, for a child account.
export const planChildEmailAudiences = (args: {
	tier: NotificationTier;
	chat: boolean;
	childEmailConfirmed: boolean;
	selfMuted: boolean;
	// An approved consent exists (critical notices reach even an unlinked parent, rule 4).
	parentForCritical: boolean;
	// An approved consent the child has not unlinked.
	parentForRest: boolean;
	chatCopies: boolean;
	activityCopies: boolean;
}): EmailAudience[] => {
	if (args.tier === 'critical') {
		const audiences: EmailAudience[] = [];
		if (args.parentForCritical) audiences.push('parent');
		if (args.childEmailConfirmed) audiences.push('self');
		return audiences;
	}
	if (args.tier !== 'high') return [];
	if (!args.childEmailConfirmed) return args.chat && args.parentForRest ? ['parent'] : [];
	const audiences: EmailAudience[] = [];
	if (!args.selfMuted) audiences.push('self');
	if (args.parentForRest && (args.chat ? args.chatCopies : args.activityCopies)) {
		audiences.push('parent');
	}
	return audiences;
};

// Consents per child are a handful at most (one per approval); bounded anyway.
const CONSENT_SCAN_LIMIT = 20;
// One row per linked parent of the child.
const SETTINGS_SCAN_LIMIT = 10;

export const hasParentConsent = async (ctx: Ctx, profileId: Id<'profiles'>) =>
	(await ctx.db
		.query('parentChildConsents')
		.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', profileId))
		.first()) !== null;

export const DEFAULT_PARENT_NOTIFICATION_SETTINGS = { chatCopies: false, activityCopies: false };

// The parent's per-child choices; no row = both off (D7: "child only, parent can opt back in").
export const getParentNotificationSettings = async (
	ctx: Ctx,
	parentProfileId: Id<'profiles'>,
	childProfileId: Id<'profiles'>
) => {
	const row = await ctx.db
		.query('parentNotificationSettings')
		.withIndex('by_parent_and_child', (q) =>
			q.eq('parentProfileId', parentProfileId).eq('childProfileId', childProfileId)
		)
		.unique();
	return row
		? { chatCopies: row.chatCopies, activityCopies: row.activityCopies }
		: DEFAULT_PARENT_NOTIFICATION_SETTINGS;
};

const loadChildRouting = async (ctx: Ctx, childProfileId: Id<'profiles'>) => {
	const consents = await ctx.db
		.query('parentChildConsents')
		.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', childProfileId))
		.order('desc')
		.take(CONSENT_SCAN_LIMIT);
	const approved = consents.filter((row) => row.status === 'approved');
	const forCritical = approved[0] ?? null;
	const forRest = approved.find((row) => row.unlinkedAt === undefined) ?? null;
	// The copies setting belongs to the parent behind the consent the copy goes to. Consents
	// approved before `parentProfileId` existed have no id: the child's only settings row is
	// theirs (one approved consent per child in v1).
	let settings = DEFAULT_PARENT_NOTIFICATION_SETTINGS;
	if (forRest) {
		const rows = await ctx.db
			.query('parentNotificationSettings')
			.withIndex('by_child', (q) => q.eq('childProfileId', childProfileId))
			.take(SETTINGS_SCAN_LIMIT);
		const row = forRest.parentProfileId
			? rows.find((candidate) => candidate.parentProfileId === forRest.parentProfileId)
			: rows[0];
		if (row) settings = { chatCopies: row.chatCopies, activityCopies: row.activityCopies };
	}
	return { forCritical, forRest, settings };
};

const childConfirmedEmail = (profile: Doc<'profiles'>) =>
	profile.notificationEmail && profile.notificationEmailVerifiedAt !== undefined
		? profile.notificationEmail
		: null;

const planForChild = async (ctx: Ctx, args: EmailRoutingArgs, selfMuted: boolean) => {
	const routing = await loadChildRouting(ctx, args.profile._id);
	const audiences = planChildEmailAudiences({
		tier: args.tier,
		chat: args.chat,
		childEmailConfirmed: childConfirmedEmail(args.profile) !== null,
		selfMuted,
		parentForCritical: routing.forCritical !== null,
		parentForRest: routing.forRest !== null,
		...routing.settings
	});
	return { routing, audiences };
};

// The authoritative resolution, used right before an email is handed to the provider (chat
// delivery, notifications.sendNotificationEmail). One entry per separate email.
export const resolveEmailRecipients = async (
	ctx: Ctx,
	args: EmailRoutingArgs
): Promise<ResolvedEmailRecipient[]> => {
	if (args.tier === 'medium') return [];
	const selfMuted = args.tier !== 'critical' && args.selfMuted;
	const childName = profileDisplayName(args.profile);
	const email = await getAuthUserEmail(ctx, args.profile.authUserId);
	if (!email) return [];
	if (!isSyntheticChildEmail(email)) {
		return selfMuted ? [] : [{ to: email, audience: 'self', childName }];
	}

	const { routing, audiences } = await planForChild(ctx, args, selfMuted);
	const confirmedChildEmail = childConfirmedEmail(args.profile);
	const recipients: ResolvedEmailRecipient[] = [];
	for (const audience of audiences) {
		if (audience === 'self' && confirmedChildEmail) {
			recipients.push({ to: confirmedChildEmail, audience, childName });
		}
		if (audience === 'parent') {
			const consent = args.tier === 'critical' ? routing.forCritical : routing.forRest;
			if (consent?.parentEmail) recipients.push({ to: consent.parentEmail, audience, childName });
		}
	}
	return recipients;
};

// Which audiences are owed, for SCHEDULING inside mutations (dispatchNotification, the chat
// grace job): the same matrix from the database alone, without the auth-component lookup. A
// profile with a parentChildConsents row is a child account — child signup
// (childSignup.ts) is the only writer of that table — and everyone else is an adult, owed only
// their own copy. The send path re-resolves authoritatively (resolveEmailRecipients).
export const planEmailAudiences = async (
	ctx: Ctx,
	args: EmailRoutingArgs
): Promise<EmailAudience[]> => {
	if (args.tier === 'medium') return [];
	const selfMuted = args.tier !== 'critical' && args.selfMuted;
	if (!(await hasParentConsent(ctx, args.profile._id))) {
		return selfMuted ? [] : ['self'];
	}
	return (await planForChild(ctx, args, selfMuted)).audiences;
};
