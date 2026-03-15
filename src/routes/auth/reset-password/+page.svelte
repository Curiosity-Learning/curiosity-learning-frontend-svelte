<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { InputField } from '$lib/components/app/form';
	import { authClient } from '$lib/auth-client';

	let token = $derived(page.url.searchParams.get('token') ?? '');
	let email = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let pending = $state(false);
	let errorMessage = $state('');
	let infoMessage = $state('');

	const requestReset = async () => {
		pending = true;
		errorMessage = '';
		infoMessage = '';
		const redirectTo = `${window.location.origin}/auth/reset-password`;
		const { error } = await authClient.requestPasswordReset({
			email: email.trim(),
			redirectTo
		});
		pending = false;
		if (error) {
			errorMessage = error.message ?? 'Could not send reset email.';
			return;
		}
		infoMessage = 'If the email exists, a reset link has been sent.';
	};

	const updatePassword = async () => {
		if (newPassword !== confirmPassword) {
			errorMessage = 'Passwords do not match.';
			return;
		}
		pending = true;
		errorMessage = '';
		infoMessage = '';
		const { error } = await authClient.resetPassword({
			token,
			newPassword
		});
		pending = false;
		if (error) {
			errorMessage = error.message ?? 'Could not reset password.';
			return;
		}
		infoMessage = 'Password updated successfully. You can sign in now.';
	};
</script>

<div class="flex flex-col gap-4">
	{#if token}
		<InputField
			id="newPassword"
			label="New password"
			type="password"
			bind:value={newPassword}
			autocomplete="new-password"
			inputClass="h-9 px-3 py-1 type-control"
		/>
		<InputField
			id="confirmNewPassword"
			label="Confirm password"
			type="password"
			bind:value={confirmPassword}
			autocomplete="new-password"
			inputClass="h-9 px-3 py-1 type-control"
		/>
	{:else}
		<InputField
			id="resetEmail"
			label="Email"
			type="email"
			bind:value={email}
			autocomplete="email"
			inputClass="h-9 px-3 py-1 type-control"
		/>
	{/if}

	{#if errorMessage}
		<Alert variant="destructive">
			<AlertTitle>Request failed</AlertTitle>
			<AlertDescription>{errorMessage}</AlertDescription>
		</Alert>
	{/if}

	{#if infoMessage}
		<Alert>
			<AlertTitle>Done</AlertTitle>
			<AlertDescription>{infoMessage}</AlertDescription>
		</Alert>
	{/if}

	<Button
		disabled={pending || (token ? !newPassword || !confirmPassword : !email.trim())}
		onclick={() => {
			if (token) {
				void updatePassword();
				return;
			}
			void requestReset();
		}}
	>
		{#if pending}
			Working...
		{:else if token}
			Set new password
		{:else}
			Send reset link
		{/if}
	</Button>

	<Button
		variant="ghost"
		onclick={() => {
			void goto(resolve('/auth/sign-in'));
		}}>Back to sign in</Button
	>
</div>
