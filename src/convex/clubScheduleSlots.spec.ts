import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const seedClubFixture = async () => {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const now = Date.now();
		const guideRoleId = await ctx.db.insert('clubRoles', {
			key: 'guide',
			name: 'Guide',
			permissions: ['club:read', 'club:edit'],
			order: 0,
			createdAt: now
		});
		const learnerRoleId = await ctx.db.insert('clubRoles', {
			key: 'learner',
			name: 'Learner',
			permissions: ['club:read'],
			order: 1,
			createdAt: now
		});
		const guideProfileId = await ctx.db.insert('profiles', {
			authUserId: 'guide-user',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const learnerProfileId = await ctx.db.insert('profiles', {
			authUserId: 'learner-user',
			isVerified: true,
			firstLoginCompleted: true,
			updatedAt: now
		});
		const clubId = await ctx.db.insert('clubs', {
			name: 'Curiosity Club',
			createdByProfileId: guideProfileId,
			createdAt: now,
			updatedAt: now
		});
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: guideProfileId,
			roleId: guideRoleId,
			createdAt: now
		});
		await ctx.db.insert('clubMembers', {
			clubId,
			profileId: learnerProfileId,
			roleId: learnerRoleId,
			createdAt: now
		});
		return { clubId };
	});

	return { t, ...ids };
};

describe('clubScheduleSlots.create', () => {
	it('allows a guide to create a valid slot', async () => {
		const { t, clubId } = await seedClubFixture();

		const slot = await t.withIdentity({ subject: 'guide-user' }).mutation(api.clubScheduleSlots.create, {
			clubId,
			dayOfWeek: 'tuesday',
			startTime: '16:00',
			endTime: '17:30',
			location: 'Library'
		});

		expect(slot?.dayOfWeek).toBe('tuesday');
		expect(slot?.location).toBe('Library');
	});

	it('rejects a learner creating a slot', async () => {
		const { t, clubId } = await seedClubFixture();

		await expect(
			t.withIdentity({ subject: 'learner-user' }).mutation(api.clubScheduleSlots.create, {
				clubId,
				dayOfWeek: 'tuesday',
				startTime: '16:00',
				endTime: '17:30',
				location: 'Library'
			})
		).rejects.toThrow('Permission denied');
	});

	it('rejects an end time that is not after the start time', async () => {
		const { t, clubId } = await seedClubFixture();

		await expect(
			t.withIdentity({ subject: 'guide-user' }).mutation(api.clubScheduleSlots.create, {
				clubId,
				dayOfWeek: 'tuesday',
				startTime: '17:00',
				endTime: '16:00',
				location: 'Library'
			})
		).rejects.toThrow('End time must be after start time');
	});

	it('rejects a missing location', async () => {
		const { t, clubId } = await seedClubFixture();

		await expect(
			t.withIdentity({ subject: 'guide-user' }).mutation(api.clubScheduleSlots.create, {
				clubId,
				dayOfWeek: 'tuesday',
				startTime: '16:00',
				endTime: '17:00',
				location: '   '
			})
		).rejects.toThrow('Location is required');
	});

	it('rejects malformed time strings', async () => {
		const { t, clubId } = await seedClubFixture();

		await expect(
			t.withIdentity({ subject: 'guide-user' }).mutation(api.clubScheduleSlots.create, {
				clubId,
				dayOfWeek: 'tuesday',
				startTime: '4:00 pm',
				endTime: '17:00',
				location: 'Library'
			})
		).rejects.toThrow('Times must be in HH:MM 24-hour format');
	});
});

describe('clubScheduleSlots.listByClub', () => {
	it('returns slots for a club a member can read', async () => {
		const { t, clubId } = await seedClubFixture();

		await t.withIdentity({ subject: 'guide-user' }).mutation(api.clubScheduleSlots.create, {
			clubId,
			dayOfWeek: 'thursday',
			startTime: '14:00',
			endTime: '15:00',
			location: 'Park'
		});

		const slots = await t
			.withIdentity({ subject: 'learner-user' })
			.query(api.clubScheduleSlots.listByClub, { clubId });

		expect(slots).toHaveLength(1);
		expect(slots[0].dayOfWeek).toBe('thursday');
	});
});

describe('clubScheduleSlots.update / remove', () => {
	it('allows a guide to update and then remove a slot', async () => {
		const { t, clubId } = await seedClubFixture();

		const created = await t.withIdentity({ subject: 'guide-user' }).mutation(api.clubScheduleSlots.create, {
			clubId,
			dayOfWeek: 'monday',
			startTime: '09:00',
			endTime: '10:00',
			location: 'Room A'
		});
		if (!created) throw new Error('slot not created');

		const updated = await t.withIdentity({ subject: 'guide-user' }).mutation(api.clubScheduleSlots.update, {
			slotId: created._id,
			dayOfWeek: 'monday',
			startTime: '09:30',
			endTime: '10:30',
			location: 'Room B'
		});
		expect(updated?.location).toBe('Room B');

		await t
			.withIdentity({ subject: 'guide-user' })
			.mutation(api.clubScheduleSlots.remove, { slotId: created._id });

		const slots = await t
			.withIdentity({ subject: 'guide-user' })
			.query(api.clubScheduleSlots.listByClub, { clubId });
		expect(slots).toHaveLength(0);
	});

	it('rejects a learner updating a slot', async () => {
		const { t, clubId } = await seedClubFixture();

		const created = await t.withIdentity({ subject: 'guide-user' }).mutation(api.clubScheduleSlots.create, {
			clubId,
			dayOfWeek: 'monday',
			startTime: '09:00',
			endTime: '10:00',
			location: 'Room A'
		});
		if (!created) throw new Error('slot not created');

		await expect(
			t.withIdentity({ subject: 'learner-user' }).mutation(api.clubScheduleSlots.update, {
				slotId: created._id,
				dayOfWeek: 'monday',
				startTime: '09:30',
				endTime: '10:30',
				location: 'Room B'
			})
		).rejects.toThrow('Permission denied');
	});
});
