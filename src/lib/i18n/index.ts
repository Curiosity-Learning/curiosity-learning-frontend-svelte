import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { derived, writable } from 'svelte/store';
import en from './messages/en';
import nl from './messages/nl';

export type SupportedLocale = 'en' | 'nl';

const DEFAULT_LOCALE: SupportedLocale = 'en';
const LOCALE_STORAGE_KEY = 'cl_locale';

const messages = {
	en,
	nl
} as const;

const localeStore = writable<SupportedLocale>(DEFAULT_LOCALE);

const normalizeLocale = (value: string | null | undefined): SupportedLocale | null => {
	if (!value) return null;
	const normalized = value.trim().toLowerCase();
	if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
	if (normalized === 'nl' || normalized.startsWith('nl-')) return 'nl';
	return null;
};

const getNestedValue = (value: unknown, key: string): string | null => {
	const resolved = key.split('.').reduce<unknown>((current, part) => {
		if (!current || typeof current !== 'object' || !(part in current)) {
			return null;
		}
		return (current as Record<string, unknown>)[part];
	}, value);

	return typeof resolved === 'string' ? resolved : null;
};

const detectInitialLocale = (): SupportedLocale => {
	if (!browser) return DEFAULT_LOCALE;

	const stored = normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
	if (stored) return stored;

	const candidates = [navigator.language, ...(navigator.languages ?? [])];
	for (const candidate of candidates) {
		const normalized = normalizeLocale(candidate);
		if (normalized) {
			return normalized;
		}
	}

	return DEFAULT_LOCALE;
};

export const initI18n = () => {
	if (!browser) return () => {};

	const initialLocale = detectInitialLocale();
	localeStore.set(initialLocale);

	const unsubscribe = localeStore.subscribe((value) => {
		document.documentElement.lang = value;
		localStorage.setItem(LOCALE_STORAGE_KEY, value);
	});

	return unsubscribe;
};

export const setAppLocale = (value: SupportedLocale) => {
	localeStore.set(value);
};

export const locale = {
	subscribe: localeStore.subscribe
};

export const _ = derived(localeStore, ($locale) => {
	return (key: string) =>
		getNestedValue(messages[$locale], key) ??
		getNestedValue(messages[DEFAULT_LOCALE], key) ??
		key;
});

export const t = (key: string) => get(_)(key);

export const formatT = (key: string, variables: Record<string, string | number>) => {
	let template = t(key);
	for (const [variable, value] of Object.entries(variables)) {
		template = template.replaceAll(`{${variable}}`, String(value));
	}
	return template;
};
