import { betterAuth } from 'better-auth';
import { createClient } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import type { GenericCtx } from '@convex-dev/better-auth';
import type { GenericDataModel } from 'convex/server';
import { components } from './_generated/api';
import { mutation, query } from './_generated/server';
import authConfig from './auth.config';
import { requireIdentity } from './permissions';

export const authComponent = createClient(components.betterAuth);

const resendEmail = async (args: { to: string; subject: string; html: string; text: string }) => {
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) {
		throw new Error('RESEND_API_KEY is not set (Convex environment variable).');
	}

	const from = process.env.RESEND_FROM ?? 'Curiosity Learning <onboarding@resend.dev>';

	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			authorization: `Bearer ${apiKey}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			from,
			to: args.to,
			subject: args.subject,
			html: args.html,
			text: args.text
		})
	});

	if (!response.ok) {
		let details = '';
		try {
			details = JSON.stringify(await response.json());
		} catch {
			details = await response.text().catch(() => '');
		}
		throw new Error(`Resend send failed: ${response.status} ${response.statusText} ${details}`);
	}
};

const trustedOrigins = [
	process.env.BETTER_AUTH_URL,
	process.env.PUBLIC_CONVEX_SITE_URL,
	// Local dev / preview ports.
	'http://localhost:5173',
	'http://localhost:4173',
	// ngrok tunnel for external device testing.
	'https://arrased-semiurban-jean.ngrok-free.dev'
].filter((value): value is string => Boolean(value));

// Optional: allow LAN/loopback origins for local development.
// This weakens CSRF origin protections and should not be enabled in production.
if (process.env.ALLOW_LAN_TRUSTED_ORIGINS === 'true') {
	trustedOrigins.push(
		'localhost:*',
		'127.0.0.1:*',
		// Better Auth supports wildcard origin patterns; without a scheme we match the host (including port).
		'10.*',
		'192.168.*',
		'172.*',
		'*.local:*'
	);
}

export const createAuth = (ctx: GenericCtx<GenericDataModel>) =>
	betterAuth({
		baseURL: process.env.BETTER_AUTH_URL,
		database: authComponent.adapter(ctx),
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: true,
			sendResetPassword: async ({ user, url, token }) => {
				await resendEmail({
					to: user.email,
					subject: 'Reset your password',
					text: `Reset your password:\n\n${url}\n\nToken: ${token}`,
					html: `<p>Reset your password:</p><p><a href="${url}">${url}</a></p><p style="color:#666">Token: ${token}</p>`
				});
			}
		},
		emailVerification: {
			sendOnSignUp: true,
			sendOnSignIn: true,
			autoSignInAfterVerification: true,
			sendVerificationEmail: async ({ user, url, token }) => {
				await resendEmail({
					to: user.email,
					subject: 'Verify your email',
					text: `Verify your email:\n\n${url}\n\nToken: ${token}`,
					html: `<p>Verify your email:</p><p><a href="${url}">${url}</a></p><p style="color:#666">Token: ${token}</p>`
				});
			}
		},
		plugins: [convex({ authConfig })],
		trustedOrigins
	});

export const getCurrentUser = query({
	args: {},
	handler: async (ctx) => {
		return await authComponent.safeGetAuthUser(ctx as unknown as GenericCtx<GenericDataModel>);
	}
});

export const getViewerIdentity = query({
	args: {},
	handler: async (ctx) => {
		const identity = await requireIdentity(ctx);
		return { userId: identity.subject };
	}
});

export const ensureProfile = mutation({
	args: {},
	handler: async (ctx) => {
		const authUser = await authComponent.getAuthUser(
			ctx as unknown as GenericCtx<GenericDataModel>
		);
		const existing = await ctx.db
			.query('profiles')
			.withIndex('by_user_id', (q) => q.eq('userId', authUser._id))
			.first();

		const now = Date.now();
		const username = authUser.email.split('@')[0].toLowerCase();

		if (existing) {
			await ctx.db.patch(existing._id, {
				email: authUser.email,
				isVerified: authUser.emailVerified,
				updatedAt: now
			});
			return await ctx.db.get(existing._id);
		}

		const profileId = await ctx.db.insert('profiles', {
			userId: authUser._id,
			email: authUser.email,
			firstName: authUser.name?.split(' ')[0],
			lastName: authUser.name?.split(' ').slice(1).join(' ') || undefined,
			username,
			isVerified: authUser.emailVerified,
			firstLoginCompleted: false,
			updatedAt: now
		});

		return await ctx.db.get(profileId);
	}
});
