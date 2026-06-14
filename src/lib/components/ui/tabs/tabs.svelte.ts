import { Context } from 'runed';
import { crossfade } from 'svelte/transition';
import type { ReadableBoxedValues, WritableBoxedValues } from 'svelte-toolbelt';

export const [send, receive] = crossfade({
	duration: (distance) => Math.sqrt(distance * 200)
});

type TabsRootProps = WritableBoxedValues<{
	value: string;
}> &
	ReadableBoxedValues<{
		id: string;
	}>;

class TabsRootState {
	constructor(readonly opts: TabsRootProps) {}
}

type TabsTriggerProps = ReadableBoxedValues<{
	value: string;
}>;

class TabsTriggerState {
	constructor(
		readonly opts: TabsTriggerProps,
		readonly rootState: TabsRootState
	) {}

	props = $derived.by(() => ({
		value: this.opts.value.current
	}));
}

const ctx = new Context<TabsRootState>('tabs-root-ctx');

export function useTabs(opts: TabsRootProps) {
	return ctx.set(new TabsRootState(opts));
}

export function useTabsTrigger(opts: TabsTriggerProps) {
	return new TabsTriggerState(opts, ctx.get());
}
