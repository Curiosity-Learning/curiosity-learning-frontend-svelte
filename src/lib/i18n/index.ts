import { addMessages, init, locale, _ } from 'svelte-i18n';
import en from './messages/en';
import nl from './messages/nl';

export const SUPPORTED_LOCALES = ['en', 'nl'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const LOCALE_STORAGE_KEY = 'cl_locale';
const DEFAULT_LOCALE: SupportedLocale = 'en';

let initialized = false;

const normalizeLocale = (value: string | null | undefined): SupportedLocale | null => {
	if (!value) return null;
	const normalized = value.toLowerCase();
	if (normalized.startsWith('nl')) return 'nl';
	if (normalized.startsWith('en')) return 'en';
	return null;
};

const getStoredLocale = () => {
	if (typeof window === 'undefined') return null;
	return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
};

const getBrowserLocale = () => {
	if (typeof navigator === 'undefined') return null;
	const candidates = [navigator.language, ...(navigator.languages ?? [])];
	for (const candidate of candidates) {
		const normalized = normalizeLocale(candidate);
		if (normalized) return normalized;
	}
	return null;
};

const persistLocale = (value: SupportedLocale) => {
	if (typeof window === 'undefined') return;
	window.localStorage.setItem(LOCALE_STORAGE_KEY, value);
};

const applyDocumentLanguage = (value: string | null | undefined) => {
	if (typeof document === 'undefined') return;
	document.documentElement.lang = normalizeLocale(value) ?? DEFAULT_LOCALE;
};

export const initI18n = () => {
	if (initialized) return;

	addMessages('en', en);
	addMessages('nl', nl);

	const initialLocale = getStoredLocale() ?? getBrowserLocale() ?? DEFAULT_LOCALE;
	init({
		fallbackLocale: DEFAULT_LOCALE,
		initialLocale
	});
	persistLocale(initialLocale);
	applyDocumentLanguage(initialLocale);
	initialized = true;
};

export const setAppLocale = (value: string) => {
	const nextLocale = normalizeLocale(value) ?? DEFAULT_LOCALE;
	locale.set(nextLocale);
	persistLocale(nextLocale);
	applyDocumentLanguage(nextLocale);
};

export { locale, _ };
