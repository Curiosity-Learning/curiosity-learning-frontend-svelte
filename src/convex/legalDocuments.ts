import { ConvexError, v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import {
	PRIVACY_POLICY_VERSION,
	TERMS_AND_CONDITIONS_VERSION,
	privacyPolicyContent,
	termsAndConditionsContent
} from './legalContent';
import { requireIdentity } from './permissions';

const legalDocumentKeyValidator = v.union(
	v.literal('privacy_policy'),
	v.literal('terms_and_conditions'),
	v.literal('cookie_policy')
);

const legalDocumentNameByKey = {
	privacy_policy: 'Privacy Policy',
	terms_and_conditions: 'Terms and Conditions',
	cookie_policy: 'Cookie Policy'
} as const;

type LegalDocumentKey = keyof typeof legalDocumentNameByKey;

const legalDocumentKeys = Object.keys(legalDocumentNameByKey) as LegalDocumentKey[];

// What /terms, /privacy and /cookies show, so also the version a consent records as agreed to
// (childSignup.approveConsent).
export const getActiveOrLatestByKey = async (
	ctx: Pick<QueryCtx, 'db'>,
	documentKey: LegalDocumentKey
) => {
	const active = await ctx.db
		.query('legalDocuments')
		.withIndex('by_document_key_and_active', (q) =>
			q.eq('documentKey', documentKey).eq('isActive', true)
		)
		.first();
	if (active) return active;

	return await ctx.db
		.query('legalDocuments')
		.withIndex('by_document_key_and_updated', (q) => q.eq('documentKey', documentKey))
		.order('desc')
		.first();
};

export const getActiveByKey = query({
	args: {
		documentKey: legalDocumentKeyValidator
	},
	handler: async (ctx, args) => {
		return await getActiveOrLatestByKey(ctx, args.documentKey);
	}
});

export const listActive = query({
	args: {},
	handler: async (ctx) => {
		const documents = await Promise.all(
			legalDocumentKeys.map((documentKey) => getActiveOrLatestByKey(ctx, documentKey))
		);
		return documents.filter((document) => document !== null);
	}
});

const insertActive = async (
	ctx: Pick<MutationCtx, 'db'>,
	args: { documentKey: LegalDocumentKey; title: string; content: string; version: string }
) => {
	const activeDocuments = await ctx.db
		.query('legalDocuments')
		.withIndex('by_document_key_and_active', (q) =>
			q.eq('documentKey', args.documentKey).eq('isActive', true)
		)
		.collect();

	for (const document of activeDocuments) {
		await ctx.db.patch(document._id, { isActive: false, updatedAt: Date.now() });
	}

	const id = await ctx.db.insert('legalDocuments', {
		documentKey: args.documentKey,
		fullName: legalDocumentNameByKey[args.documentKey],
		title: args.title,
		content: args.content,
		version: args.version,
		isActive: true,
		createdAt: Date.now(),
		updatedAt: Date.now()
	});

	const current = await ctx.db.get(id);
	if (!current) {
		throw new ConvexError('Failed to create legal document');
	}
	return current;
};

// The text kept in legalContent.ts, which is what each deployment should show.
const bundledLegalDocuments = {
	privacy_policy: { content: privacyPolicyContent, version: PRIVACY_POLICY_VERSION },
	terms_and_conditions: {
		content: termsAndConditionsContent,
		version: TERMS_AND_CONDITIONS_VERSION
	}
} as const;

/**
 * Makes the text in legalContent.ts the active version of a legal document. Run it once per
 * deployment after a change ships:
 *   npx convex run legalDocuments:publishBundled '{"documentKey":"privacy_policy"}'
 * Running it again is a no-op. Refuses a changed text under an already published version,
 * because consents record the version a parent agreed to.
 */
export const publishBundled = internalMutation({
	args: {
		documentKey: v.union(v.literal('privacy_policy'), v.literal('terms_and_conditions'))
	},
	handler: async (ctx, args) => {
		const bundled = bundledLegalDocuments[args.documentKey];
		const current = await getActiveOrLatestByKey(ctx, args.documentKey);
		if (current?.isActive && current.version === bundled.version) {
			if (current.content !== bundled.content) {
				throw new ConvexError(
					`Version ${bundled.version} is already published with different text; bump the version in legalContent.ts`
				);
			}
			return { published: false, version: bundled.version };
		}

		await insertActive(ctx, {
			documentKey: args.documentKey,
			title: legalDocumentNameByKey[args.documentKey],
			content: bundled.content,
			version: bundled.version
		});
		return { published: true, version: bundled.version, previousVersion: current?.version ?? null };
	}
});

export const upsertActive = mutation({
	args: {
		documentKey: legalDocumentKeyValidator,
		title: v.string(),
		content: v.string(),
		version: v.string()
	},
	handler: async (ctx, args) => {
		await requireIdentity(ctx);
		return await insertActive(ctx, args);
	}
});
