<script lang="ts">
	// CL-819 spike harness: one screen, one panel per real-phone acceptance check.
	import { onMount } from 'svelte';
	import { Capacitor } from '@capacitor/core';
	import { ConvexClient } from 'convex/browser';
	import { env } from '$env/dynamic/public';
	import { api } from '$convex/_generated/api';
	import { NATIVE_APP_ORIGINS } from '$convex/nativeAppAuth';
	import { createSpikeAuth, fetchConvexToken, type SpikeAuth } from '../lib/spike-auth';
	import {
		checkRevocation,
		createLinkDeduper,
		describeStorageError,
		redactPath,
		redactUrl
	} from '../lib/diagnostics';
	import { parseIncomingLink } from '../lib/deep-links';
	import { missingGoogleConfig, nativeGoogleIdToken } from '../lib/google';

	type Line = { at: string; text: string };
	type Media = { url: string; contentType: string | null; expiresAt: number } | null;

	const convexUrl = env.PUBLIC_CONVEX_URL ?? '';
	const siteUrl = env.PUBLIC_CONVEX_SITE_URL ?? '';
	// The web app's origin: where universal links (and the crossDomain siteUrl) live.
	const linkOrigin = env.PUBLIC_NATIVE_APP_LINK_ORIGIN ?? null;
	const googleIds = {
		webClientId: env.PUBLIC_GOOGLE_WEB_CLIENT_ID || undefined,
		iosClientId: env.PUBLIC_GOOGLE_IOS_CLIENT_ID || undefined
	};
	const platform = Capacitor.getPlatform();
	const origin = window.location.origin;
	const originIsNative = (NATIVE_APP_ORIGINS as readonly string[]).includes(origin);

	let auth = $state<SpikeAuth | null>(null);
	let startup = $state('starting…');
	let identifier = $state('');
	let password = $state('');
	let busy = $state(false);
	let sessionEmail = $state<string | null>(null);
	let wsAuthenticated = $state<boolean | null>(null);
	let liveUser = $state<string>('(no subscription yet)');
	let liveUpdatedAt = $state<string | null>(null);
	let revocation = $state<string>('not run yet');
	let googleStatus = $state<string>(missingGoogleConfig(platform, googleIds) ?? 'ready');
	let linkStatus = $state<string>('no link received yet');
	let lastLink = $state<string | null>(null);
	let mediaStatus = $state<string>('not loaded');
	let image = $state<Media>(null);
	let video = $state<Media>(null);
	let corsProbe = $state<string>('not run yet');
	let log = $state<Line[]>([]);
	let storageError = $state<string | null>(null);

	const links = createLinkDeduper();

	let convex: ConvexClient | null = null;
	let unsubscribe: (() => void) | null = null;

	const note = (text: string) => {
		log = [{ at: new Date().toLocaleTimeString(), text }, ...log].slice(0, 40);
	};
	const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

	const refreshSession = async () => {
		if (!auth) return;
		const { data } = await auth.authClient.getSession();
		sessionEmail = data?.user?.email ?? null;
		// Re-arm Convex auth: a new or cleared session means a new (or no) JWT.
		convex?.setAuth(
			async () => (auth ? await fetchConvexToken(auth) : null),
			(isAuthenticated) => {
				wsAuthenticated = isAuthenticated;
				note(`Convex WebSocket ${isAuthenticated ? 'authenticated' : 'not authenticated'}`);
			}
		);
	};

	const signIn = async (event: SubmitEvent) => {
		event.preventDefault();
		if (!auth) return;
		busy = true;
		try {
			const value = identifier.trim();
			const result = value.includes('@')
				? await auth.authClient.signIn.email({ email: value, password })
				: await auth.authClient.signIn.username({ username: value, password });
			if (result.error) {
				note(`Sign-in failed: ${result.error.message ?? result.error.statusText}`);
			} else {
				note('Signed in with password');
				password = '';
			}
			await auth.storage.flush();
			await refreshSession();
		} catch (error) {
			note(`Sign-in error: ${describe(error)}`);
		} finally {
			busy = false;
		}
	};

	const signOut = async () => {
		if (!auth) return;
		busy = true;
		try {
			const before = auth.authClient.getCookie();
			const signedOut = await auth.authClient.signOut();
			await auth.storage.flush();
			const check = await checkRevocation(siteUrl, before);
			revocation = signedOut.error
				? `ERROR: sign-out request failed (${signedOut.error.status ?? ''} ${signedOut.error.message ?? ''}); ${check.detail}`
				: check.status === 'revoked'
					? `PASS: ${check.detail} (session row revoked)`
					: check.status === 'still-live'
						? `FAIL: ${check.detail}`
						: `ERROR (not a pass): ${check.detail}`;
			note(`Signed out; ${revocation}`);
			await refreshSession();
		} catch (error) {
			note(`Sign-out error: ${describe(error)}`);
		} finally {
			busy = false;
		}
	};

	const signInWithGoogle = async () => {
		if (!auth) return;
		const missing = missingGoogleConfig(platform, googleIds);
		if (missing) {
			googleStatus = missing;
			return;
		}
		busy = true;
		try {
			googleStatus = 'opening Google…';
			const { idToken, nonce } = await nativeGoogleIdToken(googleIds);
			googleStatus = 'got an ID token; exchanging with Better Auth…';
			const result = await auth.authClient.signIn.social({
				provider: 'google',
				idToken: { token: idToken, nonce }
			});
			googleStatus = result.error
				? `Better Auth rejected the ID token: ${result.error.message ?? result.error.statusText}`
				: 'PASS: signed in with a native Google ID token (no redirect)';
			note(googleStatus);
			await auth.storage.flush();
			await refreshSession();
		} catch (error) {
			googleStatus = `Google sign-in error: ${describe(error)}`;
			note(googleStatus);
		} finally {
			busy = false;
		}
	};

	const handleLink = async (url: string) => {
		if (!auth) return;
		// iOS can hand over a cold-start link twice (appUrlOpen + getLaunchUrl): redeem it once.
		if (!links.claim(url)) {
			note('Duplicate delivery of the same link ignored');
			return;
		}
		lastLink = redactUrl(url);
		const link = parseIncomingLink(url, linkOrigin);
		note(`Link received (${link.kind})`);
		try {
			if (link.kind === 'one-time-token') {
				linkStatus = 'swapping the one-time token for a session…';
				const result = await auth.authClient.$fetch('/cross-domain/one-time-token/verify', {
					method: 'POST',
					body: { token: link.token }
				});
				linkStatus = result.error
					? `One-time token rejected: ${result.error.message ?? result.error.statusText}`
					: 'PASS: one-time token exchanged for a session';
			} else if (link.kind === 'magic-link') {
				linkStatus = 'verifying the sign-in link…';
				// No callbackURL: Better Auth answers with JSON (and Set-Better-Auth-Cookie) instead
				// of a redirect. A bad or used token redirects to the error page, which a
				// manual-redirect fetch sees as an opaque redirect.
				const result = await auth.authClient.$fetch('/magic-link/verify', {
					method: 'GET',
					query: { token: link.token },
					redirect: 'manual'
				});
				linkStatus = result.error
					? `Sign-in link rejected (expired or already used): ${result.error.message ?? result.error.status}`
					: `PASS: signed in from the emailed link (would continue to ${redactPath(link.next)})`;
			} else {
				linkStatus = `Ignored: ${link.reason}`;
			}
			note(linkStatus);
			await auth.storage.flush();
			await refreshSession();
		} catch (error) {
			linkStatus = `Link handling error: ${describe(error)}`;
			note(linkStatus);
		}
	};

	const sendSignInLink = async () => {
		if (!auth) return;
		const email = identifier.trim();
		if (!email.includes('@')) {
			linkStatus = 'Type your email address in section 1 first';
			return;
		}
		busy = true;
		try {
			const result = await auth.authClient.signIn.magicLink({ email });
			linkStatus = result.error
				? `Could not send the link: ${result.error.message ?? result.error.statusText}`
				: `Link sent to ${email}: open it in Mail on this phone`;
			note(linkStatus);
		} catch (error) {
			linkStatus = `Could not send the link: ${describe(error)}`;
		} finally {
			busy = false;
		}
	};

	const loadMedia = async () => {
		if (!convex) return;
		mediaStatus = 'signing…';
		try {
			const result = await convex.action(api.capacitorSpikeNode.signedMediaSample, {});
			image = result.image;
			video = result.video;
			mediaStatus = !result.cdnConfigured
				? 'CloudFront signing is not configured on this backend'
				: !image && !video
					? 'Signed in user has no ready image or video uploads'
					: `signed: image ${image ? 'yes' : 'no'}, video ${video ? 'yes' : 'no'}`;
		} catch (error) {
			mediaStatus = `Signing failed (signed in?): ${describe(error)}`;
		}
	};

	const probeCors = async () => {
		try {
			const response = await fetch(`${siteUrl}/api/auth/ok`, { credentials: 'omit' });
			corsProbe = `PASS: ${response.status}, Access-Control-Allow-Origin readable from ${origin}`;
		} catch (error) {
			corsProbe = `Blocked (CORS or network) from ${origin}: ${describe(error)}`;
		}
	};

	onMount(() => {
		let removeListener: (() => void) | null = null;
		let cancelled = false;
		(async () => {
			if (!convexUrl || !siteUrl) {
				startup = 'PUBLIC_CONVEX_URL / PUBLIC_CONVEX_SITE_URL missing from the spike build';
				return;
			}
			auth = await createSpikeAuth(siteUrl, (error) => {
				storageError = describeStorageError(error);
				if (storageError) note(storageError);
			});
			const hydratedCookie = auth.storage.getItem('better-auth_cookie');
			startup = `storage: ${auth.backend}; ${
				hydratedCookie && hydratedCookie !== '{}'
					? 'a session cookie was restored at launch'
					: 'no stored session at launch'
			}`;
			note(startup);
			convex = new ConvexClient(convexUrl);
			unsubscribe = convex.onUpdate(api.auth.getCurrentUser, {}, (user) => {
				liveUser = user ? `${user.email} (${user._id})` : 'null (not signed in)';
				liveUpdatedAt = new Date().toLocaleTimeString();
			});
			// Non-fatal: from a non-native origin CORS blocks this, and the probe below says so.
			await refreshSession().catch((error) => note(`get-session failed: ${describe(error)}`));
			if (Capacitor.isNativePlatform()) {
				const { App } = await import('@capacitor/app');
				const listener = await App.addListener('appUrlOpen', ({ url }) => void handleLink(url));
				removeListener = () => void listener.remove();
				if (cancelled) removeListener();
				const launch = await App.getLaunchUrl();
				if (launch?.url) await handleLink(launch.url);
			}
			await probeCors();
		})().catch((error) => {
			startup = `startup failed: ${describe(error)}`;
		});
		return () => {
			cancelled = true;
			removeListener?.();
			unsubscribe?.();
			void convex?.close();
		};
	});
</script>

<main>
	<h1>CL-819 Capacitor sign-in spike</h1>
	<p class="muted">{platform} · {startup}</p>
	{#if storageError}
		<p class="error">{storageError}</p>
	{/if}

	<section>
		<h2>1. Password sign-in + live Convex query</h2>
		<form onsubmit={signIn}>
			<label>
				Email or username
				<input bind:value={identifier} autocomplete="username" autocapitalize="off" />
			</label>
			<label>
				Password
				<input type="password" bind:value={password} autocomplete="current-password" />
			</label>
			<button type="submit" disabled={busy || !auth}>Sign in</button>
		</form>
		<dl>
			<dt>Better Auth session</dt>
			<dd>{sessionEmail ?? 'none'}</dd>
			<dt>Convex WebSocket</dt>
			<dd>
				{wsAuthenticated === null ? 'unknown' : wsAuthenticated ? 'authenticated' : 'anonymous'}
			</dd>
			<dt>auth.getCurrentUser (live)</dt>
			<dd>{liveUser}{liveUpdatedAt ? ` · updated ${liveUpdatedAt}` : ''}</dd>
		</dl>
	</section>

	<section>
		<h2>2. Session survives kill + relaunch</h2>
		<p>
			Sign in, force-quit the app, open it again. The line at the top must say a session cookie was
			restored, and section 1 must show you signed in without typing anything.
		</p>
		<p class="muted">Stored keys: {auth ? auth.storage.keys().join(', ') || 'none' : '…'}</p>
		<p class={storageError ? 'error' : 'muted'}>
			{storageError ?? 'No Keychain/Keystore errors so far'}
		</p>
	</section>

	<section>
		<h2>3. Sign-out revokes the server session</h2>
		<button type="button" onclick={signOut} disabled={busy || !sessionEmail}>Sign out</button>
		<p>{revocation}</p>
	</section>

	<section>
		<h2>4. Native Google sign-in (ID token)</h2>
		<button type="button" onclick={signInWithGoogle} disabled={busy || !auth}
			>Sign in with Google</button
		>
		<p>{googleStatus}</p>
	</section>

	<section>
		<h2>5. Universal link / sign-in link</h2>
		<p class="muted">Link origin: {linkOrigin ?? 'PUBLIC_NATIVE_APP_LINK_ORIGIN not set'}</p>
		<button type="button" onclick={sendSignInLink} disabled={busy || !auth}>
			Email me a sign-in link
		</button>
		<p class="break">Last link: {lastLink ?? 'none'}</p>
		<p>{linkStatus}</p>
	</section>

	<section>
		<h2>6. Signed CloudFront media</h2>
		<button type="button" onclick={loadMedia} disabled={!wsAuthenticated}
			>Load my newest image + video</button
		>
		<p>{mediaStatus}</p>
		{#if image}
			<img src={image.url} alt="Newest upload (signed)" />
		{/if}
		{#if video}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video src={video.url} controls playsinline preload="metadata"></video>
		{/if}
	</section>

	<section>
		<h2>7. Origin + CORS</h2>
		<dl>
			<dt>window.location.origin</dt>
			<dd>
				{origin}
				{originIsNative ? '(one of the two native origins)' : '(NOT a native origin)'}
			</dd>
			<dt>Backend</dt>
			<dd class="break">{siteUrl || 'unset'}</dd>
			<dt>CORS probe</dt>
			<dd>{corsProbe}</dd>
		</dl>
		<button type="button" onclick={probeCors}>Probe again</button>
	</section>

	<section>
		<h2>Log</h2>
		<ol class="log">
			{#each log as line, index (index)}
				<li><span class="muted">{line.at}</span> {line.text}</li>
			{/each}
		</ol>
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, sans-serif;
		background: #fafafa;
		color: #111;
	}
	main {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: max(16px, env(safe-area-inset-top)) 16px 32px;
	}
	h1 {
		font-size: 1.2rem;
		margin: 0;
	}
	h2 {
		font-size: 1rem;
		margin: 0;
	}
	section {
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: #fff;
		border: 1px solid #ddd;
		border-radius: 8px;
		padding: 12px;
	}
	form,
	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	input,
	button {
		font: inherit;
		padding: 8px;
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 4px 8px;
		margin: 0;
	}
	dd {
		margin: 0;
	}
	p {
		margin: 0;
	}
	img,
	video {
		max-width: 100%;
		border-radius: 6px;
	}
	.error {
		color: #b00020;
		font-weight: 600;
	}
	.muted {
		color: #666;
		font-size: 0.85rem;
	}
	.break {
		word-break: break-all;
	}
	.log {
		margin: 0;
		padding-left: 20px;
		font-size: 0.85rem;
	}
</style>
