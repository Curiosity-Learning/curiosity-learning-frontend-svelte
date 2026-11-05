import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { VIEW_AS_READ_ONLY_CODE } from './permissions';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

// The betterAuth component is not mountable in convex-test (see parentAccounts.spec.ts).
vi.mock('./authEmail', () => ({
	getAuthUserEmail: async () => null,
	getAuthUserEmailInfo: async () => null
}));

const PARENT = 'parent-user';
const CHILD = 'child-user';

const setup = async (options?: { linked?: boolean }) => {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const now = Date.now();
		const insertProfile = (authUserId: string, firstName: string) =>
			ctx.db.insert('profiles', {
				authUserId,
				username: authUserId,
				firstName,
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: now
			});
		const parentProfileId = await insertProfile(PARENT, 'Parent');
		const childProfileId = await insertProfile(CHILD, 'Kid');
		const strangerChildProfileId = await insertProfile('stranger-child', 'Other');
		if (options?.linked !== false) {
			await ctx.db.insert('parentLinks', { parentProfileId, childProfileId, createdAt: now });
		}
		return { parentProfileId, childProfileId, strangerChildProfileId };
	});
	const parentSession = (sessionId: string) => t.withIdentity({ subject: PARENT, sessionId });
	return { t, ...ids, parentSession };
};

const expectReadOnly = async (promise: Promise<unknown>) => {
	await expect(promise).rejects.toMatchObject({ data: { code: VIEW_AS_READ_ONLY_CODE } });
};

describe('viewAs', () => {
	it('lists linked children and starts with no active view', async () => {
		const { parentSession, childProfileId } = await setup();
		const state = await parentSession('s1').query(api.viewAs.getState, {});
		expect(state.viewingAsChildProfileId).toBeNull();
		expect(state.children).toEqual([
			{ childProfileId, displayName: 'Kid', username: CHILD, coverPhotoUrl: null }
		]);
	});

	it('makes queries answer as the child once the parent starts viewing', async () => {
		const { parentSession, childProfileId, parentProfileId } = await setup();
		const parent = parentSession('s1');
		expect((await parent.query(api.profiles.getMe, {}))._id).toBe(parentProfileId);

		await parent.mutation(api.viewAs.startViewing, { childProfileId });

		expect((await parent.query(api.profiles.getMe, {}))._id).toBe(childProfileId);
		// The banner state still reads the parent's own links and reports the active child.
		const state = await parent.query(api.viewAs.getState, {});
		expect(state.viewingAsChildProfileId).toBe(childProfileId);
		expect(state.children).toHaveLength(1);
	});

	it('refuses every write while viewing, but keeps parent-scoped ones working', async () => {
		const { parentSession, childProfileId } = await setup();
		const parent = parentSession('s1');
		await parent.mutation(api.viewAs.startViewing, { childProfileId });

		await expectReadOnly(parent.mutation(api.profiles.updateMe, { firstName: 'Hacked' }));
		await expectReadOnly(parent.mutation(api.notifications.markAllRead, {}));
		// The leader-invite claim fires automatically for club-less users: it quietly no-ops.
		expect(await parent.mutation(api.clubLeaderInvites.claimMyLeaderInvite, {})).toEqual({
			status: 'no_invite'
		});
		// Nothing was written as the child.
		const child = await parent.query(api.profiles.getMe, {});
		expect(child.firstName).toBe('Kid');

		await parent.mutation(api.viewAs.stopViewing, {});
		expect((await parent.query(api.profiles.getMe, {})).firstName).toBe('Parent');
	});

	it('only switches the session that started the view', async () => {
		const { parentSession, childProfileId, parentProfileId } = await setup();
		await parentSession('phone').mutation(api.viewAs.startViewing, { childProfileId });
		expect((await parentSession('laptop').query(api.profiles.getMe, {}))._id).toBe(parentProfileId);
	});

	it('rejects viewing a child the caller is not linked to', async () => {
		const { parentSession, strangerChildProfileId } = await setup();
		await expect(
			parentSession('s1').mutation(api.viewAs.startViewing, {
				childProfileId: strangerChildProfileId
			})
		).rejects.toThrow('You do not have access to this child account');
	});

	it('ends the view as soon as the parent link is removed', async () => {
		const { t, parentSession, childProfileId, parentProfileId } = await setup();
		const parent = parentSession('s1');
		await parent.mutation(api.viewAs.startViewing, { childProfileId });
		await t.run(async (ctx) => {
			const links = await ctx.db.query('parentLinks').collect();
			for (const link of links) await ctx.db.delete(link._id as Id<'parentLinks'>);
		});
		expect((await parent.query(api.profiles.getMe, {}))._id).toBe(parentProfileId);
		expect((await parent.query(api.viewAs.getState, {})).viewingAsChildProfileId).toBeNull();
	});
});
