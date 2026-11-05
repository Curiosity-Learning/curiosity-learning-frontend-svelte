import { getContext } from 'svelte';
import { ConvexError } from 'convex/values';
import type { ConvexClient } from 'convex/browser';

// CL-734 "View as Child", client side. The server does the real work (queries answer as the
// child, writes are refused — see src/convex/permissions.ts); this module only lets pages hide
// write affordances while a view is active, and turns the server's refusal into a plain message.

export const VIEW_AS_CTX = Symbol('view-as');

export type ViewAsContext = {
	readonly isViewingAsChild: boolean;
};

const NOT_VIEWING: ViewAsContext = { isViewingAsChild: false };

/** Pages outside the (app) layout get the "not viewing" default. */
export const getViewAsContext = (): ViewAsContext =>
	getContext<ViewAsContext | undefined>(VIEW_AS_CTX) ?? NOT_VIEWING;

// Mirrors VIEW_AS_READ_ONLY_CODE in src/convex/permissions.ts (not imported: that module pulls
// in server-only Convex code).
const VIEW_AS_READ_ONLY_CODE = 'VIEW_AS_READ_ONLY';

export const getViewAsReadOnlyMessage = (error: unknown): string | null => {
	if (!(error instanceof ConvexError)) return null;
	const data = error.data as { code?: unknown; message?: unknown } | null;
	if (data?.code !== VIEW_AS_READ_ONLY_CODE) return null;
	return typeof data.message === 'string' ? data.message : null;
};

const translated = new WeakSet<ConvexClient>();

/**
 * Pages show `error.message` from failed mutations, which for a refused write is a raw server
 * dump. Wraps the shared client once so that refusal surfaces as its plain sentence instead.
 */
export const translateViewAsErrors = (client: ConvexClient) => {
	if (translated.has(client)) return;
	translated.add(client);
	const wrap = <Fn extends (...args: never[]) => Promise<unknown>>(call: Fn): Fn =>
		(async (...args: Parameters<Fn>) => {
			try {
				return await call(...args);
			} catch (error) {
				const message = getViewAsReadOnlyMessage(error);
				throw message ? new Error(message) : error;
			}
		}) as Fn;
	client.mutation = wrap(client.mutation.bind(client));
	client.action = wrap(client.action.bind(client));
};
