export const PAGE_HEADER_CTX = Symbol('page-header');

export type HeaderActionsOverride = import('svelte').Snippet | false | null;
export type HeaderBannerOverride = import('svelte').Snippet | null;
export type HeaderSearchMode = 'auto' | 'collapsible' | 'inline' | 'overlay';
export type HeaderSearchConfig = {
	value: string;
	onValueChange(value: string): void;
	placeholder?: string;
	ariaLabel?: string;
	mode?: HeaderSearchMode;
};
export type HeaderSearchOverride = HeaderSearchConfig | null;
export type HeaderBackConfig = {
	fallbackHref?: string;
	ariaLabel?: string;
	preferFallback?: boolean;
} | null;
export type HeaderTitleOverride = string | null;
export type HeaderTitleContentOverride = import('svelte').Snippet | null;
export type BottomNavHiddenOverride = boolean | null;
export type PageContentMode = 'scroll' | 'viewport';
export type PageContentModeOverride = PageContentMode | null;

export type PageHeaderController = {
	setActions(value: HeaderActionsOverride): void;
	clearActions(): void;
	setSearch(value: HeaderSearchOverride): void;
	clearSearch(): void;
	setBanner(value: HeaderBannerOverride): void;
	clearBanner(): void;
	setBackConfig(value: HeaderBackConfig): void;
	clearBackConfig(): void;
	setTitle(value: HeaderTitleOverride): void;
	clearTitle(): void;
	setTitleContent(value: HeaderTitleContentOverride): void;
	clearTitleContent(): void;
	setBottomNavHidden(value: BottomNavHiddenOverride): void;
	clearBottomNavHidden(): void;
	setContentMode(value: PageContentModeOverride): void;
	clearContentMode(): void;
};
