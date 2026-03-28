<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { _ } from '$lib/i18n';

	const STORAGE_KEY = 'cl_cookie_preferences_v1';
	const COOKIE_NAME = 'cl_cookie_preferences';
	const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

	type CookiePreferences = {
		essential: true;
		functional: boolean;
	};

	const TARGET_PATH = '/onboarding/get-started';
	const SHOW_DELAY_MS = 1500;

	let visible = $state(false);
	let ready = $state(false);
	let showTimer: ReturnType<typeof setTimeout> | null = null;
	let currentPath = $derived(page.url.pathname);

	const normalizeConsent = (value: string | null): CookiePreferences | null => {
		if (value === 'essential_only' || value === 'declined') {
			return { essential: true, functional: false };
		}
		if (value === 'essential_functional' || value === 'accepted') {
			return { essential: true, functional: true };
		}
		return null;
	};

	const parseStoredJson = (value: string | null): CookiePreferences | null => {
		if (!value) return null;
		try {
			const parsed = JSON.parse(value) as Partial<CookiePreferences>;
			if (parsed.essential === true && typeof parsed.functional === 'boolean') {
				return {
					essential: true,
					functional: parsed.functional
				};
			}
			return null;
		} catch {
			return normalizeConsent(value);
		}
	};

	const toCookieValue = (preferences: CookiePreferences) =>
		preferences.functional ? 'essential_functional' : 'essential_only';

	const readConsentCookie = () => {
		if (typeof document === 'undefined') return null;
		const cookie = document.cookie
			.split('; ')
			.find((item) => item.startsWith(`${COOKIE_NAME}=`));
		if (!cookie) return null;
		const [, rawValue] = cookie.split('=');
		return normalizeConsent(rawValue ? decodeURIComponent(rawValue) : null);
	};

	const readStoredConsent = (): CookiePreferences | null => {
		if (typeof window === 'undefined') return null;
		const local = parseStoredJson(window.localStorage.getItem(STORAGE_KEY));
		return local ?? readConsentCookie();
	};

	const persistConsent = (preferences: CookiePreferences) => {
		if (typeof document !== 'undefined') {
			const secure = location.protocol === 'https:' ? '; Secure' : '';
			document.cookie = `${COOKIE_NAME}=${encodeURIComponent(toCookieValue(preferences))}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
		}
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
		}
	};

	const setConsent = (functional: boolean) => {
		persistConsent({ essential: true, functional });
		visible = false;
	};

	const clearShowTimer = () => {
		if (!showTimer) return;
		clearTimeout(showTimer);
		showTimer = null;
	};

	const scheduleBanner = () => {
		clearShowTimer();

		if (!ready) return;
		if (readStoredConsent() !== null) {
			visible = false;
			return;
		}

		if (currentPath !== TARGET_PATH) {
			visible = false;
			return;
		}

		showTimer = setTimeout(() => {
			visible = true;
			showTimer = null;
		}, SHOW_DELAY_MS);
	};

	onMount(() => {
		ready = true;
		scheduleBanner();
		return () => {
			clearShowTimer();
		};
	});

	$effect(() => {
		void currentPath;
		scheduleBanner();
	});
</script>

{#if ready && visible}
	<div
		class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6"
	>
		<div class="pointer-events-auto w-full max-w-3xl rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
			<div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div class="flex flex-col gap-2">
					<p class="type-field-label text-gray-900">{$_('legal.cookieBanner.title')}</p>
					<p class="text-sm leading-6 text-gray-600">
						{$_('legal.cookieBanner.descriptionStart')}
						<span class="font-semibold text-gray-900">{$_('legal.cookieBanner.essential')}</span>
						{$_('legal.cookieBanner.descriptionMiddle')}
						<span class="font-semibold text-gray-900">{$_('legal.cookieBanner.functional')}</span>
						{$_('legal.cookieBanner.descriptionAfterTypes')}
						<a href="/privacy" class="font-semibold text-orange-500 hover:text-orange-600"
							>{$_('legal.cookieBanner.privacyLink')}</a
						>
						{$_('legal.cookieBanner.betweenPrivacyAndTerms')}
						<a href="/terms" class="font-semibold text-orange-500 hover:text-orange-600"
							>{$_('legal.cookieBanner.termsLink')}</a
						>
						{$_('legal.cookieBanner.betweenTermsAndCookies')}
						<a href="/cookies" class="font-semibold text-orange-500 hover:text-orange-600"
							>{$_('legal.cookieBanner.cookiesLink')}</a
						>{$_('legal.cookieBanner.descriptionEnd')}
					</p>
				</div>

				<div class="flex flex-col gap-2 sm:flex-row">
					<Button variant="outline" class="h-10 w-full sm:w-auto" onclick={() => setConsent(false)}>
						{$_('legal.cookieBanner.essentialOnly')}
					</Button>
					<Button variant="default" class="h-10 w-full sm:w-auto" onclick={() => setConsent(true)}>
						{$_('legal.cookieBanner.allowFunctional')}
					</Button>
				</div>
			</div>
		</div>
	</div>
{/if}
