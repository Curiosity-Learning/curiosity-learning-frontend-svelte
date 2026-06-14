import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { reportConvexError } from './monitoring';

const GOOGLE_CHAT_WEBHOOK_URL_ENV = 'GOOGLE_CHAT_WEBHOOK_URL';

const compactLines = (lines: Array<string | undefined>) =>
	lines.filter((line): line is string => Boolean(line?.trim())).join('\n');

const postGoogleChatMessage = async (text: string) => {
	const webhookUrl = process.env[GOOGLE_CHAT_WEBHOOK_URL_ENV]?.trim();
	if (!webhookUrl) {
		console.warn(`${GOOGLE_CHAT_WEBHOOK_URL_ENV} is not set; skipping Google Chat notification.`);
		return;
	}

	const response = await fetch(webhookUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json; charset=UTF-8' },
		body: JSON.stringify({ text })
	});

	if (!response.ok) {
		throw new Error(`Google Chat webhook failed: ${response.status} ${response.statusText}`);
	}
};

export const notifyClubApplicationSubmitted = internalAction({
	args: {
		applicationId: v.id('clubApplications'),
		name: v.string(),
		location: v.optional(v.string()),
		applicantName: v.optional(v.string()),
		applicantRole: v.optional(v.string()),
		referralSource: v.optional(v.string())
	},
	handler: async (_ctx, args) => {
		try {
			await postGoogleChatMessage(
				compactLines([
					'New Start Club application submitted',
					`Club: ${args.name}`,
					args.location ? `Location: ${args.location}` : undefined,
					args.applicantName ? `Applicant: ${args.applicantName}` : undefined,
					args.applicantRole ? `Role: ${args.applicantRole}` : undefined,
					args.referralSource ? `Referral: ${args.referralSource}` : undefined,
					`Application ID: ${args.applicationId}`
				])
			);
		} catch (error) {
			await reportConvexError(error, {
				area: 'backend',
				operation: 'google-chat:club-application',
				identifiers: { applicationId: args.applicationId, provider: 'google-chat' }
			});
			throw error;
		}
	}
});

export const notifyClubInterestSignupCreated = internalAction({
	args: {
		signupId: v.id('clubInterestSignups'),
		email: v.string(),
		location: v.string()
	},
	handler: async (_ctx, args) => {
		try {
			await postGoogleChatMessage(
				compactLines([
					'New club interest signup',
					`Email: ${args.email}`,
					`Location: ${args.location}`,
					`Signup ID: ${args.signupId}`
				])
			);
		} catch (error) {
			await reportConvexError(error, {
				area: 'backend',
				operation: 'google-chat:club-interest',
				identifiers: { provider: 'google-chat' }
			});
			throw error;
		}
	}
});
