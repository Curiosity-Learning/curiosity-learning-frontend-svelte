import { replaceState } from '$app/navigation';

// Rewrites the address bar without navigating, from a component's `onMount`.
//
// SvelteKit's `replaceState` cannot be called while the first page is still hydrating: `onMount`
// runs before the router has started. In dev it throws "Cannot call replaceState(...) before
// router is initialized"; in a production build it fails on the not-yet-assigned root component
// and the page stops rendering. That is exactly the case for a link opened from an email, which
// is always a first page load.
//
// The router finishes starting within the task that hydrates the page, so one macrotask later is
// safe on a first load and harmless after a client-side navigation. `isStillCurrent` lets the
// caller skip the rewrite if the visitor has already moved on.
export const replaceUrlAfterRouterStart = (
	url: string,
	isStillCurrent: () => boolean = () => true
) => {
	setTimeout(() => {
		if (!isStillCurrent()) return;
		replaceState(url, {});
	}, 0);
};
