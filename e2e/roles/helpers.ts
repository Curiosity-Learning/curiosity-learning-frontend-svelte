import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { passwordFor, type RoleAccount } from './accounts';

/**
 * Vercel branch previews sit behind Deployment Protection. Send the bypass secret once, on a
 * first request, and ask Vercel to set its bypass cookie. `context.request` shares the browser
 * context's cookie jar, so every later page load carries the cookie and nothing else (Convex,
 * Google, the media CDN) ever sees the header, which would break CORS.
 * https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
 */
export const isVercelPreviewUrl = (url: string | undefined) => {
	if (!url) return false;
	try {
		const { protocol, hostname } = new URL(url);
		return protocol === 'https:' && hostname.endsWith('.vercel.app');
	} catch {
		return false;
	}
};

export const primeVercelBypass = async (context: BrowserContext) => {
	const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
	if (!secret) return;
	// Only ever hand the secret to an HTTPS Vercel preview, never to localhost or another host.
	const baseURL = test.info().project.use.baseURL;
	if (!isVercelPreviewUrl(baseURL)) {
		throw new Error(
			`VERCEL_AUTOMATION_BYPASS_SECRET is set but the base URL (${baseURL}) is not an ` +
				'https://*.vercel.app preview. Unset the secret, or point E2E_BASE_URL at the preview.'
		);
	}
	const response = await context.request.get('/auth/sign-in', {
		headers: {
			'x-vercel-protection-bypass': secret,
			'x-vercel-set-bypass-cookie': 'true'
		},
		maxRedirects: 0
	});
	expect(response.status(), 'Vercel protection bypass was rejected').toBeLessThan(400);
};

/** Signs in through the real form with a password (email or child username). */
export const signInWithPassword = async (page: Page, account: RoleAccount, next?: string) => {
	const url = next ? `/auth/sign-in?next=${encodeURIComponent(next)}` : '/auth/sign-in';
	await page.goto(url);
	await page.locator('#email').fill(account.identifier);
	await page.locator('#password').fill(passwordFor(account));
	// Enter does not submit this form; the button does.
	await page.getByRole('button', { name: 'Log in', exact: true }).click();
	await page.waitForURL((target) => !target.pathname.startsWith('/auth/'), { timeout: 30_000 });
};

type ImageReport = {
	pending: number;
	broken: string[];
	signedLoaded: number;
};

const isSignedMediaUrl = (src: string) =>
	/[?&]Signature=/.test(src) && /[?&]Key-Pair-Id=/.test(src);

/**
 * Every visible `<img>` on the page must have decoded (`naturalWidth > 0`), and at least
 * `minSigned` of them must be signed CDN media. Hidden images (an avatar whose fallback took
 * over) are skipped: the user never sees them. Only images in the content column count, so the
 * shell's header and nav can neither mask nor fail a page's content images.
 */
export const expectImagesLoaded = async (page: Page, { minSigned = 0 } = {}) => {
	const report = async (): Promise<ImageReport> => {
		const images = await content(page)
			.locator('img')
			.evaluateAll((nodes) =>
				nodes.map((node) => {
					const img = node as HTMLImageElement;
					const rect = img.getBoundingClientRect();
					const style = window.getComputedStyle(img);
					return {
						src: img.currentSrc || img.src,
						visible:
							rect.width > 0 &&
							rect.height > 0 &&
							style.visibility !== 'hidden' &&
							style.display !== 'none',
						complete: img.complete,
						naturalWidth: img.naturalWidth
					};
				})
			);
		const visible = images.filter((image) => image.visible && image.src);
		return {
			pending: visible.filter((image) => !image.complete).length,
			broken: visible
				.filter((image) => image.complete && image.naturalWidth === 0)
				.map((image) => image.src.split('?')[0]),
			signedLoaded: visible.filter((image) => image.naturalWidth > 0 && isSignedMediaUrl(image.src))
				.length
		};
	};

	await expect
		.poll(async () => (await report()).pending, {
			message: 'images still loading',
			timeout: 15_000
		})
		.toBe(0);
	await expect
		.poll(async () => (await report()).signedLoaded, {
			message: `expected at least ${minSigned} loaded signed media image(s)`,
			timeout: 15_000
		})
		.toBeGreaterThanOrEqual(minSigned);
	const { broken } = await report();
	expect(broken, 'visible images that failed to load').toEqual([]);
};

/**
 * The page: the root layout's `<main id="main-content">`, which wraps the app shell. Page
 * titles, tab bars and actions (e.g. "Create session") render into the shell header, so UI
 * assertions use this.
 */
export const main = (page: Page) => page.locator('#main-content');

/**
 * The content column only (the app shell's own `<main>`, the innermost one), without the
 * header and nav. Image checks are scoped to it.
 */
export const content = (page: Page) => page.locator('main:not(:has(main))');

/**
 * Waits until no loading placeholder is left in the content column:
 * - "Loading …" text;
 * - anything labelled "Loading" through `aria-label`;
 * - any `role="status"` element (`LoadingState`, and `Spinner`, whatever label it carries);
 * - any `.animate-spin` icon.
 */
export const expectLoaded = async (page: Page) => {
	const placeholders = [
		content(page).getByText(/^Loading\b/),
		content(page).locator('[aria-label*="Loading" i]'),
		content(page).locator('[role="status"]'),
		content(page).locator('.animate-spin')
	];
	for (const placeholder of placeholders) {
		await expect(placeholder).toHaveCount(0, { timeout: 15_000 });
	}
};
