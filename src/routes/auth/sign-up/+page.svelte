<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { authClient } from '$lib/auth-client';

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let pending = $state(false);
	let errorMessage = $state('');
	let infoMessage = $state('');

	let rawNextPath = $derived(page.url.searchParams.get('next') ?? '/');
	let nextPath = $derived(rawNextPath.startsWith('/') ? rawNextPath : '/');

	const signUp = async () => {
		if (password !== confirmPassword) {
			errorMessage = 'Passwords do not match.';
			return;
		}

		pending = true;
		errorMessage = '';
		infoMessage = '';

		const { data, error } = await authClient.signUp.email({
			name: name.trim(),
			email: email.trim(),
			password,
			callbackURL: nextPath
		});

		pending = false;
		if (error) {
			errorMessage = error.message ?? 'Failed to create account.';
			return;
		}

		if (data?.token) {
			await goto(nextPath);
			return;
		}

		infoMessage = 'Account created. Check your email to verify before signing in.';
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
	<div class="flex flex-col gap-2">
		<Label for="name">Full name</Label>
		<Input id="name" bind:value={name} autocomplete="name" />
	</div>
	<div class="flex flex-col gap-2">
		<Label for="email">Email</Label>
		<Input id="email" type="email" bind:value={email} autocomplete="email" />
	</div>
	<div class="flex flex-col gap-2">
		<Label for="password">Password</Label>
		<Input id="password" type="password" bind:value={password} autocomplete="new-password" />
	</div>
	<div class="flex flex-col gap-2">
		<Label for="confirmPassword">Confirm password</Label>
		<Input
			id="confirmPassword"
			type="password"
			bind:value={confirmPassword}
			autocomplete="new-password"
		/>
	</div>

	{#if errorMessage}
		<Alert variant="destructive">
			<AlertTitle>Sign up failed</AlertTitle>
			<AlertDescription>{errorMessage}</AlertDescription>
		</Alert>
	{/if}

	{#if infoMessage}
		<Alert>
			<AlertTitle>Verify your email</AlertTitle>
			<AlertDescription>{infoMessage}</AlertDescription>
		</Alert>
	{/if}

	{#if infoMessage && email.trim()}
		<Button
			variant="outline"
			disabled={pending}
			onclick={() => {
				void resendVerification();
			}}
		>
			Resend verification email
		</Button>
	{/if}

	<Button
		disabled={pending || !name.trim() || !email.trim() || !password || !confirmPassword}
		onclick={() => {
			void signUp();
		}}
	>
		{pending ? 'Creating account...' : 'Create account'}
	</Button>

	<Button href={`/auth/sign-in?next=${encodeURIComponent(nextPath)}`} variant="ghost"
		>Already have an account?</Button
	>
</div>
