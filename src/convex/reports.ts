import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { mutation } from './_generated/server';
import { requireIdentity, requireProfile } from './permissions';
import { isRateLimited, recordRateLimitAttempt } from './rateLimiting';

// PRD 6.15.1/6.15.2: any authenticated user can report a chat message, project update, user, or
// club — deliberately NOT gated by club membership (the no-club state must still be able to
// report). v1 only stores the report and alerts the Core Team via Google Chat; admin review
// workflow is CL-730/CL-693.

const DESCRIPTION_MAX_LENGTH = 2000;
const CONTEXT_TEXT_MAX_LENGTH = 500;
const DESCRIPTION_PREVIEW_LENGTH = 200;

const REPORT_RATE_LIMIT = { maxAttempts: 10, windowMs: 60 * 60 * 1000 };

const reportCategoryValidator = v.union(
	v.literal('safeguarding'),
	v.literal('inappropriate_content'),
	v.literal('other')
);

const reportTargetTypeValidator = v.union(
	v.literal('chat_message'),
	v.literal('project_update'),
	v.literal('user'),
	v.literal('club'),
	// CL-726: individual comments on project updates.
	v.literal('comment')
);

const profileDisplayName = (profile: {
	firstName?: string;
	lastName?: string;
	username?: string;
}) => {
	const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
	return fullName || profile.username || 'Someone';
};

const truncate = (value: string, maxLength: number) =>
	value.length > maxLength ? `${value.slice(0, maxLength).trimEnd()}...` : value;

export const submitReport = mutation({
	args: {
		category: reportCategoryValidator,
		description: v.optional(v.string()),
		targetType: reportTargetTypeValidator,
		targetId: v.string(),
		contextText: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const identity = await requireIdentity(ctx);
		const profile = await requireProfile(ctx, identity.subject);

		const description = args.description?.trim() || undefined;
		if (description && description.length > DESCRIPTION_MAX_LENGTH) {
			throw new ConvexError(`Description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer`);
		}

		const rateLimitKey = `reports:submit:${profile._id}`;
		if (await isRateLimited(ctx, rateLimitKey, REPORT_RATE_LIMIT)) {
			return { ok: false as const, error: 'rate_limited' as const };
		}
		await recordRateLimitAttempt(ctx, rateLimitKey, REPORT_RATE_LIMIT);

		const contextText = args.contextText?.trim()
			? truncate(args.contextText.trim(), CONTEXT_TEXT_MAX_LENGTH)
			: undefined;

		const now = Date.now();
		const reportId = await ctx.db.insert('reports', {
			reporterProfileId: profile._id,
			category: args.category,
			description,
			targetType: args.targetType,
			targetId: args.targetId,
			contextText,
			status: 'open',
			createdAt: now
		});

		await ctx.scheduler.runAfter(0, internal.googleChat.notifyReportSubmitted, {
			reportId,
			category: args.category,
			targetType: args.targetType,
			targetId: args.targetId,
			reporterName: profileDisplayName(profile),
			descriptionPreview: description
				? truncate(description, DESCRIPTION_PREVIEW_LENGTH)
				: undefined
		});

		return { ok: true as const, reportId };
	}
});
