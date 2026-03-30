import { mutation, query } from './_generated/server';
import { requireIdentity } from './permissions';

const DEFAULT_PLEDGES = [
	{
		key: 'guiding_principle_1',
		title: "We guide, and don't teach.",
		description:
			'Curiosity thrives when we guide instead of instructing or pressuring performance. We ask questions, encourage each other, and model curiosity rather than giving ready-made answers.',
		bullets: [
			'Use open-ended questions to move learning forward instead of giving ready-made answers.',
			'Emphasize learning process and discovery over correctness and only final outcomes.',
			'Encourage each other to explain ideas, choices, and reasoning.'
		],
		order: 10
	},
	{
		key: 'guiding_principle_2',
		title: 'We support independent and autonomous learning.',
		description:
			'At the heart of curiosity is autonomy. Learners are free to explore topics they care about, set goals, and choose how they work while guides provide only the structure that is truly needed.',
		bullets: [
			'Learners choose or shape projects based on their interests.',
			'Learners decide roles and planning while guides act as facilitators.',
			'Learners reflect on what they want to learn and adjust plans accordingly.'
		],
		order: 20
	},
	{
		key: 'guiding_principle_3',
		title: 'We create a safe and supportive environment.',
		description:
			'Learning includes uncertainty and mistakes. Everyone should feel safe to express ideas, take risks, fail, and try again without fear of embarrassment, bullying, or exclusion.',
		bullets: [
			'Foster psychological safety so everyone feels respected, seen, and heard.',
			'Actively include learners who may be at risk of exclusion.',
			'Respectful listening, kindness, and respectful communication are mandatory.'
		],
		order: 30
	},
	{
		key: 'guiding_principle_4',
		title: 'We are consistent and reliable.',
		description:
			'Consistency builds trust and momentum. Clubs should run with predictable rhythm, clear communication, and preparation so everyone knows what to expect.',
		bullets: [
			'Run sessions at least once per week and start/end at agreed times.',
			'Maintain clear communication about schedules and commitments.',
			'Prepare clear session plans, materials, and flow.'
		],
		order: 40
	},
	{
		key: 'guiding_principle_5',
		title: 'We work as a team, collaboratively.',
		description:
			'Intrinsic motivation grows in collaborative environments. We broaden perspectives through teamwork, shared problem-solving, and mutual support.',
		bullets: [
			'Work in pairs or groups most of the time with shared tasks and roles.',
			'Give constructive feedback and develop conflict-mediation skills.',
			'Use shared planning, decision-making, and mutual accountability.'
		],
		order: 50
	},
	{
		key: 'guiding_principle_6',
		title: 'We expose each other to new ideas and perspectives.',
		description:
			'Curiosity starts with exposure. Sessions should open learners to unfamiliar ideas, disciplines, people, and perspectives that challenge assumptions.',
		bullets: [
			'Invite engagement with unfamiliar concepts, people, or media in each session.',
			'Collaborate with other clubs when possible for broader exposure.',
			'Encourage learning across disciplines and from diverse sources.'
		],
		order: 60
	},
	{
		key: 'guiding_principle_7',
		title: 'We nurture our love for learning.',
		description:
			'Curiosity is intrinsic. We nurture motivation through autonomy, joy, and purpose, not pressure, competition, or external reward.',
		bullets: [
			'Frame learning as discovery, not performance pressure.',
			'Connect projects to personal interests and meaningful goals.',
			'Celebrate growth, curiosity, and effort over only “correct” results.'
		],
		order: 70
	},
	{
		key: 'guiding_principle_8',
		title: 'We are part of the larger community.',
		description:
			'Each club belongs to the wider Curiosity Learning ecosystem and its local community. Clubs should share ideas, support peers, and aim for positive local impact.',
		bullets: [
			'Build partnerships with local schools or organizations where possible.',
			'Share projects beyond club boundaries.',
			'Design projects to contribute positively to local and broader communities.'
		],
		order: 80
	}
] as const;

export const listActive = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.db
			.query('pledges')
			.withIndex('by_active_and_order', (q) => q.eq('isActive', true))
			.collect();
	}
});

export const seedDefaults = mutation({
	args: {},
	handler: async (ctx) => {
		await requireIdentity(ctx);
		const now = Date.now();

		for (const pledge of DEFAULT_PLEDGES) {
			const existing = await ctx.db
				.query('pledges')
				.withIndex('by_key', (q) => q.eq('key', pledge.key))
				.first();

			if (!existing) {
				await ctx.db.insert('pledges', {
					key: pledge.key,
					title: pledge.title,
					description: pledge.description,
					bullets: [...pledge.bullets],
					order: pledge.order,
					isActive: true,
					createdAt: now,
					updatedAt: now
				});
				continue;
			}

			await ctx.db.patch(existing._id, {
				title: pledge.title,
				description: pledge.description,
				bullets: [...pledge.bullets],
				order: pledge.order,
				isActive: true,
				updatedAt: now
			});
		}

		const activePledges = await ctx.db
			.query('pledges')
			.withIndex('by_active_and_order', (q) => q.eq('isActive', true))
			.collect();

		return {
			success: true,
			count: activePledges.length
		};
	}
});
