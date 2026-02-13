import { describe, expect, it } from 'vitest';
import type { Doc, Id } from '$convex/_generated/dataModel';
import { groupSessionsByBucket } from './session';

const makeSession = (id: string, startTime: number): Doc<'sessions'> =>
	({
		_id: id as Id<'sessions'>,
		_creationTime: Date.now(),
		clubId: 'club_1' as Id<'clubs'>,
		description: `Session ${id}`,
		startTime,
		endTime: startTime + 3_600_000,
		createdByUserId: 'user_1',
		createdAt: Date.now(),
		updatedAt: Date.now()
	}) satisfies Doc<'sessions'>;

describe('session domain helpers', () => {
	it('groups sessions into Today/Tomorrow/Upcoming/Past buckets', () => {
		const base = new Date();
		base.setHours(12, 0, 0, 0);
		const day = 24 * 60 * 60 * 1000;

		const sessions = [
			makeSession('today', base.getTime()),
			makeSession('tomorrow', base.getTime() + day),
			makeSession('upcoming', base.getTime() + 3 * day),
			makeSession('past', base.getTime() - day)
		];

		const grouped = groupSessionsByBucket(sessions);
		expect(grouped.Today).toHaveLength(1);
		expect(grouped.Tomorrow).toHaveLength(1);
		expect(grouped.Upcoming).toHaveLength(1);
		expect(grouped.Past).toHaveLength(1);
	});
});
