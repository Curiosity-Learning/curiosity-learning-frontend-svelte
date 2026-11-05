import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { isAtLeast16FromDateOfBirth } from './parentAccounts';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

// Deliverable-address stub: the betterAuth component is not available in convex-test, so the
// auth-email lookup module is mocked with a fixed authUserId -> email map, same pattern as
// notifications.spec.ts.
const { authEmailByUserId } = vi.hoisted(() => ({
	authEmailByUserId: new Map<string, string>([
		['parent-user', 'parent@example.com'],
		['other-parent-user', 'other-parent@example.com'],
		['stranger-user', 'stranger@example.com'],
		['child-user', 'child-user@children.curiosity.local'],
		['adult-child-user', 'grown@example.com']
	])
}));

vi.mock('./authEmail', () => ({
	getAuthUserEmail: async (_ctx: unknown, authUserId: string) =>
		authEmailByUserId.get(authUserId) ?? null
}));

// The fresh-sign-in rule reads the Better Auth session row, which needs the auth component;
// childEmailVerification.spec.ts covers it against the real component. Here it always passes.
vi.mock('./sessionFreshness', () => ({
	ROUTING_CHANGE_MAX_SESSION_AGE_MS: 15 * 60 * 1000,
	requireFreshSession: async () => {}
}));

// Confirmation emails and parent notices are scheduled by setChildNotificationEmail.
vi.mock('./email/resend', () => ({
	sendEmail: async () => ({ providerMessageId: 'resend-msg-1' })
}));

const insertProfile = async (
	t: ReturnType<typeof convexTest>,
	authUserId: string,
	options?: { dateOfBirth?: string; firstName?: string }
): Promise<Id<'profiles'>> =>
	t.run(async (ctx) => {
		return await ctx.db.insert('profiles', {
			authUserId,
			username: authUserId,
			firstName: options?.firstName,
			dateOfBirth: options?.dateOfBirth,
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: Date.now()
		});
	});

const insertApprovedConsent = async (
	t: ReturnType<typeof convexTest>,
	options: { childProfileId: Id<'profiles'>; parentEmail: string; parentProfileId?: Id<'profiles'> }
) =>
	t.run(async (ctx) => {
		const now = Date.now();
		await ctx.db.insert('parentChildConsents', {
			childProfileId: options.childProfileId,
			parentEmail: options.parentEmail,
			parentProfileId: options.parentProfileId,
			status: 'approved',
			token: `token-${options.childProfileId}`,
			approvedAt: now,
			createdAt: now,
			updatedAt: now
		});
	});

const seedClubRoom = async (
	t: ReturnType<typeof convexTest>,
	childProfileId: Id<'profiles'>,
	options?: { roomless?: boolean }
) =>
	t.run(async (ctx) => {
		const now = Date.now();
		const roleId = await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: [],
			order: 0,
			createdAt: now
		});
		const clubId = await ctx.db.insert('clubs', {
			name: 'Curiosity Club',
			discoverable: false,
			createdByProfileId: childProfileId,
			createdAt: now,
			updatedAt: now
		});
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: childProfileId,
			roleId,
			createdAt: now
		});
		let roomId: Id<'rooms'> | null = null;
		if (!options?.roomless) {
			roomId = await ctx.db.insert('rooms', { contextType: 'club', clubId });
			await ctx.db.insert('messages', {
				roomId,
				profileId: childProfileId,
				content: 'Hello from child'
			});
		}
		return { clubId, roleId, roomId };
	});

describe('parentAccounts.isAtLeast16FromDateOfBirth', () => {
	it('treats the child as 16 from the first day of the birth month', () => {
		// Born 2010-03 -> 16th birthday is treated as 2026-03-01 (first day of birth month).
		expect(isAtLeast16FromDateOfBirth('2010-03', Date.UTC(2026, 2, 1))).toBe(true);
		expect(isAtLeast16FromDateOfBirth('2010-03', Date.UTC(2026, 1, 28))).toBe(false);
	});

	it('returns false for missing or malformed dateOfBirth', () => {
		expect(isAtLeast16FromDateOfBirth(undefined, Date.now())).toBe(false);
		expect(isAtLeast16FromDateOfBirth('not-a-date', Date.now())).toBe(false);
	});
});

describe('parentAccounts.syncParentLinks / getMyLinkedChildren', () => {
	it('claims a link from an approved consent whose parentEmail matches the caller auth email', async () => {
		const t = convexTest(schema, modules);
		const childProfileId = await insertProfile(t, 'child-user', { firstName: 'Kid' });
		await insertApprovedConsent(t, { childProfileId, parentEmail: 'parent@example.com' });
		await insertProfile(t, 'parent-user');

		const parent = t.withIdentity({ subject: 'parent-user' });
		const result = await parent.mutation(api.parentAccounts.syncParentLinks, {});
		expect(result.linkedCount).toBe(1);

		const children = await parent.query(api.parentAccounts.getMyLinkedChildren, {});
		expect(children).toHaveLength(1);
		expect(children[0].childProfileId).toBe(childProfileId);
	});

	it('is idempotent across repeated calls', async () => {
		const t = convexTest(schema, modules);
		const childProfileId = await insertProfile(t, 'child-user');
		await insertApprovedConsent(t, { childProfileId, parentEmail: 'parent@example.com' });
		await insertProfile(t, 'parent-user');

		const parent = t.withIdentity({ subject: 'parent-user' });
		await parent.mutation(api.parentAccounts.syncParentLinks, {});
		const second = await parent.mutation(api.parentAccounts.syncParentLinks, {});
		expect(second.linkedCount).toBe(0);

		const children = await parent.query(api.parentAccounts.getMyLinkedChildren, {});
		expect(children).toHaveLength(1);
	});

	it('does not claim a link when the email does not match', async () => {
		const t = convexTest(schema, modules);
		const childProfileId = await insertProfile(t, 'child-user');
		await insertApprovedConsent(t, { childProfileId, parentEmail: 'parent@example.com' });
		await insertProfile(t, 'stranger-user');

		const stranger = t.withIdentity({ subject: 'stranger-user' });
		const result = await stranger.mutation(api.parentAccounts.syncParentLinks, {});
		expect(result.linkedCount).toBe(0);

		const children = await stranger.query(api.parentAccounts.getMyLinkedChildren, {});
		expect(children).toHaveLength(0);
	});

	it('does not claim pending (unapproved) consents', async () => {
		const t = convexTest(schema, modules);
		const childProfileId = await insertProfile(t, 'child-user');
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert('parentChildConsents', {
				childProfileId,
				parentEmail: 'parent@example.com',
				status: 'pending',
				token: 'pending-token',
				createdAt: now,
				updatedAt: now
			});
		});
		await insertProfile(t, 'parent-user');

		const parent = t.withIdentity({ subject: 'parent-user' });
		const result = await parent.mutation(api.parentAccounts.syncParentLinks, {});
		expect(result.linkedCount).toBe(0);
	});
});

describe('parentAccounts read-only child queries', () => {
	it('rejects a non-parent (no parentLinks row) from getChildOverview/listChildRooms', async () => {
		const t = convexTest(schema, modules);
		const childProfileId = await insertProfile(t, 'child-user');
		await seedClubRoom(t, childProfileId);
		await insertProfile(t, 'other-parent-user');

		const nonParent = t.withIdentity({ subject: 'other-parent-user' });
		await expect(
			nonParent.query(api.parentAccounts.getChildOverview, { childProfileId })
		).rejects.toThrow();
		await expect(
			nonParent.query(api.parentAccounts.listChildRooms, { childProfileId })
		).rejects.toThrow();
	});

	it('lets a linked parent read the child overview', async () => {
		const t = convexTest(schema, modules);
		const childProfileId = await insertProfile(t, 'child-user', { firstName: 'Kid' });
		await insertApprovedConsent(t, { childProfileId, parentEmail: 'parent@example.com' });
		await insertProfile(t, 'parent-user');

		const parent = t.withIdentity({ subject: 'parent-user' });
		await parent.mutation(api.parentAccounts.syncParentLinks, {});

		const overview = await parent.query(api.parentAccounts.getChildOverview, { childProfileId });
		expect(overview.childProfileId).toBe(childProfileId);
		expect(overview.firstName).toBe('Kid');
	});

	it("lists the child's own rooms via the child's access, not the parent's", async () => {
		const t = convexTest(schema, modules);
		const childProfileId = await insertProfile(t, 'child-user');
		await insertApprovedConsent(t, { childProfileId, parentEmail: 'parent@example.com' });
		await insertProfile(t, 'parent-user');
		const { roomId } = await seedClubRoom(t, childProfileId);

		const parent = t.withIdentity({ subject: 'parent-user' });
		await parent.mutation(api.parentAccounts.syncParentLinks, {});

		const rooms = await parent.query(api.parentAccounts.listChildRooms, { childProfileId });
		expect(rooms).toHaveLength(1);
		expect(rooms[0].roomId).toBe(roomId);

		const messages = await parent.query(api.parentAccounts.listChildMessages, {
			childProfileId,
			roomId: roomId as Id<'rooms'>
		});
		expect(messages.messages).toHaveLength(1);
		expect(messages.messages[0].content).toBe('Hello from child');
	});

	it('rejects listChildMessages for a room the child cannot read', async () => {
		const t = convexTest(schema, modules);
		const childProfileId = await insertProfile(t, 'child-user');
		await insertApprovedConsent(t, { childProfileId, parentEmail: 'parent@example.com' });
		await insertProfile(t, 'parent-user');
		// A second, unrelated club/room the child is NOT a member of.
		const strangerProfileId = await insertProfile(t, 'stranger-user');
		const { roomId: foreignRoomId } = await seedClubRoom(t, strangerProfileId);

		const parent = t.withIdentity({ subject: 'parent-user' });
		await parent.mutation(api.parentAccounts.syncParentLinks, {});

		await expect(
			parent.query(api.parentAccounts.listChildMessages, {
				childProfileId,
				roomId: foreignRoomId as Id<'rooms'>
			})
		).rejects.toThrow();
	});
});

describe('parentAccounts.unlinkParent', () => {
	it('rejects unlink for an under-16 child', async () => {
		const t = convexTest(schema, modules);
		const now = Date.now();
		const under16Birth = new Date(now);
		under16Birth.setUTCFullYear(under16Birth.getUTCFullYear() - 10);
		const dateOfBirth = `${under16Birth.getUTCFullYear()}-${String(
			under16Birth.getUTCMonth() + 1
		).padStart(2, '0')}`;

		const childProfileId = await insertProfile(t, 'child-user', { dateOfBirth });
		const parentProfileId = await insertProfile(t, 'parent-user');
		await t.run(async (ctx) => {
			await ctx.db.insert('parentLinks', {
				parentProfileId,
				childProfileId,
				createdAt: Date.now()
			});
		});

		const child = t.withIdentity({ subject: 'child-user' });
		await expect(
			child.mutation(api.parentAccounts.unlinkParent, { parentProfileId })
		).rejects.toThrow();
	});

	it('lets a >=16 child unlink and severs parent reads', async () => {
		const t = convexTest(schema, modules);
		const now = Date.now();
		const over16Birth = new Date(now);
		over16Birth.setUTCFullYear(over16Birth.getUTCFullYear() - 17);
		const dateOfBirth = `${over16Birth.getUTCFullYear()}-${String(
			over16Birth.getUTCMonth() + 1
		).padStart(2, '0')}`;

		const childProfileId = await insertProfile(t, 'child-user', { dateOfBirth });
		const parentProfileId = await insertProfile(t, 'parent-user');
		await t.run(async (ctx) => {
			await ctx.db.insert('parentLinks', {
				parentProfileId,
				childProfileId,
				createdAt: Date.now()
			});
		});

		const child = t.withIdentity({ subject: 'child-user' });
		const linkInfoBefore = await child.query(api.parentAccounts.getMyParentLink, {});
		expect(linkInfoBefore?.canUnlink).toBe(true);

		await child.mutation(api.parentAccounts.unlinkParent, { parentProfileId });

		const linkInfoAfter = await child.query(api.parentAccounts.getMyParentLink, {});
		expect(linkInfoAfter).toBeNull();

		const parent = t.withIdentity({ subject: 'parent-user' });
		await expect(
			parent.query(api.parentAccounts.getChildOverview, { childProfileId })
		).rejects.toThrow();
	});
});

describe('parentAccounts.unlinkParent: an unlinked parent cannot claim the link back', () => {
	const over16DateOfBirth = () => {
		const birth = new Date(Date.now());
		birth.setUTCFullYear(birth.getUTCFullYear() - 17);
		return `${birth.getUTCFullYear()}-${String(birth.getUTCMonth() + 1).padStart(2, '0')}`;
	};

	it('stops syncParentLinks re-creating the link, and the child sees no linked parent', async () => {
		const t = convexTest(schema, modules);
		const childProfileId = await insertProfile(t, 'child-user', {
			dateOfBirth: over16DateOfBirth()
		});
		const parentProfileId = await insertProfile(t, 'parent-user');
		await insertApprovedConsent(t, {
			childProfileId,
			parentEmail: 'parent@example.com',
			parentProfileId
		});
		const parent = t.withIdentity({ subject: 'parent-user' });
		const child = t.withIdentity({ subject: 'child-user' });
		expect((await parent.mutation(api.parentAccounts.syncParentLinks, {})).linkedCount).toBe(1);

		await child.mutation(api.parentAccounts.unlinkParent, { parentProfileId });

		expect((await parent.mutation(api.parentAccounts.syncParentLinks, {})).linkedCount).toBe(0);
		await expect(
			parent.query(api.parentAccounts.getChildOverview, { childProfileId })
		).rejects.toThrow('You do not have access to this child account');
		expect(await child.query(api.parentAccounts.getMyParentLink, {})).toBeNull();
		await t.run(async (ctx) => {
			const consents = await ctx.db
				.query('parentChildConsents')
				.withIndex('by_child_profile_id', (q) => q.eq('childProfileId', childProfileId))
				.collect();
			expect(consents).toHaveLength(1);
			// Still the legal record of consent; only marked unlinked.
			expect(consents[0].status).toBe('approved');
			expect(consents[0].unlinkedAt).toBeTypeOf('number');
		});
	});

	it('also covers an older consent without parentProfileId, matched on the parent email', async () => {
		const t = convexTest(schema, modules);
		const childProfileId = await insertProfile(t, 'child-user', {
			dateOfBirth: over16DateOfBirth()
		});
		const parentProfileId = await insertProfile(t, 'parent-user');
		await insertApprovedConsent(t, { childProfileId, parentEmail: 'parent@example.com' });
		const parent = t.withIdentity({ subject: 'parent-user' });
		const child = t.withIdentity({ subject: 'child-user' });
		expect((await parent.mutation(api.parentAccounts.syncParentLinks, {})).linkedCount).toBe(1);

		await child.mutation(api.parentAccounts.unlinkParent, { parentProfileId });

		expect((await parent.mutation(api.parentAccounts.syncParentLinks, {})).linkedCount).toBe(0);
		await expect(
			parent.query(api.parentAccounts.getChildOverview, { childProfileId })
		).rejects.toThrow('You do not have access to this child account');
		expect(await child.query(api.parentAccounts.getMyParentLink, {})).toBeNull();
	});

	it("leaves another parent's consent alone", async () => {
		const t = convexTest(schema, modules);
		const childProfileId = await insertProfile(t, 'child-user', {
			dateOfBirth: over16DateOfBirth()
		});
		const parentProfileId = await insertProfile(t, 'parent-user');
		await insertProfile(t, 'other-parent-user');
		await insertApprovedConsent(t, {
			childProfileId,
			parentEmail: 'parent@example.com',
			parentProfileId
		});
		await t.run(async (ctx) => {
			const now = Date.now();
			await ctx.db.insert('parentChildConsents', {
				childProfileId,
				parentEmail: 'other-parent@example.com',
				status: 'approved',
				token: 'token-other',
				approvedAt: now,
				createdAt: now,
				updatedAt: now
			});
		});

		await t
			.withIdentity({ subject: 'child-user' })
			.mutation(api.parentAccounts.unlinkParent, { parentProfileId });

		const otherParent = t.withIdentity({ subject: 'other-parent-user' });
		expect((await otherParent.mutation(api.parentAccounts.syncParentLinks, {})).linkedCount).toBe(
			1
		);
	});
});

// Review S13: the old guard grepped top-level files for the literal arg name `childProfileId:`,
// so a mutation taking `childId` or `profileId` slipped through. The rule now:
//
//   Every PUBLIC `mutation({...})` in src/convex/**/*.ts (specs and _generated excluded) whose
//   args contain a `v.id('profiles')` — under any arg name, nested or not, inline or through a
//   validator constant declared in the same file — must call `requireParentLink(` in its
//   handler, UNLESS it is listed below with the guard it calls instead and why it is not a
//   parent-acting-on-a-child path. An allowlisted mutation must still call its named guard, may
//   not name its arg `childProfileId` (a child-named arg is always a parent path), and every
//   allowlist entry must still exist (no stale exemptions).
//
// A static source scan rather than eager-importing every module: importing convex.config.ts
// outside the Convex runtime fails (the betterAuth component is not mountable that way). Relies
// on two conventions this codebase follows everywhere (asserted below so a change breaks the
// test, not the guard): public mutations are declared `export const name = mutation({`, and
// `args` precedes `handler` in the object. Internal mutations are not client-callable and are
// out of scope. Behaviour tests for each parent mutation follow the scan.
describe('structural guard: public mutations taking a profile id (review S13)', () => {
	const allowlist: Record<string, { guard: string; reason: string }> = {
		'parentAccounts.ts:unlinkParent': {
			guard: 'requireProfile(',
			reason:
				"Called by the CHILD (16+): the id names the parent to unlink from the caller's own links."
		},
		'projects.ts:addMember': {
			guard: 'isProjectPermissionAllowed(',
			reason: 'Project staff adding a member, gated on project:update.'
		},
		'projectInvites.ts:inviteMember': {
			guard: 'isProjectPermissionAllowed(',
			reason: 'Project staff inviting someone, gated on project:update.'
		},
		'admin.ts:adminAssignReviewer': {
			guard: 'requireGlobalAdmin(',
			reason: 'Platform admin assigning an application reviewer.'
		},
		'admin.ts:adminUnassignReviewer': {
			guard: 'requireGlobalAdmin(',
			reason: 'Platform admin removing an application reviewer.'
		},
		'moderation.ts:suspendUser': {
			guard: 'requireAdminProfile(',
			reason: 'Platform admin moderation of the target account.'
		},
		'moderation.ts:unsuspendUser': {
			guard: 'requireAdminProfile(',
			reason: 'Platform admin moderation of the target account.'
		},
		'adminInvites.ts:removeAdmin': {
			guard: 'requireGlobalAdmin(',
			reason: 'Platform admin demoting another admin.'
		},
		'sessions.ts:setAttendance': {
			guard: 'requirePermission(',
			reason: "Club staff marking a member's attendance, gated on attendance:create."
		}
	};

	const convexDir = new URL('.', import.meta.url).pathname;
	const listSourceFiles = (dir: string, prefix = ''): string[] =>
		readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
			if (entry.isDirectory()) {
				return entry.name === '_generated'
					? []
					: listSourceFiles(join(dir, entry.name), `${prefix}${entry.name}/`);
			}
			return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
				? [`${prefix}${entry.name}`]
				: [];
		});
	const PROFILE_ID = /v\.id\(\s*['"`]profiles['"`]\s*\)/;

	type ScannedMutation = { key: string; args: string; handler: string };
	const scanPublicMutations = (): ScannedMutation[] =>
		listSourceFiles(convexDir).flatMap((relativePath) => {
			const source = readFileSync(join(convexDir, relativePath), 'utf8');
			// Any `mutation({` that is not the conventional declaration would escape the scan.
			const conventional = source.match(/export const \w+ = mutation\(\{/g)?.length ?? 0;
			const all = source.match(/(?<![\w.])mutation\(\{/g)?.length ?? 0;
			expect(all, `${relativePath}: unconventional mutation declaration`).toBe(conventional);

			const found: ScannedMutation[] = [];
			const pattern = /export const (\w+) = mutation\(\{([\s\S]*?)\bhandler:/g;
			let match: RegExpExecArray | null;
			while ((match = pattern.exec(source))) {
				let args = match[2];
				// `args: someValidator` — inline the same-file declaration it names.
				const named = /args:\s*([A-Za-z_$][\w$]*)\s*[,}]/.exec(args);
				if (named) {
					const declaration = new RegExp(
						`const ${named[1]}\\b[^=]*=([\\s\\S]*?)(?:\\n\\n|\\nexport )`
					).exec(source);
					expect(declaration, `${relativePath}:${match[1]} args ${named[1]}`).not.toBeNull();
					args += declaration![1];
				}
				const handlerStart = match.index + match[0].length;
				const next = source.indexOf('\nexport ', handlerStart);
				found.push({
					key: `${relativePath}:${match[1]}`,
					args,
					handler: source.slice(handlerStart, next === -1 ? undefined : next)
				});
			}
			return found;
		});

	it('every public mutation with a profile-id arg calls requireParentLink or is a justified exception', () => {
		const mutations = scanPublicMutations();
		// Sanity: the scan sees the codebase (and the parent mutations in particular).
		expect(mutations.length).toBeGreaterThan(50);
		const offenders: string[] = [];
		const takingProfileIds = mutations.filter((mutation) => PROFILE_ID.test(mutation.args));
		for (const mutation of takingProfileIds) {
			if (mutation.handler.includes('requireParentLink(')) continue;
			const exception = allowlist[mutation.key];
			if (!exception) {
				offenders.push(`${mutation.key}: no requireParentLink( and not allowlisted`);
				continue;
			}
			if (!mutation.handler.includes(exception.guard)) {
				offenders.push(`${mutation.key}: allowlisted guard ${exception.guard} not called`);
			}
			if (/\bchildProfileId\s*:/.test(mutation.args)) {
				offenders.push(`${mutation.key}: a childProfileId arg must use requireParentLink(`);
			}
		}
		expect(offenders).toEqual([]);

		// No stale exemptions, and the parent mutations are covered by the rule itself.
		const keys = new Set(takingProfileIds.map((mutation) => mutation.key));
		expect(Object.keys(allowlist).filter((key) => !keys.has(key))).toEqual([]);
		for (const key of [
			'parentAccounts.ts:setChildNotificationEmail',
			'parentAccounts.ts:setParentNotificationSettings'
		]) {
			expect(keys.has(key), key).toBe(true);
			expect(takingProfileIds.find((mutation) => mutation.key === key)!.handler).toContain(
				'requireParentLink('
			);
		}
	});

	it('refuses an adult without a link to the child on every parent mutation', async () => {
		const t = convexTest(schema, modules);
		const childProfileId = await insertProfile(t, 'child-user');
		await insertProfile(t, 'parent-user');
		await insertProfile(t, 'stranger-user');
		await insertApprovedConsent(t, { childProfileId, parentEmail: 'parent@example.com' });
		await t
			.withIdentity({ subject: 'parent-user' })
			.mutation(api.parentAccounts.syncParentLinks, {});
		const stranger = t.withIdentity({ subject: 'stranger-user' });

		await expect(
			stranger.mutation(api.parentAccounts.setChildNotificationEmail, {
				childProfileId,
				email: 'kid@example.com'
			})
		).rejects.toThrow('You do not have access to this child account');
		await expect(
			stranger.mutation(api.parentAccounts.setParentNotificationSettings, {
				childProfileId,
				chatCopies: true
			})
		).rejects.toThrow('You do not have access to this child account');
		// Not even a no-op call gets past the link check.
		await expect(
			stranger.mutation(api.parentAccounts.setParentNotificationSettings, { childProfileId })
		).rejects.toThrow('You do not have access to this child account');
		const rows = await t.run((ctx) => ctx.db.query('parentNotificationSettings').collect());
		expect(rows).toEqual([]);
	});
});

describe('parentAccounts.setParentNotificationSettings', () => {
	const seedLinked = async () => {
		const t = convexTest(schema, modules);
		const parentProfileId = await insertProfile(t, 'parent-user');
		const childProfileId = await insertProfile(t, 'child-user');
		await insertApprovedConsent(t, {
			childProfileId,
			parentEmail: 'parent@example.com',
			parentProfileId
		});
		const parent = t.withIdentity({ subject: 'parent-user' });
		await parent.mutation(api.parentAccounts.syncParentLinks, {});
		return { t, parent, parentProfileId, childProfileId };
	};

	it('defaults to no copies and reports whether the child email is confirmed', async () => {
		const { t, parent, childProfileId } = await seedLinked();
		let overview = await parent.query(api.parentAccounts.getChildOverview, { childProfileId });
		expect(overview.parentNotificationSettings).toEqual({
			chatCopies: false,
			activityCopies: false
		});
		expect(overview.notificationEmailVerified).toBe(false);

		await t.run(async (ctx) => {
			await ctx.db.patch(childProfileId, { notificationEmail: 'kiddo@example.com' });
		});
		overview = await parent.query(api.parentAccounts.getChildOverview, { childProfileId });
		expect(overview.notificationEmailVerified).toBe(false);
		await t.run(async (ctx) => {
			await ctx.db.patch(childProfileId, { notificationEmailVerifiedAt: Date.now() });
		});
		overview = await parent.query(api.parentAccounts.getChildOverview, { childProfileId });
		expect(overview.notificationEmailVerified).toBe(true);
	});

	it('updates only the fields given, one row per (parent, child)', async () => {
		const { t, parent, parentProfileId, childProfileId } = await seedLinked();
		expect(
			await parent.mutation(api.parentAccounts.setParentNotificationSettings, {
				childProfileId,
				chatCopies: true
			})
		).toEqual({ chatCopies: true, activityCopies: false });
		expect(
			await parent.mutation(api.parentAccounts.setParentNotificationSettings, {
				childProfileId,
				activityCopies: true
			})
		).toEqual({ chatCopies: true, activityCopies: true });
		const rows = await t.run((ctx) =>
			ctx.db
				.query('parentNotificationSettings')
				.withIndex('by_child', (q) => q.eq('childProfileId', childProfileId))
				.collect()
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ parentProfileId, chatCopies: true, activityCopies: true });
		const overview = await parent.query(api.parentAccounts.getChildOverview, { childProfileId });
		expect(overview.parentNotificationSettings).toEqual({
			chatCopies: true,
			activityCopies: true
		});
	});

	it('is refused to the child themselves', async () => {
		const { t, childProfileId } = await seedLinked();
		await expect(
			t
				.withIdentity({ subject: 'child-user' })
				.mutation(api.parentAccounts.setParentNotificationSettings, {
					childProfileId,
					chatCopies: false
				})
		).rejects.toThrow('You do not have access to this child account');
		expect(await t.run((ctx) => ctx.db.query('parentNotificationSettings').collect())).toEqual([]);
	});
});

describe('parentAccounts.setChildNotificationEmail', () => {
	const seedLinkedChild = async (childAuthUserId = 'child-user') => {
		const t = convexTest(schema, modules);
		const parentProfileId = await insertProfile(t, 'parent-user');
		const childProfileId = await insertProfile(t, childAuthUserId);
		await insertApprovedConsent(t, { childProfileId, parentEmail: 'parent@example.com' });
		await t
			.withIdentity({ subject: 'parent-user' })
			.mutation(api.parentAccounts.syncParentLinks, {});
		return {
			t,
			parentProfileId,
			childProfileId,
			parent: t.withIdentity({ subject: 'parent-user' })
		};
	};

	it('lets the linked parent set and clear the address, recording who did it', async () => {
		const { t, parent, parentProfileId, childProfileId } = await seedLinkedChild();

		const result = await parent.mutation(api.parentAccounts.setChildNotificationEmail, {
			childProfileId,
			email: '  Kid.Mail@Example.com '
		});
		expect(result).toEqual({
			notificationEmail: 'kid.mail@example.com',
			status: 'pending',
			verificationSent: true
		});
		let child = await t.run(async (ctx) => await ctx.db.get(childProfileId));
		expect(child?.notificationEmail).toBe('kid.mail@example.com');
		expect(child?.notificationEmailSetByProfileId).toBe(parentProfileId);
		expect(child?.notificationEmailSetAt).toEqual(expect.any(Number));
		expect(child?.notificationEmailSource).toBe('childPage');
		// Pending until the child confirms it (CL-768).
		expect(child?.notificationEmailVerifiedAt).toBeUndefined();
		const overview = await parent.query(api.parentAccounts.getChildOverview, { childProfileId });
		expect(overview.notificationEmail).toBe('kid.mail@example.com');
		expect(overview.notificationEmailVerifiedAt).toBeNull();

		await parent.mutation(api.parentAccounts.setChildNotificationEmail, {
			childProfileId,
			email: null
		});
		child = await t.run(async (ctx) => await ctx.db.get(childProfileId));
		expect(child?.notificationEmail).toBeUndefined();
		expect(child?.notificationEmailSetByProfileId).toBeUndefined();
		expect(child?.notificationEmailSource).toBeUndefined();
	});

	it('rejects anyone without a parentLinks row for that child', async () => {
		const { t, childProfileId } = await seedLinkedChild();
		await insertProfile(t, 'stranger-user');
		await expect(
			t
				.withIdentity({ subject: 'stranger-user' })
				.mutation(api.parentAccounts.setChildNotificationEmail, {
					childProfileId,
					email: 'kid@example.com'
				})
		).rejects.toThrow(/do not have access/);
	});

	it('rejects malformed addresses and the synthetic child domain', async () => {
		const { parent, childProfileId } = await seedLinkedChild();
		for (const email of [
			'not-an-email',
			'kid@nodot',
			'kid @example.com',
			'kid@children.curiosity.local'
		]) {
			await expect(
				parent.mutation(api.parentAccounts.setChildNotificationEmail, { childProfileId, email })
			).rejects.toThrow(/valid email/);
		}
	});

	it('refuses to set one on an account that already has a real email', async () => {
		const { parent, childProfileId } = await seedLinkedChild('adult-child-user');
		await expect(
			parent.mutation(api.parentAccounts.setChildNotificationEmail, {
				childProfileId,
				email: 'kid@example.com'
			})
		).rejects.toThrow(/only be set for a child account/);
	});
});
