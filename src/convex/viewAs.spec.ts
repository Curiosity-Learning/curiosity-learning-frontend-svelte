import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { VIEW_AS_GUARD, type ViewAsGuard } from './functions';
import { VIEW_AS_READ_ONLY_CODE } from './permissions';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

// The betterAuth component is not mountable here (see parentAccounts.spec.ts).
vi.mock('./authEmail', () => ({
	getAuthUserEmail: async () => null,
	getAuthUserEmailInfo: async () => null
}));

const PARENT = 'parent-user';
const CHILD = 'child-user';

// Parent "View as Child" (CL-801). The safety rule: while a parent's session views the app as a
// child, nothing can be sent, changed or deleted, as the child or as the parent, on the server.
// Only the reviewed parent-scoped mutations below keep working, and they act as the parent.
const PARENT_SCOPED_MUTATIONS = [
	'clubs:checkClubCodeLookupRateLimit',
	'parentAccounts:syncParentLinks',
	'reports:submitReport',
	'viewAs:startViewing',
	'viewAs:stopViewing'
];

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

// A club the child is a learner in, with its chat room and one message.
const seedChildClub = async (t: ReturnType<typeof convexTest>, childProfileId: Id<'profiles'>) =>
	t.run(async (ctx) => {
		const now = Date.now();
		const roleId = await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: ['club:read', 'chat:read', 'chat:send', 'project:read'],
			order: 1,
			createdAt: now
		});
		const clubId = await ctx.db.insert('clubs', {
			name: 'Kid Club',
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
		const roomId = await ctx.db.insert('rooms', { contextType: 'club', clubId });
		await ctx.db.insert('messages', { roomId, profileId: childProfileId, content: 'Hi' });
		return { clubId, roomId };
	});

const expectReadOnly = async (promise: Promise<unknown>) => {
	await expect(promise).rejects.toMatchObject({ data: { code: VIEW_AS_READ_ONLY_CODE } });
};

type RegisteredFunction = {
	isMutation?: boolean;
	isAction?: boolean;
	isPublic?: boolean;
	_handler: (ctx: unknown, args: unknown) => Promise<unknown>;
	[VIEW_AS_GUARD]?: ViewAsGuard;
};

// Every public mutation and action in src/convex, found the way Convex finds them: the exports
// of every module that are registered functions.
const listPublicWriteFunctions = async () => {
	const found: Array<{ name: string; kind: 'mutation' | 'action'; fn: RegisteredFunction }> = [];
	for (const [path, load] of Object.entries(modules)) {
		if (path.includes('_generated') || path.endsWith('.spec.ts')) continue;
		const moduleName = path.replace(/^\.\//, '').replace(/\.ts$/, '');
		// Config modules define no functions (and only load in the Convex runtime).
		if (moduleName === 'convex.config' || moduleName === 'auth.config') continue;
		const exports = (await load()) as Record<string, unknown>;
		for (const [exportName, value] of Object.entries(exports)) {
			const fn = value as RegisteredFunction | null;
			if (!fn || (typeof fn !== 'function' && typeof fn !== 'object')) continue;
			if (!fn.isPublic || !(fn.isMutation || fn.isAction)) continue;
			found.push({
				name: `${moduleName}:${exportName}`,
				kind: fn.isMutation ? 'mutation' : 'action',
				fn
			});
		}
	}
	return found.sort((a, b) => a.name.localeCompare(b.name));
};

describe('viewAs: switching', () => {
	it('lists linked children and starts with no active view', async () => {
		const { parentSession, childProfileId } = await setup();
		const state = await parentSession('s1').query(api.viewAs.getState, {});
		expect(state.viewingAsChildProfileId).toBeNull();
		expect(state.children).toEqual([
			{ childProfileId, displayName: 'Kid', username: CHILD, coverPhotoUrl: null }
		]);
	});

	it('makes queries answer as the child once the parent starts viewing', async () => {
		const { t, parentSession, childProfileId, parentProfileId } = await setup();
		const { clubId, roomId } = await seedChildClub(t, childProfileId);
		const parent = parentSession('s1');
		expect((await parent.query(api.profiles.getMe, {}))._id).toBe(parentProfileId);
		expect(await parent.query(api.clubs.getMyClubSwitcherItems, {})).toEqual([]);

		await parent.mutation(api.viewAs.startViewing, { childProfileId });

		expect((await parent.query(api.profiles.getMe, {}))._id).toBe(childProfileId);
		const clubs = await parent.query(api.clubs.getMyClubSwitcherItems, {});
		expect(clubs.map((club) => club.clubId)).toEqual([clubId]);
		const messages = await parent.query(api.chat.listMessages, { roomId });
		expect(messages.messages.map((message) => message.content)).toEqual(['Hi']);
		// The bar's state still reads the parent's own links and reports the active child.
		const state = await parent.query(api.viewAs.getState, {});
		expect(state.viewingAsChildProfileId).toBe(childProfileId);
		expect(state.children).toHaveLength(1);

		await parent.mutation(api.viewAs.stopViewing, {});
		expect((await parent.query(api.profiles.getMe, {}))._id).toBe(parentProfileId);
	});

	it('only switches the session that started the view', async () => {
		const { parentSession, childProfileId, parentProfileId } = await setup();
		await parentSession('phone').mutation(api.viewAs.startViewing, { childProfileId });
		expect((await parentSession('laptop').query(api.profiles.getMe, {}))._id).toBe(parentProfileId);
		await parentSession('laptop').mutation(api.profiles.updateMe, { firstName: 'Still me' });
	});

	it('rejects viewing a child the caller is not linked to', async () => {
		const { parentSession, strangerChildProfileId } = await setup();
		await expect(
			parentSession('s1').mutation(api.viewAs.startViewing, {
				childProfileId: strangerChildProfileId
			})
		).rejects.toThrow('You do not have access to this child account');
		const { parentSession: unlinkedParent, childProfileId } = await setup({ linked: false });
		await expect(
			unlinkedParent('s1').mutation(api.viewAs.startViewing, { childProfileId })
		).rejects.toThrow('You do not have access to this child account');
	});

	it('refuses a child starting a view of anyone', async () => {
		const { t, childProfileId } = await setup();
		await expect(
			t
				.withIdentity({ subject: CHILD, sessionId: 'c1' })
				.mutation(api.viewAs.startViewing, { childProfileId })
		).rejects.toThrow('You do not have access to this child account');
	});

	it('ends the view as soon as the parent link is removed', async () => {
		const { t, parentSession, childProfileId, parentProfileId } = await setup();
		const parent = parentSession('s1');
		await parent.mutation(api.viewAs.startViewing, { childProfileId });
		await t.run(async (ctx) => {
			for (const link of await ctx.db.query('parentLinks').collect()) {
				await ctx.db.delete(link._id);
			}
		});
		expect((await parent.query(api.profiles.getMe, {}))._id).toBe(parentProfileId);
		expect((await parent.query(api.viewAs.getState, {})).viewingAsChildProfileId).toBeNull();
	});
});

describe('viewAs: nothing can be written while viewing (server-side)', () => {
	it('registers every public mutation and action with a view-as guard, and only the reviewed ones as parent-scoped', async () => {
		const functions = await listPublicWriteFunctions();
		expect(functions.length).toBeGreaterThan(100);
		const unguarded = functions.filter(({ fn }) => fn[VIEW_AS_GUARD] === undefined);
		expect(unguarded.map(({ name }) => name)).toEqual([]);
		const parentScoped = functions.filter(({ fn }) => fn[VIEW_AS_GUARD] === 'parentScoped');
		expect(parentScoped.map(({ name }) => name)).toEqual(PARENT_SCOPED_MUTATIONS);
		expect(parentScoped.every(({ kind }) => kind === 'mutation')).toBe(true);
	});

	it('refuses every other public mutation and action before it reads its arguments or writes anything', async () => {
		const { t, parentSession, childProfileId } = await setup();
		await parentSession('s1').mutation(api.viewAs.startViewing, { childProfileId });
		const identity = { subject: PARENT, sessionId: 's1', tokenIdentifier: `test|${PARENT}` };
		const auth = { getUserIdentity: async () => identity };
		const viewer = parentSession('s1');

		const functions = (await listPublicWriteFunctions()).filter(
			({ fn }) => fn[VIEW_AS_GUARD] === 'refusedWhileViewing'
		);
		const notRefused: string[] = [];
		const writes: string[] = [];
		for (const { name, kind, fn } of functions) {
			// Arguments that blow up on any read: a handler that got past the guard would throw
			// something other than the read-only error.
			const poisonedArgs = new Proxy(
				{},
				{
					get: () => {
						throw new Error(`${name} read its arguments`);
					}
				}
			);
			let error: unknown = null;
			try {
				if (kind === 'mutation') {
					await t.run(async (ctx) => {
						const db = new Proxy(ctx.db, {
							get: (target, prop, receiver) => {
								if (['insert', 'patch', 'replace', 'delete'].includes(String(prop))) {
									return () => {
										writes.push(name);
										throw new Error(`${name} wrote`);
									};
								}
								const value = Reflect.get(target, prop, receiver);
								return typeof value === 'function' ? value.bind(target) : value;
							}
						});
						const guardedCtx = new Proxy(
							{ ...ctx, db, auth },
							{
								get: (target, prop) => {
									if (prop === 'db' || prop === 'auth') return target[prop];
									throw new Error(`${name} used ctx.${String(prop)}`);
								}
							}
						);
						await fn._handler(guardedCtx, poisonedArgs);
					});
				} else {
					const actionCtx = new Proxy(
						{
							auth,
							runQuery: (ref: Parameters<typeof viewer.query>[0], args: unknown) =>
								viewer.query(ref, args as never)
						},
						{
							get: (target, prop) => {
								if (prop === 'auth' || prop === 'runQuery') return target[prop];
								throw new Error(`${name} used ctx.${String(prop)}`);
							}
						}
					);
					await fn._handler(actionCtx, poisonedArgs);
				}
			} catch (caught) {
				error = caught;
			}
			const code = (error as { data?: { code?: string } } | null)?.data?.code;
			if (code !== VIEW_AS_READ_ONLY_CODE) notRefused.push(name);
		}
		expect(notRefused).toEqual([]);
		expect(writes).toEqual([]);
	});

	it('refuses the child-facing writes end to end, and leaves the child untouched', async () => {
		const { t, parentSession, childProfileId } = await setup();
		const { clubId, roomId } = await seedChildClub(t, childProfileId);
		const parent = parentSession('s1');
		await parent.mutation(api.viewAs.startViewing, { childProfileId });

		await expectReadOnly(parent.mutation(api.chat.sendMessage, { roomId, content: 'as kid' }));
		await expectReadOnly(parent.mutation(api.chat.markRoomRead, { roomId }));
		await expectReadOnly(parent.mutation(api.profiles.updateMe, { firstName: 'Hacked' }));
		await expectReadOnly(parent.mutation(api.notifications.markAllRead, {}));
		await expectReadOnly(parent.mutation(api.clubs.switchActiveClub, { clubId }));
		await expectReadOnly(parent.mutation(api.auth.ensureProfile, {}));
		await expectReadOnly(parent.mutation(api.clubLeaderInvites.claimMyLeaderInvite, {}));
		// The parent's own settings for the child are refused too: switch back first.
		await expectReadOnly(
			parent.mutation(api.parentAccounts.setChildNotificationEmail, {
				childProfileId,
				email: 'kid@example.com'
			})
		);

		const after = await t.run(async (ctx) => ({
			child: await ctx.db.get(childProfileId),
			messages: await ctx.db
				.query('messages')
				.withIndex('by_room', (q) => q.eq('roomId', roomId))
				.collect()
		}));
		expect(after.child?.firstName).toBe('Kid');
		expect(after.child?.notificationEmail).toBeUndefined();
		expect(after.messages.map((message) => message.content)).toEqual(['Hi']);
	});

	it('lets a viewing parent report an issue, as themselves', async () => {
		const { t, parentSession, childProfileId, parentProfileId } = await setup();
		const { roomId } = await seedChildClub(t, childProfileId);
		const parent = parentSession('s1');
		await parent.mutation(api.viewAs.startViewing, { childProfileId });

		const result = await parent.mutation(api.reports.submitReport, {
			category: 'safeguarding',
			targetType: 'chat_message',
			targetId: roomId,
			description: 'Seen while viewing as my child'
		});
		expect(result.ok).toBe(true);
		const reports = await t.run((ctx) => ctx.db.query('reports').collect());
		expect(reports.map((report) => report.reporterProfileId)).toEqual([parentProfileId]);
	});

	it('works again for the parent after switching back', async () => {
		const { parentSession, childProfileId } = await setup();
		const parent = parentSession('s1');
		await parent.mutation(api.viewAs.startViewing, { childProfileId });
		await expectReadOnly(parent.mutation(api.profiles.updateMe, { firstName: 'Changed' }));
		await parent.mutation(api.viewAs.stopViewing, {});
		await parent.mutation(api.profiles.updateMe, { firstName: 'Changed' });
		expect((await parent.query(api.profiles.getMe, {})).firstName).toBe('Changed');
	});
});
