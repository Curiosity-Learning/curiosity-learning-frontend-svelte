import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { load } from './+layout.server';

type LoadEvent = Parameters<typeof load>[0];

const run = async (path: string, token: string | undefined) => {
	try {
		await load({ locals: { token }, url: new URL(`https://app.example.com${path}`) } as LoadEvent);
		return 'rendered';
	} catch (error) {
		if (isRedirect(error)) return `redirect ${error.location}`;
		throw error;
	}
};

describe('auth layout: signed-in visitors', () => {
	it('are sent to `next` from the sign-in page and the reset request form', async () => {
		expect(await run('/auth/sign-in?next=/settings', 'jwt')).toBe('redirect /settings');
		expect(await run('/auth/reset-password?next=/settings', 'jwt')).toBe('redirect /settings');
	});

	it("see the reset form when they follow a reset link (Settings' Set a password, review S1)", async () => {
		expect(await run('/auth/reset-password?next=/settings&token=abc', 'jwt')).toBe('rendered');
	});

	it('see the sign-in link interstitial and sign-up', async () => {
		expect(await run('/auth/link', 'jwt')).toBe('rendered');
		expect(await run('/auth/sign-up', 'jwt')).toBe('rendered');
	});

	it('signed-out visitors see every page', async () => {
		expect(await run('/auth/sign-in?next=/settings', undefined)).toBe('rendered');
	});
});
