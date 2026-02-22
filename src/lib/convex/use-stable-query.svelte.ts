import { useQuery as useConvexQuery } from 'convex-svelte';
import { getFunctionName } from 'convex/server';
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server';
import { convexToJson, type Value } from 'convex/values';

export type StableQueryMode = 'content' | 'gate';
export type StableQueryCacheMode = 'off' | 'memory';

export type UseStableQueryOptions<Query extends FunctionReference<'query'>> = {
	initialData?: FunctionReturnType<Query>;
	keepPreviousData?: boolean;
	mode?: StableQueryMode;
	cache?: StableQueryCacheMode;
};

const stableQueryMemoryCache: Record<string, unknown> = Object.create(null);

function resolveCacheArgs<Query extends FunctionReference<'query'>>(
	args?: FunctionArgs<Query> | 'skip' | (() => FunctionArgs<Query> | 'skip')
): FunctionArgs<Query> | 'skip' | null {
	try {
		const resolved =
			typeof args === 'function' ? (args as () => FunctionArgs<Query> | 'skip')() : args;
		if (resolved === 'skip') return 'skip';
		return resolved ?? ({} as FunctionArgs<Query>);
	} catch {
		return null;
	}
}

function getCacheKey<Query extends FunctionReference<'query'>>(
	query: Query,
	args: FunctionArgs<Query>
): string | null {
	try {
		return `${getFunctionName(query)}::${JSON.stringify(convexToJson(args as Value))}`;
	} catch {
		return null;
	}
}

export function useStableQuery<Query extends FunctionReference<'query'>>(
	query: Query,
	args?: FunctionArgs<Query> | 'skip' | (() => FunctionArgs<Query> | 'skip'),
	options?: UseStableQueryOptions<Query> | (() => UseStableQueryOptions<Query>)
) {
	const resolvedOptions = $derived(typeof options === 'function' ? options() : (options ?? {}));
	const cacheMode = $derived((resolvedOptions.cache ?? 'off') as StableQueryCacheMode);
	const resolvedMemoryArgs = $derived.by(() => {
		if (cacheMode !== 'memory') return null;
		return resolveCacheArgs(args);
	});
	const memoryCacheKey = $derived.by(() => {
		if (cacheMode !== 'memory') return null;
		if (!resolvedMemoryArgs || resolvedMemoryArgs === 'skip') return null;
		return getCacheKey(query, resolvedMemoryArgs);
	});

	const result = useConvexQuery(query, args, () => {
		const {
			initialData,
			mode = 'content',
			keepPreviousData,
			cache: _cache,
			...rest
		} = resolvedOptions;
		void _cache;
		let seededInitialData = initialData;

		if (seededInitialData === undefined && cacheMode === 'memory') {
			if (memoryCacheKey) {
				seededInitialData = stableQueryMemoryCache[memoryCacheKey] as
					| FunctionReturnType<Query>
					| undefined;
			}
		}

		return {
			...rest,
			initialData: seededInitialData,
			keepPreviousData: keepPreviousData ?? mode === 'content'
		};
	});

	$effect(() => {
		if (cacheMode !== 'memory') return;
		if (result.error || result.data === undefined) return;
		if (!memoryCacheKey) return;
		stableQueryMemoryCache[memoryCacheKey] = result.data;
	});

	return result;
}
