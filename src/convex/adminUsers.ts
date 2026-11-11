import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { query } from './_generated/server';
import { getAuthUserEmailInfo, getAuthUserIdByEmail } from './authEmail';
import { CHILD_EMAIL_DOMAIN } from './childAccounts';
import { requireGlobalAdmin, requireProfile } from './permissions';

// CL-782: admin user lookup with contact details, so staff can reach a member (or the member's
// parent) outside the app. Every export here must call `requireActiveAdmin` first: these reads
// expose auth emails, which no member-facing endpoint returns.

// Signed in, globalRole 'admin', and not suspended. Stricter than plain `requireGlobalAdmin`,
// which lets a suspended admin through; suspending an account must also cut off its access to
// other people's emails.
const requireActiveAdmin = async (ctx: QueryCtx) => {
	const identity = await requireGlobalAdmin(ctx);
	await requireProfile(ctx, identity.subject);
};

const SEARCH_LIMIT = 25;

// Child accounts sign in by username and carry a synthetic `@children.curiosity.local` auth
// email that cannot receive mail, so it is never shown; their parent is the contact instead.
const contactEmail = async (ctx: QueryCtx, profile: Doc<'profiles'>) => {
	const info = await getAuthUserEmailInfo(ctx, profile.authUserId);
	const isChildAccount = info?.email.toLowerCase().endsWith(`@${CHILD_EMAIL_DOMAIN}`) ?? false;
	return {
		email: isChildAccount ? null : (info?.email ?? null),
		emailVerified: info?.emailVerified ?? false,
		isChildAccount
	};
};

const summarize = async (ctx: QueryCtx, profile: Doc<'profiles'>) => {
	const { email, isChildAccount } = await contactEmail(ctx, profile);
	return {
		profileId: profile._id,
		firstName: profile.firstName ?? null,
		lastName: profile.lastName ?? null,
		username: profile.username ?? null,
		globalRole: profile.globalRole ?? null,
		suspendedAt: profile.suspendedAt ?? null,
		email,
		isChildAccount
	};
};

// One box for username, name or email. An email finds the account with that address and every
// child whose parental consent names it, so a parent's address leads to their children too.
// Name matching scans `profiles` (no name index), like moderation.searchClubs does for clubs —
// fine at current volume for an admin-only read.
export const searchUsers = query({
	args: { search: v.string() },
	handler: async (ctx, args) => {
		await requireActiveAdmin(ctx);
		const term = args.search.trim().toLowerCase();
		if (!term) {
			return [];
		}

		const found = new Map<Id<'profiles'>, Doc<'profiles'>>();
		const add = (profile: Doc<'profiles'> | null) => {
			if (profile && found.size < SEARCH_LIMIT) found.set(profile._id, profile);
		};

		if (term.includes('@')) {
			const authUserId = await getAuthUserIdByEmail(ctx, term);
			if (authUserId) {
				add(
					await ctx.db
						.query('profiles')
						.withIndex('by_auth_user_id', (q) => q.eq('authUserId', authUserId))
						.unique()
				);
			}
			const consents = await ctx.db
				.query('parentChildConsents')
				.withIndex('by_parent_email', (q) => q.eq('parentEmail', term))
				.take(SEARCH_LIMIT);
			for (const consent of consents) {
				add(await ctx.db.get(consent.childProfileId));
			}
		} else {
			const byUsername = await ctx.db
				.query('profiles')
				.withIndex('by_username', (q) => q.gte('username', term).lt('username', `${term}￿`))
				.take(SEARCH_LIMIT);
			byUsername.forEach(add);

			if (found.size < SEARCH_LIMIT) {
				for (const profile of await ctx.db.query('profiles').collect()) {
					const fullName = [profile.firstName, profile.lastName]
						.filter(Boolean)
						.join(' ')
						.toLowerCase();
					if (fullName.includes(term)) add(profile);
					if (found.size >= SEARCH_LIMIT) break;
				}
			}
		}

		return await Promise.all([...found.values()].map((profile) => summarize(ctx, profile)));
	}
});

export const getUserDetails = query({
	args: { profileId: v.id('profiles') },
	handler: async (ctx, args) => {
		await requireActiveAdmin(ctx);
		const profile = await ctx.db.get(args.profileId);
		if (!profile) {
			return null;
		}

		const { email, emailVerified, isChildAccount } = await contactEmail(ctx, profile);

		// Under-16 accounts: the consent row holds the parent's address even before the parent
		// has an account, so it is the contact of record for a child.
		const consent = await ctx.db
			.query('parentChildConsents')
			.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', profile._id))
			.order('desc')
			.first();

		const parentLinks = await ctx.db
			.query('parentLinks')
			.withIndex('by_child', (q) => q.eq('childProfileId', profile._id))
			.collect();
		const parents = [];
		for (const link of parentLinks) {
			const parent = await ctx.db.get(link.parentProfileId);
			if (parent) parents.push(await summarize(ctx, parent));
		}

		const childLinks = await ctx.db
			.query('parentLinks')
			.withIndex('by_parent', (q) => q.eq('parentProfileId', profile._id))
			.collect();
		const children = [];
		for (const link of childLinks) {
			const child = await ctx.db.get(link.childProfileId);
			if (child) children.push(await summarize(ctx, child));
		}

		const memberships = await ctx.db
			.query('clubMembers')
			.withIndex('by_profile', (q) => q.eq('profileId', profile._id))
			.collect();
		const clubs = [];
		for (const membership of memberships) {
			if (membership.leftAt !== undefined) continue;
			const [club, role] = await Promise.all([
				ctx.db.get(membership.clubId),
				ctx.db.get(membership.roleId)
			]);
			if (club) {
				clubs.push({ clubId: club._id, name: club.name, role: role?.name ?? null });
			}
		}

		return {
			profileId: profile._id,
			firstName: profile.firstName ?? null,
			lastName: profile.lastName ?? null,
			username: profile.username ?? null,
			email,
			emailVerified,
			isChildAccount,
			dateOfBirth: profile.dateOfBirth ?? null,
			signUpWith: profile.signUpWith ?? null,
			locationAddress: profile.locationAddress ?? null,
			joinedAt: profile._creationTime,
			lastLogin: profile.lastLogin ?? null,
			globalRole: profile.globalRole ?? null,
			suspendedAt: profile.suspendedAt ?? null,
			suspendedReason: profile.suspendedReason ?? null,
			parentConsent: consent
				? {
						parentEmail: consent.parentEmail,
						status: consent.status,
						approvedAt: consent.approvedAt ?? null
					}
				: null,
			parents,
			children,
			clubs
		};
	}
});
