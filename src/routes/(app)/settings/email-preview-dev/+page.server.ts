import {
	parentConsentEmail,
	passwordResetEmail,
	verificationOtpEmail,
	type EmailContent
} from '$convex/email/templates';
import type { PageServerLoad } from './$types';

type EmailPreview = EmailContent & {
	id: string;
	label: string;
	description: string;
};

const sampleUrl = 'https://app.curiositylearning.org/example/action-token';

export const load: PageServerLoad = () => {
	const previews: Array<EmailPreview> = [
		{
			id: 'email-verification',
			label: 'Email verification code',
			description: 'Sent during adult email signup and verification-code resend.',
			...verificationOtpEmail({ otp: '123456', type: 'email-verification' })
		},
		{
			id: 'sign-in-code',
			label: 'Sign-in code',
			description: 'Sent when Better Auth requests an email OTP for sign-in.',
			...verificationOtpEmail({ otp: '482913', type: 'sign-in' })
		},
		{
			id: 'forgot-password-code',
			label: 'Forgot-password code',
			description: 'Sent when Better Auth requests an OTP for password recovery.',
			...verificationOtpEmail({ otp: '735204', type: 'forget-password' })
		},
		{
			id: 'password-reset',
			label: 'Password reset link',
			description: 'Sent by the Better Auth password-reset hook.',
			...passwordResetEmail({ url: sampleUrl, token: 'sample-reset-token' })
		},
		{
			id: 'parent-consent',
			label: 'Parent consent',
			description: 'Sent when an under-16 learner creates an account.',
			...parentConsentEmail({
				childUsername: 'sam_curiosity',
				consentUrl: 'https://app.curiositylearning.org/onboarding/parent-consent/sample-token'
			})
		}
	];

	return { previews };
};
