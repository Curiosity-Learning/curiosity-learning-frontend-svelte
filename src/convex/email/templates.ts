export type EmailContent = {
	subject: string;
	html: string;
	text: string;
};

const colors = {
	background: '#F6F7F9',
	card: '#FFFFFF',
	foreground: '#292B33',
	muted: '#6B6F80',
	border: '#DCDEE6',
	primary: '#F5791D',
	primaryDark: '#C46117',
	primarySoft: '#FEF2E8'
};

const escapeHtml = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');

const absoluteUrl = (url: string) => url;
const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');
const isLocalUrl = (value: string) =>
	/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value);

const getEmailLogoUrl = () => {
	const explicitLogoUrl = process.env.EMAIL_LOGO_URL?.trim();
	if (explicitLogoUrl) return explicitLogoUrl;

	const baseUrl =
		process.env.EMAIL_ASSET_BASE_URL?.trim() ??
		process.env.PUBLIC_APP_URL?.trim() ??
		process.env.BETTER_AUTH_URL?.trim();

	if (!baseUrl || isLocalUrl(baseUrl)) return undefined;

	return `${trimTrailingSlash(baseUrl)}/brand/curiosity-learning-logo.png`;
};

const brandHeader = () => {
	const logoUrl = getEmailLogoUrl();
	if (logoUrl) {
		return `<img src="${escapeHtml(logoUrl)}" width="118" height="40" alt="Curiosity Learning" style="display:block;width:118px;height:40px;border:0;outline:none;text-decoration:none;" />`;
	}

	return `<div style="font-size:18px;line-height:22px;font-weight:800;color:${colors.foreground};">Curiosity Learning</div>`;
};

const paragraph = (content: string) =>
	`<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:${colors.muted};">${content}</p>`;

const button = (href: string, label: string) => `
	<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;">
		<tr>
			<td style="border-radius:8px;background:${colors.primary};">
				<a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 22px;border-radius:8px;background:${colors.primary};color:#FFFFFF;font-size:16px;line-height:20px;font-weight:700;text-decoration:none;">
					${escapeHtml(label)}
				</a>
			</td>
		</tr>
	</table>
`;

const rawLink = (url: string) => `
	<p style="margin:18px 0 0;font-size:13px;line-height:20px;color:${colors.muted};">
		If the button does not work, copy and paste this link into your browser:<br />
		<a href="${escapeHtml(url)}" style="color:${colors.primaryDark};word-break:break-all;">${escapeHtml(url)}</a>
	</p>
`;

const layout = (args: { preheader: string; title: string; children: string; footer?: string }) => {
	const preheader = escapeHtml(args.preheader);
	const title = escapeHtml(args.title);
	const footer =
		args.footer ??
		'You received this email because a Curiosity Learning account action was requested.';

	return `<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${title}</title>
	</head>
	<body style="margin:0;padding:0;background:${colors.background};font-family:Arial,Helvetica,sans-serif;color:${colors.foreground};">
		<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
		<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${colors.background};">
			<tr>
				<td align="center" style="padding:32px 16px;">
					<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
						<tr>
							<td style="padding:0 0 18px;">
								${brandHeader()}
							</td>
						</tr>
						<tr>
							<td style="padding:32px;border:1px solid ${colors.border};border-radius:12px;background:${colors.card};">
								<h1 style="margin:0 0 18px;font-size:28px;line-height:34px;font-weight:800;color:${colors.foreground};">${title}</h1>
								${args.children}
							</td>
						</tr>
						<tr>
							<td style="padding:18px 4px 0;">
								<p style="margin:0;font-size:12px;line-height:18px;color:${colors.muted};">${escapeHtml(footer)}</p>
							</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>
	</body>
</html>`;
};

const otpLabelByType = {
	'email-verification': {
		subject: 'Verify your email code',
		title: 'Verify your email',
		purpose: 'verify your email address',
		preheader: 'Use this 6-digit code to verify your Curiosity Learning account.'
	},
	'sign-in': {
		subject: 'Your sign-in code',
		title: 'Your sign-in code',
		purpose: 'sign in',
		preheader: 'Use this 6-digit code to sign in to Curiosity Learning.'
	},
	'forget-password': {
		subject: 'Reset your password code',
		title: 'Reset your password',
		purpose: 'reset your password',
		preheader: 'Use this 6-digit code to reset your Curiosity Learning password.'
	}
} as const;

export type OtpEmailType = keyof typeof otpLabelByType;

export const verificationOtpEmail = (args: { otp: string; type: OtpEmailType }): EmailContent => {
	const copy = otpLabelByType[args.type];
	const escapedOtp = escapeHtml(args.otp);
	return {
		subject: copy.subject,
		text: `Use this 6-digit code to ${copy.purpose}: ${args.otp}\n\nThis code expires in 5 minutes.`,
		html: layout({
			preheader: copy.preheader,
			title: copy.title,
			children: `
				${paragraph(`Use this 6-digit code to ${copy.purpose}.`)}
				<div style="margin:24px 0;padding:18px;border-radius:10px;background:${colors.primarySoft};border:1px solid #FBC9A5;text-align:center;">
					<div style="font-size:32px;line-height:40px;font-weight:800;letter-spacing:8px;color:${colors.foreground};">${escapedOtp}</div>
				</div>
				${paragraph('This code expires in 5 minutes. If you did not request this, you can ignore this email.')}
			`
		})
	};
};

export const passwordResetEmail = (args: { url: string; token: string }): EmailContent => {
	const url = absoluteUrl(args.url);
	return {
		subject: 'Reset your password',
		text: `Reset your Curiosity Learning password:\n\n${url}\n\nToken: ${args.token}`,
		html: layout({
			preheader: 'Reset your Curiosity Learning password.',
			title: 'Reset your password',
			children: `
				${paragraph('We received a request to reset your Curiosity Learning password.')}
				${button(url, 'Reset password')}
				${rawLink(url)}
				${paragraph('If you did not request this, you can ignore this email.')}
			`
		})
	};
};

// "Send me a new link" from the sign-in page (the magic-link plugin's sendMagicLink in auth.ts).
// Links minted into other emails (parent chat emails) are not sent with this template.
// `expiresIn`: the link's lifetime in words. The sign-in page's own links last 30 minutes; the
// "send a link to the approving address" helper (parentAccounts
// .requestApprovingAccountSignInLink, review S9) mints a 48-hour one.
export const magicLinkEmail = (args: { url: string; expiresIn?: string }): EmailContent => {
	const url = absoluteUrl(args.url);
	const expiry = `This link works once and expires in ${args.expiresIn ?? '30 minutes'}. If you did not ask for it, you can ignore this email.`;
	return {
		subject: 'Your sign-in link',
		text: `Sign in to Curiosity Learning:\n\n${url}\n\n${expiry}`,
		html: layout({
			preheader: 'Your link to sign in to Curiosity Learning.',
			title: 'Your sign-in link',
			children: `
				${paragraph('Use the button below to sign in to Curiosity Learning. No password needed.')}
				${button(url, 'Sign in')}
				${rawLink(url)}
				${paragraph(escapeHtml(expiry))}
			`
		})
	};
};

export const parentConsentEmail = (args: {
	childUsername: string;
	consentUrl: string;
}): EmailContent => {
	const childUsername = escapeHtml(args.childUsername);
	const consentUrl = absoluteUrl(args.consentUrl);
	return {
		subject: 'Approve a Curiosity Learning account',
		text: `${args.childUsername} wants to use Curiosity Learning.\n\nReview and approve this learner account:\n\n${consentUrl}`,
		html: layout({
			preheader: `${args.childUsername} needs your approval to use Curiosity Learning.`,
			title: 'Approve learner account',
			children: `
				${paragraph(`<strong style="color:${colors.foreground};">${childUsername}</strong> wants to use Curiosity Learning.`)}
				${paragraph('Please review this request. Approving confirms your consent and verifies this parent or guardian email address for this learner account.')}
				${button(consentUrl, 'Review and approve')}
				${rawLink(consentUrl)}
			`,
			footer:
				'This approval applies only to the learner account named in this email. A separate approval is required for each child account.'
		})
	};
};

// Invitation to become a platform admin (adminInvites.createInvite). The link points at the
// separate admin portal, not the member app; when ADMIN_APP_ORIGIN is unset the email still
// works, it just omits the button.
export const adminInviteEmail = (args: {
	inviterName?: string;
	adminPortalUrl?: string;
	expiresInDays: number;
}): EmailContent => {
	const invitedBy = args.inviterName
		? `<strong style="color:${colors.foreground};">${escapeHtml(args.inviterName)}</strong> has invited you`
		: 'You have been invited';
	const invitedByText = args.inviterName
		? `${args.inviterName} has invited you`
		: 'You have been invited';
	const instructions = `Sign in to the Curiosity Learning admin portal with this email address (or create an account with it) to accept. This invitation expires in ${args.expiresInDays} days.`;
	return {
		subject: 'You are invited to administer Curiosity Learning',
		text: `${invitedByText} to be an administrator on Curiosity Learning.\n\n${instructions}${args.adminPortalUrl ? `\n\n${args.adminPortalUrl}` : ''}`,
		html: layout({
			preheader: 'You have been invited to be a Curiosity Learning administrator.',
			title: 'Admin invitation',
			children: `
				${paragraph(`${invitedBy} to be an administrator on Curiosity Learning.`)}
				${paragraph(instructions)}
				${args.adminPortalUrl ? `${button(args.adminPortalUrl, 'Open admin portal')}${rawLink(args.adminPortalUrl)}` : ''}
			`,
			footer:
				'If you were not expecting this invitation, you can ignore this email — nothing is granted until you sign in and accept.'
		})
	};
};

// Invitation for someone who already runs a club (clubLeaderInvites.createLeaderInvite). Staff
// created the club for them; signing up on the member app with this email address is all that is
// left. Deliberately a minimal doorway — everything else happens in the app (CEO principle from
// the onboarding review threads).
export const clubLeaderInviteEmail = (args: {
	clubName: string;
	inviterName?: string;
	signUpUrl?: string;
	expiresInDays: number;
}): EmailContent => {
	const clubName = escapeHtml(args.clubName);
	const invitedBy = args.inviterName
		? `<strong style="color:${colors.foreground};">${escapeHtml(args.inviterName)}</strong> has set up`
		: 'The Curiosity Learning team has set up';
	const invitedByText = args.inviterName
		? `${args.inviterName} has set up`
		: 'The Curiosity Learning team has set up';
	const instructions = `Create your account using this email address and your club will be waiting for you — no application needed. This invitation expires in ${args.expiresInDays} days.`;
	return {
		subject: `Your club "${args.clubName}" is ready on Curiosity Learning`,
		text: `${invitedByText} "${args.clubName}" for you on Curiosity Learning.\n\n${instructions}${args.signUpUrl ? `\n\n${args.signUpUrl}` : ''}`,
		html: layout({
			preheader: `Your club "${args.clubName}" is ready — create your account to take the reins.`,
			title: 'Your club is ready',
			children: `
				${paragraph(`${invitedBy} <strong style="color:${colors.foreground};">${clubName}</strong> for you on Curiosity Learning.`)}
				${paragraph(instructions)}
				${args.signUpUrl ? `${button(args.signUpUrl, 'Create your account')}${rawLink(args.signUpUrl)}` : ''}
			`,
			footer:
				'If you were not expecting this invitation, you can ignore this email — nothing happens until you sign up and the email address is verified.'
		})
	};
};

// Under a parent email's sign-in button (edge case 15: forwarded email = forwarded session).
export const SIGN_IN_LINK_NOTICE = "This button signs you in — please don't forward this email.";

// Generic template for tiered notification emails (CL-715). Renders the same title/message
// pair that is stored on the in-app `notifications` row, plus an optional CTA link into the app.
// `note` is an optional secondary paragraph under the CTA, with its own link (e.g. telling a
// parent they can redirect their child's chat emails — chat.deliverChatEmailNotification).
export const notificationEmail = (args: {
	title: string;
	message: string;
	ctaUrl?: string;
	// Button text; defaults to the generic "Open Curiosity Learning".
	ctaLabel?: string;
	note?: { text: string; url?: string; linkLabel?: string };
	// The CTA is a one-time sign-in link (parent emails, see notifications.deliverNotificationEmail):
	// say so right under the button, so the parent knows not to forward it (review edge case 15).
	ctaSignsIn?: boolean;
}): EmailContent => {
	const message = escapeHtml(args.message);
	const signInNotice = args.ctaUrl && args.ctaSignsIn ? SIGN_IN_LINK_NOTICE : undefined;
	const noteText = args.note
		? [args.note.text, args.note.url].filter(Boolean).join('\n')
		: undefined;
	const noteHtml = args.note
		? `
				<div style="margin:24px 0 0;padding:14px 16px;border-radius:10px;background:${colors.background};border:1px solid ${colors.border};">
					<p style="margin:0;font-size:14px;line-height:21px;color:${colors.muted};">${escapeHtml(args.note.text)}</p>
					${
						args.note.url
							? `<p style="margin:8px 0 0;font-size:14px;line-height:21px;"><a href="${escapeHtml(args.note.url)}" style="color:${colors.primaryDark};font-weight:700;">${escapeHtml(args.note.linkLabel ?? args.note.url)}</a></p>`
							: ''
					}
				</div>`
		: '';
	return {
		subject: args.title,
		text: [args.message, args.ctaUrl, signInNotice, noteText].filter(Boolean).join('\n\n'),
		html: layout({
			preheader: args.message,
			title: args.title,
			children: `
				${paragraph(message)}
				${args.ctaUrl ? `${button(args.ctaUrl, args.ctaLabel ?? 'Open Curiosity Learning')}${rawLink(args.ctaUrl)}` : ''}
				${signInNotice ? `<p style="margin:12px 0 0;font-size:13px;line-height:19px;color:${colors.muted};">${escapeHtml(signInNotice)}</p>` : ''}
				${noteHtml}
			`,
			footer:
				'You received this email because of activity on your Curiosity Learning account. You can adjust which notifications you receive in Settings.'
		})
	};
};

// Confirmation email to the address a parent entered for their child (CL-768, review B2). It
// goes to an address nobody has confirmed yet — possibly a typo or a stranger's inbox — so it
// says as little as possible: the username (the child needs it to sign in), no club names, no
// dates, no sign-in link and no other links. The button opens an app page that only works when
// signed in AS that child (childEmailVerification.confirmChildEmail), so clicking it proves
// nothing on its own.
export const childEmailVerificationEmail = (args: {
	username: string;
	url: string;
	// The child (16+) added it themselves from Settings (CL-769), not their parent.
	addedBySelf?: boolean;
}): EmailContent => {
	const url = absoluteUrl(args.url);
	const who = args.addedBySelf ? 'You' : 'Your parent or guardian';
	const intro = `${who} added this address for Curiosity Learning notifications for the account ${args.username}.`;
	const instruction = `Sign in as ${args.username} to confirm it.`;
	const ignore = "If you don't know what this is, you can ignore this email.";
	const strong = `<strong style="color:${colors.foreground};">${escapeHtml(args.username)}</strong>`;
	return {
		subject: 'Confirm your email for Curiosity Learning',
		text: `${intro} ${instruction}\n\n${url}\n\n${ignore}`,
		html: layout({
			preheader: intro,
			title: 'Confirm your email',
			children: `
				${paragraph(`${who} added this address for Curiosity Learning notifications for the account ${strong}. Sign in as ${strong} to confirm it.`)}
				${button(url, 'Confirm this email')}
				${rawLink(url)}
				${paragraph(escapeHtml(ignore))}
			`,
			footer: 'Nothing is sent to this address until it is confirmed.'
		})
	};
};

// The ONE email a parent gets when their 16+ child unlinks them (CL-769, review S7/D4): after
// it, nothing about the child reaches them (notificationRouting.ts rule 4). Deliberately bare:
// no link at all (the parent can no longer open the child's page, and a sign-in link would be a
// session for an account that has nothing to show), and nothing about the child's activity.
export const parentUnlinkedEmail = (args: { childName: string }): EmailContent => {
	const { childName } = args;
	const subject = `${childName} has unlinked your parent account`;
	const message = `${childName} has unlinked your parent account. You will no longer receive emails about ${childName}.`;
	return {
		subject,
		text: message,
		html: layout({
			preheader: message,
			title: subject,
			children: paragraph(escapeHtml(message)),
			footer: `You received this email because you were the parent or guardian on ${escapeHtml(childName)}'s Curiosity Learning account.`
		})
	};
};

// Edge case 4 (review): a parent-entered child address still unconfirmed after 3 days, most
// likely a typo or an inbox the child never checks. Sent once per address (crons, see
// childEmailVerification.sendPendingEmailReminders). Like the routing notice: plain link to the
// child's page, never a sign-in link.
export const childEmailPendingReminderEmail = (args: {
	childName: string;
	maskedEmail: string;
	days: number;
	childPageUrl?: string;
}): EmailContent => {
	const { childName, maskedEmail, days } = args;
	const subject = `${childName} hasn't confirmed their email address yet`;
	const message = `We sent a confirmation link to ${maskedEmail} ${days} days ago, and ${childName} hasn't confirmed it yet. Until they do, emails about ${childName}'s chats keep coming to you.`;
	const action = `Check that the address is right, or send a new link from ${childName}'s page.`;
	return {
		subject,
		text: [message, action, args.childPageUrl].filter(Boolean).join('\n\n'),
		html: layout({
			preheader: message,
			title: subject,
			children: `
				${paragraph(escapeHtml(message))}
				${paragraph(escapeHtml(action))}
				${args.childPageUrl ? `${button(args.childPageUrl, `Open ${childName}'s page`)}${rawLink(args.childPageUrl)}` : ''}
			`,
			footer: `You received this email because you are the parent or guardian on ${escapeHtml(childName)}'s Curiosity Learning account.`
		})
	};
};

export type ChildRoutingChange = 'pending' | 'confirmed' | 'removed';

// Notice to the PARENT (the approved consent address) whenever their child's email routing
// changes (CL-768, review S5): the change may have been made by someone else on a signed-in
// device. A plain link to the child's page — never a sign-in link: undoing a change needs a fresh
// sign-in anyway (sessionFreshness.ts), and this email must not hand out a session.
export const childRoutingChangedEmail = (args: {
	childName: string;
	change: ChildRoutingChange;
	maskedEmail?: string;
	childPageUrl?: string;
}): EmailContent => {
	const { childName, maskedEmail } = args;
	const subject =
		args.change === 'removed'
			? `${childName}'s notification emails come to you again`
			: args.change === 'confirmed'
				? `${childName}'s notification emails now go to ${maskedEmail}`
				: `${childName}'s notification emails are changing`;
	const message =
		args.change === 'removed'
			? `${childName}'s notification emails now come to you again.`
			: args.change === 'confirmed'
				? `${childName}'s notification emails now go to ${maskedEmail}.`
				: `${childName}'s notification emails will go to ${maskedEmail} once ${childName} confirms it.`;
	const undo = `Not you? Open ${childName}'s page to undo.`;
	return {
		subject,
		text: [message, undo, args.childPageUrl].filter(Boolean).join('\n\n'),
		html: layout({
			preheader: message,
			title: subject,
			children: `
				${paragraph(escapeHtml(message))}
				${paragraph(escapeHtml(undo))}
				${args.childPageUrl ? `${button(args.childPageUrl, `Open ${childName}'s page`)}${rawLink(args.childPageUrl)}` : ''}
			`,
			footer: `You received this email because you are the parent or guardian on ${childName}'s Curiosity Learning account.`
		})
	};
};
