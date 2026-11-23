// Where a signed-in visitor of an /auth/* page is sent: their `next`, if it is a path on this
// site. A value with two leading slashes (`//evil.com`) or a backslash (`/\evil.com`, which
// browsers treat like `//`) would resolve to another origin (open redirect), as would anything
// with control characters, so all of those fall back to home. Auth pages and the get-started
// page would loop or are pointless after sign-in.
export const normalizeAuthRedirectTarget = (nextPath: string | null) => {
	if (!nextPath || !nextPath.startsWith('/')) return '/';
	if (nextPath.startsWith('//') || nextPath.includes('\\')) return '/';
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f]/.test(nextPath)) return '/';
	// Belt and braces: whatever survives must still resolve to the same origin.
	const base = 'https://same-origin.invalid';
	try {
		if (new URL(nextPath, base).origin !== base) return '/';
	} catch {
		return '/';
	}
	if (nextPath.startsWith('/auth/')) return '/';
	if (nextPath === '/onboarding/get-started') return '/';
	return nextPath;
};
