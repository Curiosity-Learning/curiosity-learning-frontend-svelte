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

const REPORT_CATEGORY_LABELS: Record<string, string> = {
	safeguarding: 'Safeguarding',
	inappropriate_content: 'Inappropriate content',
	other: 'Other'
};

const REPORT_TARGET_TYPE_LABELS: Record<string, string> = {
	chat_message: 'Chat message',
	project_update: 'Project update',
	user: 'User',
	club: 'Club'
};

export const notifyReportSubmitted = internalAction({
	args: {
		reportId: v.id('reports'),
		category: v.string(),
		targetType: v.string(),
		targetId: v.string(),
		reporterName: v.string(),
		descriptionPreview: v.optional(v.string())
	},
	handler: async (_ctx, args) => {
		try {
			await postGoogleChatMessage(
				compactLines([
					'New report submitted',
					`Category: ${REPORT_CATEGORY_LABELS[args.category] ?? args.category}`,
					`Target: ${REPORT_TARGET_TYPE_LABELS[args.targetType] ?? args.targetType} (${args.targetId})`,
					`Reporter: ${args.reporterName}`,
					args.descriptionPreview ? `Details: ${args.descriptionPreview}` : undefined,
					`Report ID: ${args.reportId}`
				])
			);
		} catch (error) {
			await reportConvexError(error, {
				area: 'backend',
				operation: 'google-chat:report',
				identifiers: { provider: 'google-chat' }
			});
			// Don't rethrow: a failed alert shouldn't surface as a scheduled-function failure that
			// obscures the fact the report itself was already stored successfully.
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
