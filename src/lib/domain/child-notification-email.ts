// Stable error-code prefixes for the child notification email flow (CL-768), shared by the
// Convex backend (parentAccounts.setChildNotificationEmail, sessionFreshness.ts,
// childEmailVerification.ts) and the child page that turns them into translated messages.
// Pure constants only: Convex imports this file relatively.

// The session is older than the fresh-sign-in window: ask the parent to sign in again.
export const FRESH_SESSION_REQUIRED = 'FRESH_SESSION_REQUIRED';
// The address is the parent's own (edge case 1).
export const NOTIFICATION_EMAIL_IS_PARENT = 'NOTIFICATION_EMAIL_IS_PARENT';
// Too many confirmation emails for this child today.
export const RESEND_LIMIT_REACHED = 'RESEND_LIMIT_REACHED';

// Path of the page a confirmation email links to: /verify-email/{token}.
export const VERIFY_EMAIL_PATH_PREFIX = '/verify-email/';

export const hasErrorCode = (error: unknown, code: string) => {
	if (!error || typeof error !== 'object') return false;
	const data = (error as { data?: unknown }).data;
	if (typeof data === 'string' && data.startsWith(code)) return true;
	const message = (error as { message?: unknown }).message;
	return typeof message === 'string' && message.includes(code);
};
