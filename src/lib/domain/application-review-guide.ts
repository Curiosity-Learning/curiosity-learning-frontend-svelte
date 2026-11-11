// CL-780: the guide for Guides reviewing club applications, as written by Ron (2026-11-11). One
// source for the full guide page (/applications/review/guide) and the hints next to the scoring
// form on the application page. English only, like the rest of the app today.
//
// The three dimensions and the 1-5 scale here must match what the backend accepts
// (clubApplications.upsertApplicationReview: alignmentScore / motivationScore / readinessScore,
// whole numbers 1-5).

export type ReviewDimensionKey = 'alignment' | 'motivation' | 'readiness';

export type ReviewDimension = {
	key: ReviewDimensionKey;
	title: string;
	question: string;
	intro?: string;
	indications: string[];
	// Alignment only: things that look like misalignment but can be cleared up in the interview.
	misunderstandings?: { intro: string; items: string[] };
};

export type ReviewScaleStep = {
	value: 1 | 2 | 3 | 4 | 5;
	label: string;
	description: string;
};

export const REVIEW_SCORE_VALUES = [1, 2, 3, 4, 5] as const;

export const reviewGuide = {
	thanks:
		'Thank you for supporting the Curiosity Learning community and taking on the responsibility of reviewing applicants for the coming season.',
	purpose: 'Decide if the applicant should move forward to an interview.',
	overview: [
		"Each application is reviewed by 3-5 people. This helps us avoid making decisions based on one person's opinion, and lets us see how aligned the reviews are.",
		'The interview is mostly a formality. If someone is invited to an interview, we generally expect them to become a Curiosity Club Guide unless something important comes up.'
	],
	steps: [
		'Read the full written application.',
		'Watch the full application video.',
		'Judge the person on what they are saying, not on how polished their application is.',
		'Score the application from 1 to 5 on Alignment, Motivation and Readiness.',
		'Write down anything that should be clarified during the interview.',
		'Submit your review.'
	],
	notAgainst: {
		intro: 'These should not lower someone’s score by themselves:',
		items: [
			'Their English is not perfect.',
			'They are nervous or awkward on camera.',
			'Their video or audio quality is not very good.',
			'They do not have a lot of previous experience.'
		]
	},
	dimensions: [
		{
			key: 'alignment',
			title: 'Alignment',
			question: 'How aligned do they seem with the idea of Curiosity Learning and Curiosity Clubs?',
			indications: [
				'They care about curiosity, learning and exploration.',
				'They understand that learners should choose what they want to explore.',
				'They seem interested in guiding rather than teaching.',
				'They seem comfortable with a peer-to-peer environment.',
				'They do not seem focused on controlling what happens in the club.'
			],
			misunderstandings: {
				intro:
					'A misunderstanding is not the same as misalignment. If they seem aligned but misunderstood some parts, this can be clarified during the interview. Common misunderstandings:',
				items: [
					'They talk about wanting to “teach” people.',
					'They want to start a club about one specific topic.',
					'They think Curiosity Clubs are only for kids.',
					'They seem to think the Guide decides what everyone learns.'
				]
			}
		},
		{
			key: 'motivation',
			title: 'Motivation',
			question: 'How much do they seem to genuinely want to start a Curiosity Club?',
			indications: [
				'They have a clear reason for applying.',
				'They seem excited about creating this kind of space.',
				'Their motivation feels genuine and personal.',
				'They seem interested in the actual experience of running a club, not only in having the title of Guide.'
			]
		},
		{
			key: 'readiness',
			title: 'Readiness',
			question: 'How ready do they seem to actually start and run a Curiosity Club?',
			intro: 'Previous leadership experience can be a positive sign, but it is not required.',
			indications: [
				'They seem willing to take initiative.',
				'They seem reliable enough to follow through.',
				'They seem willing to put time and effort into the club.',
				'They seem open to learning and improving as they go.'
			]
		}
	] as ReviewDimension[],
	scale: [
		{
			value: 1,
			label: 'Very weak',
			description: 'There are serious concerns or very little evidence of this.'
		},
		{
			value: 2,
			label: 'Weak',
			description: 'There are some positive signs, but you still have significant doubts.'
		},
		{
			value: 3,
			label: 'Good enough',
			description: 'There is enough evidence to feel comfortable moving them forward.'
		},
		{
			value: 4,
			label: 'Strong',
			description: 'There is clear evidence that they have this quality.'
		},
		{
			value: 5,
			label: 'Very strong',
			description: 'This is one of the strongest parts of their application and clearly stands out.'
		}
	] as ReviewScaleStep[],
	clarifyExamples: [
		'They seem to think the club should focus on one topic.',
		'They talk a lot about teaching.',
		'You are unsure if they understand the time commitment.',
		'Something in the written application and the video seems different or unclear.'
	],
	important: [
		'We are not looking for the most impressive applicants.',
		'We are looking for people who care about the idea, seem aligned with Curiosity Learning, and are willing to take responsibility for starting a club.',
		'A score of 3 is a positive score. It means there is enough there for us to feel comfortable moving the person forward.',
		'If you are unsure between two scores, use your best judgement. Every application is reviewed by several people, so your score does not decide the outcome on its own.'
	]
};

export const reviewScaleLabel = (value: number) =>
	reviewGuide.scale.find((step) => step.value === value)?.label ?? '';
