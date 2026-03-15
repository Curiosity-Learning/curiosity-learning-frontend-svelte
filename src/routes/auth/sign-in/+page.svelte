<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { authClient } from '$lib/auth-client';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { InputField } from '$lib/components/app/form';

	const session = authClient.useSession();

	let email = $state('');
	let password = $state('');
	let pending = $state(false);
	let errorMessage = $state('');
	let infoMessage = $state('');

	let rawNextPath = $derived(page.url.searchParams.get('next') ?? '/');
	let nextPath = $derived(rawNextPath.startsWith('/') ? rawNextPath : '/');
	let needsVerification = $derived(errorMessage.toLowerCase().includes('not verified'));

	$effect(() => {
		if ($session.data) {
			void goto(nextPath);
		}
	});

	const signIn = async () => {
		pending = true;
		errorMessage = '';
		infoMessage = '';
		const { error } = await authClient.signIn.email({
			email: email.trim(),
			password,
			callbackURL: nextPath
		});
		pending = false;
		if (error) {
			errorMessage = error.message ?? 'Failed to sign in.';
			return;
		}
		await goto(nextPath);
	};

	const resendVerification = async () => {
		if (!email.trim()) return;
		pending = true;
		errorMessage = '';
		infoMessage = '';
		const { error } = await authClient.sendVerificationEmail({
			email: email.trim(),
			callbackURL: nextPath
		});
		pending = false;
		if (error) {
			errorMessage = error.message ?? 'Failed to resend verification email.';
			return;
		}
		infoMessage = 'Verification email sent. Check your inbox and spam.';
	};
</script>

<div class="flex flex-col gap-4">
	<InputField
		id="email"
		label="Email"
		type="email"
		bind:value={email}
		autocomplete="email"
		inputClass="h-9 px-3 py-1 type-control"
	/>
	<InputField
		id="password"
		label="Password"
		type="password"
		bind:value={password}
		autocomplete="current-password"
		inputClass="h-9 px-3 py-1 type-control"
	/>

	{#if errorMessage}
		<Alert variant="destructive">
			<AlertTitle>Sign in failed</AlertTitle>
			<AlertDescription>{errorMessage}</AlertDescription>
		</Alert>
	{/if}

	{#if infoMessage}
		<Alert>
			<AlertTitle>Check your email</AlertTitle>
			<AlertDescription>{infoMessage}</AlertDescription>
		</Alert>
	{/if}

	{#if needsVerification}
		<Button
			variant="outline"
			disabled={pending || !email.trim()}
			onclick={() => {
				void resendVerification();
			}}
		>
			Resend verification email
		</Button>
	{/if}

	<Button
		disabled={pending || !email.trim() || !password}
		onclick={() => {
			void signIn();
		}}
	>
		{pending ? 'Signing in...' : 'Sign in'}
	</Button>

	<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
		<Button href={`/auth/sign-up?next=${encodeURIComponent(nextPath)}`} variant="outline"
			>Create account</Button
		>
		<Button href="/auth/reset-password" variant="ghost">Forgot password?</Button>
	</div>
</div>
