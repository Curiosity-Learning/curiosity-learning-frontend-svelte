// Parent "View as Child" (CL-801): the read-only error shared by the Convex backend
// (permissions.ts, functions.ts) and the app, which turns it into a plain sentence.
// Pure constants and a pure check only: Convex imports this file relatively.

export const VIEW_AS_READ_ONLY_CODE = 'VIEW_AS_READ_ONLY';
export const VIEW_AS_READ_ONLY_MESSAGE =
	"You're viewing as your child. Switch back to your account to make changes.";

/** True for the error every mutation and action throws while a parent is viewing as a child. */
export const isViewAsReadOnlyError = (error: unknown) => {
	if (!error || typeof error !== 'object') return false;
	const data = (error as { data?: unknown }).data;
	if (
		data &&
		typeof data === 'object' &&
		(data as { code?: unknown }).code === VIEW_AS_READ_ONLY_CODE
	)
		return true;
	const message = (error as { message?: unknown }).message;
	return typeof message === 'string' && message.includes(VIEW_AS_READ_ONLY_CODE);
};
