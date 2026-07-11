import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

describe('roles.syncRolePermissions', () => {
	it('adds missing canonical flags to a Guide row without touching existing ones', async () => {
		const t = convexTest(schema, modules);
		const now = Date.now();
		const guideRoleId = await t.run(async (ctx) => {
			return await ctx.db.insert('clubRoles', {
				key: 'guide',
				name: 'Guide',
				// Simulates a pre-CL-709 row: missing session:cancel, session_rsvp:*,
				// session_photo:create, club_member:promote, club_member:invite_guide,
				// club_join_request:decide.
				permissions: ['club:read', 'club:edit', 'session:read'],
				order: 10,
				createdAt: now
			});
		});

		const result = await t.mutation(internal.roles.syncRolePermissions, {});
		expect(result.rowsUpdated).toBe(1);

		const guideRole = await t.run((ctx) => ctx.db.get(guideRoleId));
		expect(guideRole?.permissions).toEqual(
			expect.arrayContaining([
				'club:read',
				'club:edit',
				'session:read',
				'session:cancel',
				'session_rsvp:set',
				'session_rsvp:read_all',
				'session_photo:create',
				'club_member:promote',
				'club_member:invite_guide',
				'club_join_request:decide'
			])
		);
	});

	it('adds missing canonical flags to a Learner row', async () => {
		const t = convexTest(schema, modules);
		const now = Date.now();
		const learnerRoleId = await t.run(async (ctx) => {
			return await ctx.db.insert('clubRoles', {
				key: 'learner',
				name: 'Learner',
				// Missing session_rsvp:set (new learner capability from CL-709).
				permissions: ['club:read', 'session:read'],
				order: 100,
				createdAt: now
			});
		});

		const result = await t.mutation(internal.roles.syncRolePermissions, {});
		expect(result.rowsUpdated).toBe(1);

		const learnerRole = await t.run((ctx) => ctx.db.get(learnerRoleId));
		expect(learnerRole?.permissions).toEqual(expect.arrayContaining(['session_rsvp:set']));
	});

	it('keeps hand-added custom permissions a row already has', async () => {
		const t = convexTest(schema, modules);
		const now = Date.now();
		const guideRoleId = await t.run(async (ctx) => {
			return await ctx.db.insert('clubRoles', {
				key: 'guide',
				name: 'Guide',
				permissions: ['club:read', 'club:edit', 'custom:special_flag'],
				order: 10,
				createdAt: now
			});
		});

		await t.mutation(internal.roles.syncRolePermissions, {});

		const guideRole = await t.run((ctx) => ctx.db.get(guideRoleId));
		expect(guideRole?.permissions).toContain('custom:special_flag');
	});

	it('is a no-op (idempotent) when a row already has every canonical flag', async () => {
		const t = convexTest(schema, modules);
		const now = Date.now();
		await t.mutation(internal.roles.syncRolePermissions, {});
		const firstPass = await t.run(async (ctx) => {
			return await ctx.db.insert('clubRoles', {
				key: 'learner',
				name: 'Learner',
				permissions: [
					'club:read',
					'club_member:read_active',
					'session:read',
					'session_rsvp:set',
					'session_activity:read',
					'project:read',
					'attendance:read',
					'updates:read'
				],
				order: 100,
				createdAt: now
			});
		});

		const result = await t.mutation(internal.roles.syncRolePermissions, {});
		expect(result.rowsUpdated).toBe(0);

		const learnerRole = await t.run((ctx) => ctx.db.get(firstPass));
		expect(learnerRole?.permissions).toHaveLength(8);
	});
});
