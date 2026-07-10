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
		['stranger-user', 'stranger@example.com']
	])
}));

vi.mock('./authEmail', () => ({
	getAuthUserEmail: async (_ctx: unknown, authUserId: string) =>
		authEmailByUserId.get(authUserId) ?? null
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

describe('parentAccounts structural guarantee: no mutation accepts a childProfileId', () => {
	it('has no `mutation({...})` block whose args include a childProfileId field', () => {
		// Structural assertion (PRD requirement: "no mutations accept a childProfileId — nothing
		// can be done as the child"). A static source scan rather than a runtime import of every
		// module: eagerly importing every convex module (including convex.config.ts) outside the
		// Convex runtime fails because the betterAuth component isn't mountable in convex-test
		// (see notifications.spec.ts/authEmail.ts's own workaround for the same limitation), so
		// this test greps the mutation()/internalMutation() call sites in source text instead of
		// eager-importing modules. `unlinkParent`/`syncParentLinks` (this module's own mutations)
		// intentionally take no childProfileId — they always act on the CALLER's own profile.
		const convexDir = new URL('.', import.meta.url).pathname;
		const offenders: string[] = [];

		for (const fileName of readdirSync(convexDir)) {
			if (!fileName.endsWith('.ts') || fileName.endsWith('.spec.ts')) continue;
			const source = readFileSync(join(convexDir, fileName), 'utf8');
			// Match each `mutation({` / `internalMutation({` block up to its matching closing
			// `handler:` keyword (args always precede handler in this codebase's convention), then
			// check that slice for a childProfileId arg declaration.
			const mutationBlockPattern = /\b(?:internal)?[Mm]utation\(\{([\s\S]*?)handler:/g;
			let match: RegExpExecArray | null;
			while ((match = mutationBlockPattern.exec(source))) {
				const argsBlock = match[1];
				if (/childProfileId\s*:/.test(argsBlock)) {
					offenders.push(fileName);
				}
			}
		}

		expect(offenders).toEqual([]);
	});
});
