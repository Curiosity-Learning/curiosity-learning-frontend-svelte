export const PAGE_HEADER_CTX = Symbol('page-header');

export type HeaderActionsOverride = import('svelte').Snippet | false | null;
export type HeaderBannerOverride = import('svelte').Snippet | null;
export type HeaderBackConfig = {
	fallbackHref?: string;
	ariaLabel?: string;
} | null;
export type HeaderTitleOverride = string | null;

export type PageHeaderController = {
	setActions(value: HeaderActionsOverride): void;
	clearActions(): void;
	setBanner(value: HeaderBannerOverride): void;
	clearBanner(): void;
	setBackConfig(value: HeaderBackConfig): void;
	clearBackConfig(): void;
	setTitle(value: HeaderTitleOverride): void;
	clearTitle(): void;
};
