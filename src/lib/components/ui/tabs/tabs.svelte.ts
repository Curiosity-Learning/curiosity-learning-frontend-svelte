import { Tabs as TabsPrimitive } from 'bits-ui';
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
	hoveredTab = $state<string | null>(null);
	isHovered = $state(false);

	constructor(readonly opts: TabsRootProps) {
		this.hoveredTab = this.opts.value.current;
	}
}

type TabsTriggerProps = ReadableBoxedValues<{
	value: string;
	onmouseenter: TabsPrimitive.TriggerProps['onmouseenter'];
	onmouseleave: TabsPrimitive.TriggerProps['onmouseleave'];
	onfocus: TabsPrimitive.TriggerProps['onfocus'];
	onblur: TabsPrimitive.TriggerProps['onblur'];
}>;

class TabsTriggerState {
	constructor(
		readonly opts: TabsTriggerProps,
		readonly rootState: TabsRootState
	) {}

	handleFocus() {
		this.rootState.isHovered = true;
		this.rootState.hoveredTab = this.opts.value.current;
	}

	handleBlur() {
		if (this.rootState.hoveredTab === this.opts.value.current) {
			this.rootState.isHovered = false;
		}
	}

	onmouseenter(event: Parameters<NonNullable<TabsPrimitive.TriggerProps['onmouseenter']>>[0]) {
		this.handleFocus();
		this.opts.onmouseenter.current?.(event);
	}

	onmouseleave(event: Parameters<NonNullable<TabsPrimitive.TriggerProps['onmouseleave']>>[0]) {
		this.handleBlur();
		this.opts.onmouseleave.current?.(event);
	}

	onfocus(event: Parameters<NonNullable<TabsPrimitive.TriggerProps['onfocus']>>[0]) {
		this.handleFocus();
		this.opts.onfocus.current?.(event);
	}

	onblur(event: Parameters<NonNullable<TabsPrimitive.TriggerProps['onblur']>>[0]) {
		this.handleBlur();
		this.opts.onblur.current?.(event);
	}

	props = $derived.by(() => ({
		value: this.opts.value.current,
		onmouseenter: this.onmouseenter.bind(this),
		onmouseleave: this.onmouseleave.bind(this),
		onfocus: this.onfocus.bind(this),
		onblur: this.onblur.bind(this)
	}));
}

const ctx = new Context<TabsRootState>('tabs-root-ctx');

export function useTabs(opts: TabsRootProps) {
	return ctx.set(new TabsRootState(opts));
}

export function useTabsTrigger(opts: TabsTriggerProps) {
	return new TabsTriggerState(opts, ctx.get());
}
