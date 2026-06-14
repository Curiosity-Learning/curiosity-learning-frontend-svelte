import type { OperationalLevel } from '$lib/monitoring/payload';
import { Webhook } from 'svix';

type ResendEventClassification = {
	eventType: string;
	emailType?: string;
	level: OperationalLevel;
};

const ERROR_EVENTS = new Set(['email.bounced', 'email.failed', 'email.suppressed']);
const WARNING_EVENTS = new Set(['email.complained', 'email.delivery_delayed']);

export const verifyResendWebhook = (
	body: string,
	headers: Record<string, string>,
	secret: string
) => new Webhook(secret).verify(body, headers);

const getEmailType = (data: Record<string, unknown>) => {
	const tags = data.tags;
	if (Array.isArray(tags)) {
		const emailTypeTag = tags.find(
			(tag) =>
				tag &&
				typeof tag === 'object' &&
				'name' in tag &&
				tag.name === 'email_type' &&
				'value' in tag &&
				typeof tag.value === 'string'
		);
		return emailTypeTag && typeof emailTypeTag === 'object' && 'value' in emailTypeTag
			? String(emailTypeTag.value)
			: undefined;
	}
	if (tags && typeof tags === 'object' && 'email_type' in tags) {
		return String(tags.email_type);
	}
	return undefined;
};

export const classifyResendWebhook = (value: unknown): ResendEventClassification | null => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const event = value as Record<string, unknown>;
	if (typeof event.type !== 'string') return null;

	const level = ERROR_EVENTS.has(event.type)
		? 'error'
		: WARNING_EVENTS.has(event.type)
			? 'warning'
			: null;
	if (!level) return null;

	const data =
		event.data && typeof event.data === 'object' && !Array.isArray(event.data)
			? (event.data as Record<string, unknown>)
			: {};
	return {
		eventType: event.type,
		emailType: getEmailType(data),
		level
	};
};
