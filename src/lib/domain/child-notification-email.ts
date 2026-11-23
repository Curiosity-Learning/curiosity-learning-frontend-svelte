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

// A 16+ child tried to unlink their parent without a confirmed address of their own (CL-769,
// review D4): important notices would then reach nobody.
export const UNLINK_REQUIRES_CONFIRMED_EMAIL = 'UNLINK_REQUIRES_CONFIRMED_EMAIL';
// A child with no linked parent tried to remove their own address (same reason).
export const OWN_EMAIL_REQUIRED = 'OWN_EMAIL_REQUIRED';

// Path of the page a confirmation email links to: /verify-email/{token}.
export const VERIFY_EMAIL_PATH_PREFIX = '/verify-email/';

export const hasErrorCode = (error: unknown, code: string) => {
	if (!error || typeof error !== 'object') return false;
	const data = (error as { data?: unknown }).data;
	if (typeof data === 'string' && data.startsWith(code)) return true;
	const message = (error as { message?: unknown }).message;
	return typeof message === 'string' && message.includes(code);
};

// CL-801: a parent's settings for a child (the child's notification email, the parent's own
// copies) live in the parent's Settings ("Your children" card, #child-notifications). Emails link
// there through /child/{id}?settings=emails, which first switches the session back to the parent
// in case it was viewing as a child, then opens that card.
export const CHILD_SETTINGS_PARAM = 'settings';
export const CHILD_SETTINGS_EMAILS_VALUE = 'emails';
export const CHILD_NOTIFICATIONS_ANCHOR = 'child-notifications';
export const childEmailSettingsPath = (childProfileId: string) =>
	`/child/${childProfileId}?${CHILD_SETTINGS_PARAM}=${CHILD_SETTINGS_EMAILS_VALUE}`;
