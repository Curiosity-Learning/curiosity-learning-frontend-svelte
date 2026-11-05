import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendEmail } from './resend';

vi.mock('../monitoring', () => ({ reportConvexError: vi.fn(async () => undefined) }));

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe('sendEmail', () => {
	// Review edge case 16: a child's synthetic auth address is not an inbox.
	it('refuses synthetic child addresses without calling Resend, failing like any send', async () => {
		vi.stubEnv('RESEND_API_KEY', 're_test');
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			sendEmail({
				to: 'Kiddo@Children.Curiosity.Local',
				type: 'magic-link',
				subject: 'Your sign-in link',
				html: '<p>hi</p>',
				text: 'hi'
			})
		).rejects.toThrow(/synthetic child address/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('sends anything else to Resend', async () => {
		vi.stubEnv('RESEND_API_KEY', 're_test');
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'msg-1' })));
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			sendEmail({
				to: 'parent@example.com',
				type: 'notification',
				subject: 'Hi',
				html: '<p>hi</p>',
				text: 'hi'
			})
		).resolves.toEqual({ providerMessageId: 'msg-1' });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
