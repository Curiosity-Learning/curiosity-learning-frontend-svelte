import type { GenericActionCtx, GenericMutationCtx } from 'convex/server';
import { internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { action as rawAction, mutation as rawMutation } from './_generated/server';
import { resolveViewingAsChild, viewAsReadOnlyError } from './permissions';

// Parent "View as Child" (CL-801): the builders every PUBLIC mutation and action in src/convex is
// registered with (eslint forbids importing `mutation`/`action` from ./_generated/server
// anywhere else). While the caller's session is viewing as a child, each one is refused with the
// read-only error BEFORE its handler runs, whatever the handler does with the identity: nothing
// can be sent, changed or deleted while viewing, as the child or as the parent. See the
// permissions.ts header for how queries answer as the child.
//
// `parentScopedMutation` is the short, reviewed exception list: mutations a parent must still be
// able to run while viewing, which act on the parent's own account through `requireRealIdentity`
// and never as the child (start/stop viewing, Report Issue, parent-link sync). viewAs.spec.ts
// checks that every public mutation and action carries one of the two guards, and calls each
// one as a viewing parent.
//
// Internal functions (internalMutation/internalAction) are not wrapped: no client can call them,
// and the scheduler runs them without a user identity.

export type ViewAsGuard = 'refusedWhileViewing' | 'parentScoped';
export const VIEW_AS_GUARD = '__viewAsGuard';

type MutationCtx = GenericMutationCtx<DataModel>;
type ActionCtx = GenericActionCtx<DataModel>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (ctx: any, args: any) => any;
type Definition = AnyHandler | { handler: AnyHandler; [key: string]: unknown };

const refuseMutationWhileViewing = async (ctx: MutationCtx) => {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) return;
	if (await resolveViewingAsChild(ctx, identity)) throw viewAsReadOnlyError();
};

const refuseActionWhileViewing = async (ctx: ActionCtx) => {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) return;
	if (await ctx.runQuery(internal.viewAs.isCallerViewingAsChild, {})) throw viewAsReadOnlyError();
};

const withGuard = <Ctx>(
	definition: Definition,
	guard: ((ctx: Ctx) => Promise<void>) | null
): Definition => {
	const { handler, ...rest } =
		typeof definition === 'function' ? { handler: definition } : definition;
	if (!guard) return { ...rest, handler };
	return {
		...rest,
		handler: async (ctx: Ctx, args: unknown) => {
			await guard(ctx);
			return handler(ctx, args);
		}
	};
};

const tag = <T>(registered: T, guard: ViewAsGuard): T => {
	Object.defineProperty(registered, VIEW_AS_GUARD, { value: guard, enumerable: false });
	return registered;
};

/** Public mutation, refused while the caller is viewing as a child. */
export const mutation = ((definition: Definition) =>
	tag(
		rawMutation(withGuard(definition, refuseMutationWhileViewing) as never),
		'refusedWhileViewing'
	)) as typeof rawMutation;

/** Public action, refused while the caller is viewing as a child. */
export const action = ((definition: Definition) =>
	tag(
		rawAction(withGuard(definition, refuseActionWhileViewing) as never),
		'refusedWhileViewing'
	)) as typeof rawAction;

/**
 * Public mutation that keeps working while viewing as a child. Only for the parent's own
 * account; the handler must read the identity with `requireRealIdentity`. Adding one is a
 * security decision: list it in docs/security.md ("View as Child") and in viewAs.spec.ts.
 */
export const parentScopedMutation = ((definition: Definition) =>
	tag(rawMutation(withGuard(definition, null) as never), 'parentScoped')) as typeof rawMutation;
