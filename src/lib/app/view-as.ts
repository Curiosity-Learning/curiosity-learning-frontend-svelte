import { getContext } from 'svelte';
import type { ConvexClient } from 'convex/browser';
import { goto } from '$app/navigation';
import { api } from '$convex/_generated/api';
import type { Id } from '$convex/_generated/dataModel';
import { isViewAsReadOnlyError } from '$lib/domain/view-as';
import { t } from '$lib/i18n';

// Parent "View as Child" (CL-801), client side. The server does the real work (queries answer as
// the child, every write is refused, see src/convex/functions.ts); this module only lets pages
// hide write controls while a view is on, and turns the server's refusal into a plain sentence.

export const VIEW_AS_CTX = Symbol('view-as');

export type ViewAsContext = {
	readonly isViewingAsChild: boolean;
	readonly viewingChildName: string | null;
};

const NOT_VIEWING: ViewAsContext = { isViewingAsChild: false, viewingChildName: null };

/** Pages outside the (app) layout get the "not viewing" default. */
export const getViewAsContext = (): ViewAsContext =>
	getContext<ViewAsContext | undefined>(VIEW_AS_CTX) ?? NOT_VIEWING;

const translated = new WeakSet<ConvexClient>();

/**
 * Pages show `error.message` from failed mutations, which for a refused write is a raw server
 * dump. Wraps the shared client once so that refusal surfaces as one translated sentence.
 */
export const translateViewAsErrors = (client: ConvexClient) => {
	if (translated.has(client)) return;
	translated.add(client);
	const wrap = <Fn extends (...args: never[]) => Promise<unknown>>(call: Fn): Fn =>
		(async (...args: Parameters<Fn>) => {
			try {
				return await call(...args);
			} catch (error) {
				if (!isViewAsReadOnlyError(error)) throw error;
				// Keeps `data`, so isViewAsReadOnlyError still recognises it.
				throw Object.assign(new Error(t('viewAs.readOnlyError')), {
					data: (error as { data?: unknown }).data
				});
			}
		}) as Fn;
	client.mutation = wrap(client.mutation.bind(client));
	client.action = wrap(client.action.bind(client));
};

/**
 * Switches this session into viewing as `childProfileId` and lands on `to` (the child's home by
 * default: the current page may belong to a club or project the child is not part of).
 * invalidateAll re-runs the server loads (the club gate) as the child.
 */
export const startViewingAsChild = async (
	client: ConvexClient,
	childProfileId: Id<'profiles'>,
	{ to = '/', replaceState = false }: { to?: string; replaceState?: boolean } = {}
) => {
	await client.mutation(api.viewAs.startViewing, { childProfileId });
	await goto(to, { replaceState, invalidateAll: true });
};

/** Switches this session back to the parent's own account and lands on `to`. */
export const stopViewingAsChild = async (
	client: ConvexClient,
	{ to = '/', replaceState = false }: { to?: string; replaceState?: boolean } = {}
) => {
	await client.mutation(api.viewAs.stopViewing, {});
	await goto(to, { replaceState, invalidateAll: true });
};
