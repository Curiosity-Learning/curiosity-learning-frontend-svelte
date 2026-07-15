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
const isLocalUrl = (value: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value);

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

const layout = (args: {
	preheader: string;
	title: string;
	children: string;
	footer?: string;
}) => {
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

// Generic template for tiered notification emails (CL-715). Renders the same title/message
// pair that is stored on the in-app `notifications` row, plus an optional CTA link into the app.
export const notificationEmail = (args: {
	title: string;
	message: string;
	ctaUrl?: string;
}): EmailContent => {
	const message = escapeHtml(args.message);
	return {
		subject: args.title,
		text: args.ctaUrl ? `${args.message}\n\n${args.ctaUrl}` : args.message,
		html: layout({
			preheader: args.message,
			title: args.title,
			children: `
				${paragraph(message)}
				${args.ctaUrl ? `${button(args.ctaUrl, 'Open Curiosity Learning')}${rawLink(args.ctaUrl)}` : ''}
			`,
			footer:
				'You received this email because of activity on your Curiosity Learning account. You can adjust which notifications you receive in Settings.'
		})
	};
};
