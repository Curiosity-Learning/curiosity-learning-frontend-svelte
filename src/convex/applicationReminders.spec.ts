/// <reference types="vite/client" />

// CL-770 phase 1: the "applications close soon" reminder for unfinished club applications, the
// date-only season rule it relies on, and the one-click unsubscribe every reminder carries.

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { createUnsubscribeToken, verifyUnsubscribeToken } from './emailUnsubscribe';
import { getApplicationIntakeSeason } from './seasons';
import {
	formatSeasonDeadline,
	seasonClosingMoment,
	seasonDateOf,
	seasonStartMoment
} from '../lib/domain/season-dates';

const modules = import.meta.glob('./**/*.ts');

const DAY = 24 * 60 * 60 * 1000;

const { sendEmailMock, authEmailByUserId } = vi.hoisted(() => ({
	sendEmailMock: vi.fn<(args: unknown) => Promise<{ providerMessageId: string }>>(async () => ({
		providerMessageId: 'resend-msg-1'
	})),
	authEmailByUserId: new Map<string, string>([
		['adult-user', 'adult@example.com'],
		['admin-user', 'admin@example.com'],
		['submitted-user', 'submitted@example.com'],
		['suspended-user', 'suspended@example.com'],
		['child-approved-user', 'approved-kid@children.curiosity.local'],
		['child-pending-user', 'pending-kid@children.curiosity.local'],
		['child-own-email-user', 'own-kid@children.curiosity.local'],
		['child-unlinked-user', 'unlinked-kid@children.curiosity.local']
	])
}));

vi.mock('./email/resend', () => ({ sendEmail: sendEmailMock }));

vi.mock('./authEmail', () => ({
	getAuthUserEmail: async (_ctx: unknown, authUserId: string) =>
		authEmailByUserId.get(authUserId) ?? null
}));

beforeEach(() => {
	sendEmailMock.mockReset();
	sendEmailMock.mockResolvedValue({ providerMessageId: 'resend-msg-1' });
	vi.stubEnv('BETTER_AUTH_URL', 'https://app.example.com');
	vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret');
	vi.stubEnv('CONVEX_SITE_URL', 'https://site.example.com');
});

afterEach(() => {
	vi.unstubAllEnvs();
});

type SentEmail = {
	to: string;
	subject: string;
	text: string;
	html: string;
	type: string;
	headers?: Record<string, string>;
};
const sentEmails = () =>
	sendEmailMock.mock.calls.map((call) => (call as unknown[])[0] as SentEmail);

const insertProfile = async (
	ctx: Parameters<Parameters<ReturnType<typeof convexTest>['run']>[0]>[0],
	fields: {
		authUserId: string;
		firstName?: string;
		username?: string;
		suspendedAt?: number;
		notificationEmail?: string;
		notificationEmailVerifiedAt?: number;
	}
) =>
	await ctx.db.insert('profiles', {
		isVerified: true,
		firstLoginCompleted: true,
		updatedAt: Date.now(),
		...fields
	});

const seed = async (options: { deadlineInMs?: number | null } = {}) => {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const now = Date.now();
		const deadline =
			options.deadlineInMs === null ? undefined : now + (options.deadlineInMs ?? 2 * DAY);
		const seasonId = await ctx.db.insert('seasons', {
			name: 'Winter 2026',
			applicationDeadline: deadline,
			reviewWindowOpen: (deadline ?? now) + 1,
			reviewWindowClose: (deadline ?? now) + 7 * DAY,
			startDate: (deadline ?? now) + 28 * DAY,
			endDate: (deadline ?? now) + 120 * DAY,
			feedbackDeadline: (deadline ?? now) + 130 * DAY,
			createdAt: now,
			updatedAt: now
		});
		const application = async (
			applicantProfileId: Id<'profiles'>,
			status: 'incomplete' | 'pending' = 'incomplete'
		) =>
			await ctx.db.insert('clubApplications', {
				applicantProfileId,
				status,
				name: 'My Curiosity Club',
				createdAt: now - DAY,
				updatedAt: now - DAY
			});

		const adultId = await insertProfile(ctx, { authUserId: 'adult-user', firstName: 'Ada' });
		const adultApplicationId = await application(adultId);

		const submittedId = await insertProfile(ctx, {
			authUserId: 'submitted-user',
			firstName: 'Sam'
		});
		await application(submittedId);
		await application(submittedId, 'pending');

		const suspendedId = await insertProfile(ctx, {
			authUserId: 'suspended-user',
			firstName: 'Sus',
			suspendedAt: now
		});
		await application(suspendedId);

		const approvedChildId = await insertProfile(ctx, {
			authUserId: 'child-approved-user',
			username: 'kiddo'
		});
		await ctx.db.insert('parentChildConsents', {
			childProfileId: approvedChildId,
			parentEmail: 'parent@example.com',
			status: 'approved',
			token: 'approved-token',
			approvedAt: now,
			createdAt: now,
			updatedAt: now
		});
		const approvedChildApplicationId = await application(approvedChildId);

		const pendingChildId = await insertProfile(ctx, {
			authUserId: 'child-pending-user',
			firstName: 'Pia',
			username: 'pia'
		});
		await ctx.db.insert('parentChildConsents', {
			childProfileId: pendingChildId,
			parentEmail: 'pending-parent@example.com',
			status: 'pending',
			token: 'pending-consent-token',
			createdAt: now,
			updatedAt: now
		});
		const pendingChildApplicationId = await application(pendingChildId);

		// A child who confirmed their own address is written to directly.
		const ownEmailChildId = await insertProfile(ctx, {
			authUserId: 'child-own-email-user',
			username: 'teen',
			notificationEmail: 'teen@example.com',
			notificationEmailVerifiedAt: now
		});
		await ctx.db.insert('parentChildConsents', {
			childProfileId: ownEmailChildId,
			parentEmail: 'teen-parent@example.com',
			status: 'approved',
			token: 'teen-token',
			approvedAt: now,
			createdAt: now,
			updatedAt: now
		});
		await application(ownEmailChildId);

		// A child who unlinked their parent and has no confirmed address: nobody to tell.
		const unlinkedChildId = await insertProfile(ctx, {
			authUserId: 'child-unlinked-user',
			username: 'solo'
		});
		await ctx.db.insert('parentChildConsents', {
			childProfileId: unlinkedChildId,
			parentEmail: 'unlinked-parent@example.com',
			status: 'approved',
			token: 'unlinked-token',
			approvedAt: now,
			unlinkedAt: now,
			createdAt: now,
			updatedAt: now
		});
		await application(unlinkedChildId);

		return {
			seasonId,
			deadline,
			adultId,
			adultApplicationId,
			approvedChildApplicationId,
			pendingChildApplicationId
		};
	});
	return { t, ...ids };
};

type ReminderRow = {
	applicationId: string;
	applicant: string;
	audience?: string;
	to?: string;
	skipReason?: string;
	status?: string;
};
type RunResult = {
	season: string;
	applicationsClose: string;
	toSend: number;
	skipped: number;
	sent?: number;
	failed?: number;
	reminders: ReminderRow[];
};

const run = async (t: ReturnType<typeof convexTest>, dryRun: boolean) =>
	(await t.action(internal.applicationReminders.sendClosingSoonReminders, { dryRun })) as RunResult;

describe('season dates (date-only rule)', () => {
	it('turns closing dates into 23:55 GMT and the start into 00:00 GMT', () => {
		expect(new Date(seasonClosingMoment('2026-11-07')).toISOString()).toBe(
			'2026-11-07T23:55:00.000Z'
		);
		expect(new Date(seasonStartMoment('2026-12-05')).toISOString()).toBe(
			'2026-12-05T00:00:00.000Z'
		);
		expect(seasonDateOf(seasonClosingMoment('2026-11-07'))).toBe('2026-11-07');
		expect(formatSeasonDeadline(seasonClosingMoment('2026-11-07'))).toBe(
			'Saturday 7 November, 23:55 GMT'
		);
	});

	it('rejects malformed and impossible dates', () => {
		expect(() => seasonClosingMoment('2026-02-31')).toThrow();
		expect(() => seasonClosingMoment('7 Nov 2026')).toThrow();
	});
});

describe('adminSaveSeason', () => {
	const setupAdmin = async () => {
		const t = convexTest(schema, modules);
		await t.run(async (ctx) => {
			await ctx.db.insert('profiles', {
				authUserId: 'admin-user',
				firstName: 'Ad',
				isVerified: true,
				firstLoginCompleted: true,
				globalRole: 'admin',
				updatedAt: Date.now()
			});
		});
		return { t, admin: t.withIdentity({ subject: 'admin-user' }) };
	};
	const winter = {
		name: 'Winter 2026',
		applicationDeadline: '2026-11-07',
		reviewWindowClose: '2026-11-14',
		startDate: '2026-12-05',
		endDate: '2027-02-27',
		feedbackDeadline: '2027-03-13'
	};

	it('stores dates as the official moments; scoring opens when applications close', async () => {
		const { t, admin } = await setupAdmin();
		const seasonId = await admin.mutation(api.seasons.adminSaveSeason, winter);
		const season = await t.run(async (ctx) => await ctx.db.get(seasonId));
		expect(season).toMatchObject({
			applicationDeadline: Date.parse('2026-11-07T23:55:00Z'),
			reviewWindowOpen: Date.parse('2026-11-07T23:55:00Z'),
			reviewWindowClose: Date.parse('2026-11-14T23:55:00Z'),
			startDate: Date.parse('2026-12-05T00:00:00Z'),
			endDate: Date.parse('2027-02-27T23:55:00Z'),
			feedbackDeadline: Date.parse('2027-03-13T23:55:00Z')
		});

		await admin.mutation(api.seasons.adminSaveSeason, {
			...winter,
			seasonId,
			reviewWindowClose: '2026-11-15'
		});
		const updated = await t.run(async (ctx) => await ctx.db.get(seasonId));
		expect(updated?.reviewWindowClose).toBe(Date.parse('2026-11-15T23:55:00Z'));
	});

	it('rejects dates out of order and two seasons closing the same day', async () => {
		const { admin } = await setupAdmin();
		await expect(
			admin.mutation(api.seasons.adminSaveSeason, { ...winter, reviewWindowClose: '2026-11-07' })
		).rejects.toThrow(/after applications close/);
		await expect(
			admin.mutation(api.seasons.adminSaveSeason, { ...winter, startDate: '2026-11-14' })
		).rejects.toThrow(/start after the scoring deadline/);
		await admin.mutation(api.seasons.adminSaveSeason, winter);
		await expect(
			admin.mutation(api.seasons.adminSaveSeason, { ...winter, name: 'Duplicate' })
		).rejects.toThrow(/already closes applications/);
	});

	it('is admin-only', async () => {
		const { t } = await setupAdmin();
		await t.run(async (ctx) => {
			await ctx.db.insert('profiles', {
				authUserId: 'adult-user',
				isVerified: true,
				firstLoginCompleted: true,
				updatedAt: Date.now()
			});
		});
		await expect(
			t.withIdentity({ subject: 'adult-user' }).mutation(api.seasons.adminSaveSeason, winter)
		).rejects.toThrow();
	});
});

describe('getApplicationIntakeSeason', () => {
	it('is the season with the earliest application deadline still ahead', async () => {
		const t = convexTest(schema, modules);
		const now = Date.now();
		const [past, next] = await t.run(async (ctx) => {
			const base = {
				reviewWindowOpen: now,
				reviewWindowClose: now + DAY,
				startDate: now + 2 * DAY,
				endDate: now + 3 * DAY,
				feedbackDeadline: now + 4 * DAY,
				createdAt: now,
				updatedAt: now
			};
			const pastId = await ctx.db.insert('seasons', {
				...base,
				name: 'Past',
				applicationDeadline: now - DAY
			});
			const nextId = await ctx.db.insert('seasons', {
				...base,
				name: 'Next',
				applicationDeadline: now + DAY
			});
			await ctx.db.insert('seasons', {
				...base,
				name: 'Later',
				applicationDeadline: now + 90 * DAY
			});
			await ctx.db.insert('seasons', { ...base, name: 'Bootstrap (no deadline)' });
			return [pastId, nextId];
		});
		const intake = await t.run(async (ctx) => await getApplicationIntakeSeason(ctx, now));
		expect(intake?._id).toBe(next);
		expect(intake?._id).not.toBe(past);
	});
});

describe('sendClosingSoonReminders', () => {
	it('dry run lists who gets what and why, and sends or writes nothing', async () => {
		const { t } = await seed();
		const result = await run(t, true);

		expect(result.season).toBe('Winter 2026');
		expect(sendEmailMock).not.toHaveBeenCalled();
		const byApplicant = Object.fromEntries(result.reminders.map((row) => [row.applicant, row]));
		expect(byApplicant['Ada']).toMatchObject({ audience: 'self', to: 'adult@example.com' });
		expect(byApplicant['kiddo']).toMatchObject({ audience: 'parent', to: 'parent@example.com' });
		expect(byApplicant['Pia']).toMatchObject({
			audience: 'parent_pending',
			to: 'pending-parent@example.com'
		});
		expect(byApplicant['Sam']).toMatchObject({ skipReason: 'has_submitted_application' });
		expect(byApplicant['Sus']).toMatchObject({ skipReason: 'suspended' });
		expect(byApplicant['teen']).toMatchObject({ audience: 'self', to: 'teen@example.com' });
		expect(byApplicant['solo']).toMatchObject({ skipReason: 'no_address' });
		expect(result).toMatchObject({ toSend: 4, skipped: 3 });
		// The dry run never exposes the consent token.
		expect(JSON.stringify(result)).not.toContain('pending-consent-token');

		const writes = await t.run(async (ctx) => ({
			deliveries: await ctx.db.query('emailDeliveries').collect(),
			reminded: (await ctx.db.query('clubApplications').collect()).filter((a) => a.reminders)
		}));
		expect(writes).toEqual({ deliveries: [], reminded: [] });
	});

	it('sends each reminder once with the right wording, links and unsubscribe headers', async () => {
		const { t, seasonId, deadline, adultApplicationId } = await seed();
		const result = await run(t, false);
		expect(result).toMatchObject({ sent: 4, failed: 0 });

		const emails = sentEmails();
		const adult = emails.find((email) => email.to === 'adult@example.com')!;
		expect(adult.type).toBe('application-reminder');
		expect(adult.subject).toBe(
			`Your club application closes ${formatSeasonDeadline(deadline!).split(',')[0]}`
		);
		expect(adult.text).toContain(formatSeasonDeadline(deadline!));
		expect(adult.text).toContain('https://app.example.com/new-club/start?step=2');
		expect(adult.text).toMatch(/https:\/\/app\.example\.com\/email\/unsubscribe\?t=\S+/);
		expect(adult.headers?.['List-Unsubscribe']).toMatch(
			/^<https:\/\/site\.example\.com\/email\/unsubscribe\?t=\S+>$/
		);
		expect(adult.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

		const parent = emails.find((email) => email.to === 'parent@example.com')!;
		expect(parent.subject).toContain("kiddo's club application closes");
		expect(parent.text).toContain('signing in with their username');

		const pendingParent = emails.find((email) => email.to === 'pending-parent@example.com')!;
		expect(pendingParent.subject).toBe("Pia's club application is waiting for your approval");
		expect(pendingParent.text).toContain(
			'https://app.example.com/onboarding/parent-consent/pending-consent-token'
		);

		const state = await t.run(async (ctx) => ({
			application: await ctx.db.get(adultApplicationId),
			deliveries: await ctx.db.query('emailDeliveries').collect()
		}));
		expect(state.application?.reminders?.closingSoonSeasonId).toBe(seasonId);
		expect(state.deliveries.filter((row) => row.status === 'sent')).toHaveLength(4);
		expect(
			state.deliveries
				.filter((row) => row.status === 'skipped')
				.map((row) => row.skipReason)
				.sort()
		).toEqual(['has_submitted_application', 'no_address', 'suspended']);

		// A second run sends nothing new.
		sendEmailMock.mockClear();
		const again = await run(t, false);
		expect(sendEmailMock).not.toHaveBeenCalled();
		expect(again.sent).toBe(0);
	});

	it('a failed send is logged and left owed, so the next run retries it', async () => {
		const { t, adultApplicationId } = await seed();
		sendEmailMock.mockImplementation(async (args: unknown) => {
			if ((args as SentEmail).to === 'adult@example.com')
				throw new Error('Resend send failed: 500');
			return { providerMessageId: 'ok' };
		});
		const result = await run(t, false);
		expect(result).toMatchObject({ sent: 3, failed: 1 });
		const state = await t.run(async (ctx) => ({
			application: await ctx.db.get(adultApplicationId),
			failed: (await ctx.db.query('emailDeliveries').collect()).filter(
				(row) => row.status === 'failed'
			)
		}));
		expect(state.application?.reminders?.closingSoonSeasonId).toBeUndefined();
		expect(state.failed).toMatchObject([
			{ to: 'adult@example.com', error: 'Resend send failed: 500' }
		]);

		sendEmailMock.mockReset();
		sendEmailMock.mockResolvedValue({ providerMessageId: 'ok' });
		const retry = await run(t, false);
		expect(retry.sent).toBe(1);
		expect(sentEmails().map((email) => email.to)).toEqual(['adult@example.com']);
	});

	it('refuses to run without a season taking applications', async () => {
		const { t } = await seed({ deadlineInMs: null });
		await expect(run(t, true)).rejects.toThrow(/No season is taking applications/);
	});

	it('refuses a real run when unsubscribe links cannot be built', async () => {
		const { t } = await seed();
		vi.stubEnv('BETTER_AUTH_SECRET', '');
		await expect(run(t, false)).rejects.toThrow(/Unsubscribe links cannot be built/);
		expect(sendEmailMock).not.toHaveBeenCalled();
	});
});

describe('unsubscribe', () => {
	it('tokens round-trip and forged ones are rejected', async () => {
		const token = (await createUnsubscribeToken('application_reminder', 'Adult@Example.com'))!;
		expect(await verifyUnsubscribeToken(token)).toEqual({
			kind: 'application_reminder',
			email: 'adult@example.com'
		});
		const [payload] = token.split('.');
		expect(await verifyUnsubscribeToken(`${payload}.forged`)).toBeNull();
		expect(await verifyUnsubscribeToken('garbage')).toBeNull();
	});

	it('the page link unsubscribes without signing in, and reminders then skip that address', async () => {
		const { t } = await seed();
		const token = (await createUnsubscribeToken('application_reminder', 'adult@example.com'))!;
		expect(await t.query(api.emailUnsubscribe.describeUnsubscribeToken, { token })).toEqual({
			kind: 'application_reminder',
			maskedEmail: 'a••••@example.com',
			alreadyUnsubscribed: false
		});
		await t.mutation(api.emailUnsubscribe.unsubscribe, { token });
		await t.mutation(api.emailUnsubscribe.unsubscribe, { token }); // idempotent
		expect(
			(await t.query(api.emailUnsubscribe.describeUnsubscribeToken, { token }))?.alreadyUnsubscribed
		).toBe(true);

		const result = await run(t, true);
		expect(result.reminders.find((row) => row.applicant === 'Ada')).toMatchObject({
			skipReason: 'unsubscribed'
		});
		expect(
			await t.run(async (ctx) => (await ctx.db.query('emailSuppressions').collect()).length)
		).toBe(1);
	});

	it('the List-Unsubscribe one-click POST unsubscribes; a bad token does not', async () => {
		const { t } = await seed();
		const token = (await createUnsubscribeToken('application_reminder', 'parent@example.com'))!;
		const bad = await t.fetch('/email/unsubscribe?t=nope', { method: 'POST' });
		expect(bad.status).toBe(400);
		const ok = await t.fetch(`/email/unsubscribe?t=${encodeURIComponent(token)}`, {
			method: 'POST',
			body: 'List-Unsubscribe=One-Click'
		});
		expect(ok.status).toBe(200);
		const suppressions = await t.run(
			async (ctx) => await ctx.db.query('emailSuppressions').collect()
		);
		expect(suppressions).toMatchObject([
			{ email: 'parent@example.com', kind: 'application_reminder', source: 'one_click' }
		]);
	});
});
