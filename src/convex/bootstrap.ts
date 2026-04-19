import { v } from 'convex/values';
import { mutation } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';

const guidePermissions = [
	'club:read',
	'club:edit',
	'club_member:read_active',
	'club_member:kick',
	'session:read',
	'session:create',
	'session:update',
	'session:delete',
	'session_activity:read',
	'session_activity:create',
	'session_activity:update',
	'session_activity:delete',
	'session_activity_building_block:read',
	'session_activity_building_block:create',
	'session_activity_building_block:update',
	'session_activity_building_block:delete',
	'attendance:read',
	'attendance:create',
	'attendance:delete',
	'project:read',
	'project:create',
	'project:update',
	'project:link',
	'project:unlink',
	'updates:read',
	'updates:create',
	'updates:update'
];

const learnerPermissions = [
	'club:read',
	'session:read',
	'project:read',
	'attendance:read',
	'updates:read'
];

const projectCreatorPermissions = [
	'project:read',
	'project:update',
	'project:link',
	'project:unlink'
];
const projectContributorPermissions = ['project:read', 'project:update'];

const mergePermissions = (existing: string[] | undefined, desired: string[]) => {
	const set = new Set([...(existing ?? []), ...desired]);
	return Array.from(set);
};

export const seedDefaults = mutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();

		const guideRole = await ctx.db
			.query('clubRoles')
			.withIndex('by_name', (q) => q.eq('name', 'Guide'))
			.first();
		if (!guideRole) {
			await ctx.db.insert('clubRoles', {
				name: 'Guide',
				description: 'Club guide with management permissions',
				color: '#F97316',
				permissions: guidePermissions,
				order: 10,
				createdAt: now
			});
		} else {
			const merged = mergePermissions(guideRole.permissions, guidePermissions);
			if (merged.length !== guideRole.permissions.length) {
				await ctx.db.patch(guideRole._id, { permissions: merged });
			}
		}

		const learnerRole = await ctx.db
			.query('clubRoles')
			.withIndex('by_name', (q) => q.eq('name', 'Learner'))
			.first();
		if (!learnerRole) {
			await ctx.db.insert('clubRoles', {
				name: 'Learner',
				description: 'Learner with read-only access',
				color: '#2563EB',
				permissions: learnerPermissions,
				order: 100,
				createdAt: now
			});
		} else {
			const merged = mergePermissions(learnerRole.permissions, learnerPermissions);
			if (merged.length !== learnerRole.permissions.length) {
				await ctx.db.patch(learnerRole._id, { permissions: merged });
			}
		}

		const creatorRole = await ctx.db
			.query('projectRoles')
			.withIndex('by_name', (q) => q.eq('name', 'Creator'))
			.first();
		if (!creatorRole) {
			await ctx.db.insert('projectRoles', {
				name: 'Creator',
				permissions: projectCreatorPermissions,
				order: 10,
				createdAt: now
			});
		} else {
			const merged = mergePermissions(creatorRole.permissions, projectCreatorPermissions);
			if (merged.length !== creatorRole.permissions.length) {
				await ctx.db.patch(creatorRole._id, { permissions: merged });
			}
		}

		const contributorRole = await ctx.db
			.query('projectRoles')
			.withIndex('by_name', (q) => q.eq('name', 'Contributor'))
			.first();
		if (!contributorRole) {
			await ctx.db.insert('projectRoles', {
				name: 'Contributor',
				permissions: projectContributorPermissions,
				order: 50,
				createdAt: now
			});
		} else {
			const merged = mergePermissions(contributorRole.permissions, projectContributorPermissions);
			if (merged.length !== contributorRole.permissions.length) {
				await ctx.db.patch(contributorRole._id, { permissions: merged });
			}
		}

		const legalDocumentDefaults = [
			{
				documentKey: 'privacy_policy' as const,
				fullName: 'Privacy Policy' as const,
				title: 'Privacy Policy',
				content: 'Privacy policy content has not been configured yet.',
				version: '1.0'
			},
			{
				documentKey: 'terms_and_conditions' as const,
				fullName: 'Terms and Conditions' as const,
				title: 'Terms and Conditions',
				content: 'Terms and conditions content has not been configured yet.',
				version: '1.0'
			},
			{
				documentKey: 'cookie_policy' as const,
				fullName: 'Cookie Policy' as const,
				title: 'Cookie Policy',
				content:
					'We use essential and functional cookies to keep the app secure and improve your experience.',
				version: '1.0'
			}
		];

		for (const legalDocument of legalDocumentDefaults) {
			const activeDocument = await ctx.db
				.query('legalDocuments')
				.withIndex('by_document_key_and_active', (q) =>
					q.eq('documentKey', legalDocument.documentKey).eq('isActive', true)
				)
				.first();
			if (!activeDocument) {
				await ctx.db.insert('legalDocuments', {
					documentKey: legalDocument.documentKey,
					fullName: legalDocument.fullName,
					title: legalDocument.title,
					content: legalDocument.content,
					version: legalDocument.version,
					isActive: true,
					createdAt: now,
					updatedAt: now
				});
			}
		}

		const baseBlocks = [
			{
				name: 'Team building',
				slug: 'team-building',
				description: 'Activities that build trust, connection, and group cohesion.'
			},
			{
				name: 'Get curious',
				slug: 'get-curious',
				description: 'Spark curiosity and explore new ideas together.'
			},
			{
				name: 'Plan projects',
				slug: 'plan-projects',
				description: 'Plan and scope project work as a team.'
			},
			{
				name: 'Work on projects',
				slug: 'work-on-projects',
				description: 'Hands-on project execution time.'
			},
			{
				name: 'Share experiences',
				slug: 'share-experiences',
				description: 'Share progress, learnings, and reflections with the group.'
			},
			{
				name: 'Mini projects',
				slug: 'mini-projects',
				description: 'Short standalone activities that deliver a quick result.'
			}
		];

		const desiredSlugs = new Set(baseBlocks.map((b) => b.slug));

		for (const block of baseBlocks) {
			const existing = await ctx.db
				.query('buildingBlocks')
				.withIndex('by_slug', (q) => q.eq('slug', block.slug))
				.first();
			if (!existing) {
				await ctx.db.insert('buildingBlocks', {
					name: block.name,
					slug: block.slug,
					description: block.description,
					createdAt: now
				});
			}
		}

		// Remove building blocks not in the desired set
		const allBlocks = await ctx.db.query('buildingBlocks').collect();
		for (const block of allBlocks) {
			if (block.slug && !desiredSlugs.has(block.slug)) {
				// Remove any join rows referencing this block
				const bookletLinks = await ctx.db
					.query('bookletActivityBuildingBlocks')
					.withIndex('by_building_block', (q) => q.eq('buildingBlockId', block._id))
					.collect();
				for (const link of bookletLinks) {
					await ctx.db.delete(link._id);
				}
				const sessionLinks = await ctx.db
					.query('sessionActivityBuildingBlocks')
					.withIndex('by_building_block', (q) => q.eq('buildingBlockId', block._id))
					.collect();
				for (const link of sessionLinks) {
					await ctx.db.delete(link._id);
				}
				await ctx.db.delete(block._id);
			}
		}

		return { success: true };
	}
});

const FIXED_TEST_CLUB_CODE = '84NPWT';
const NETHERLANDS_TEST_CLUBS = [
	{
		name: 'Vondelpark Curiosity Club',
		clubCode: 'AMS101',
		description: 'A public Amsterdam test club inspired by park learning circles and creative city walks.',
		location: 'Vondelpark, Amsterdam, Netherlands',
		locationLatitude: 52.357994,
		locationLongitude: 4.868648,
		meetingDay: 'Wednesday',
		meetingTime: '4:00 pm'
	},
	{
		name: 'Leiden Hortus Explorers Club',
		clubCode: 'LDN202',
		description: 'A public Leiden test club for science, nature journaling, and mini research projects.',
		location: 'Hortus Botanicus Leiden, Leiden, Netherlands',
		locationLatitude: 52.158989,
		locationLongitude: 4.485993,
		meetingDay: 'Thursday',
		meetingTime: '4:30 pm'
	},
	{
		name: 'Utrecht Science Garden Club',
		clubCode: 'UTC303',
		description: 'A public Utrecht test club built around experiments, design challenges, and maker sessions.',
		location: 'Utrecht Science Park, Utrecht, Netherlands',
		locationLatitude: 52.085312,
		locationLongitude: 5.174207,
		meetingDay: 'Tuesday',
		meetingTime: '5:00 pm'
	},
	{
		name: 'Rotterdam Garden Bridge Club',
		clubCode: 'RTD404',
		description: 'A public Rotterdam test club blending urban nature, teamwork, and community project ideas.',
		location: 'Trompenburg Tuinen, Rotterdam, Netherlands',
		locationLatitude: 51.918236,
		locationLongitude: 4.510173,
		meetingDay: 'Saturday',
		meetingTime: '11:00 am'
	},
	{
		name: 'Eindhoven Schoolyard Makers Club',
		clubCode: 'EHV505',
		description: 'A public Eindhoven test club focused on prototyping, robotics, and collaborative builds.',
		location: 'TU Eindhoven Campus, Eindhoven, Netherlands',
		locationLatitude: 51.448214,
		locationLongitude: 5.489609,
		meetingDay: 'Monday',
		meetingTime: '4:15 pm'
	},
	{
		name: 'The Hague Peace Garden Club',
		clubCode: 'HAG606',
		description: 'A public Hague test club for storytelling, civic curiosity, and reflective learning projects.',
		location: 'Westbroekpark, The Hague, Netherlands',
		locationLatitude: 52.097522,
		locationLongitude: 4.311856,
		meetingDay: 'Friday',
		meetingTime: '4:45 pm'
	},
	{
		name: 'Groningen Greenhouse Club',
		clubCode: 'GRN707',
		description: 'A public Groningen test club for ecology, climate ideas, and hands-on exploration.',
		location: 'Prinsentuin, Groningen, Netherlands',
		locationLatitude: 53.221428,
		locationLongitude: 6.573156,
		meetingDay: 'Wednesday',
		meetingTime: '3:45 pm'
	},
	{
		name: 'Maastricht River Garden Club',
		clubCode: 'MST808',
		description: 'A public Maastricht test club mixing local history, design prompts, and group discovery.',
		location: 'Stadspark Maastricht, Maastricht, Netherlands',
		locationLatitude: 50.844954,
		locationLongitude: 5.692029,
		meetingDay: 'Sunday',
		meetingTime: '10:30 am'
	}
] as const;

export const seedClubCode84NPWT = mutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();

		const existingClubWithField = await ctx.db
			.query('clubs')
			.withIndex('by_club_code', (q) => q.eq('clubCode', FIXED_TEST_CLUB_CODE))
			.first();
		if (existingClubWithField) {
			return {
				success: true,
				created: false,
				clubId: existingClubWithField._id,
				code: FIXED_TEST_CLUB_CODE
			};
		}

		const clubId = await ctx.db.insert('clubs', {
			name: 'Demo Curiosity Club',
			clubCode: FIXED_TEST_CLUB_CODE,
			description: 'Demo club for onboarding invite code testing.',
			location: 'Amsterdam',
			meetingDay: 'Wednesday',
			meetingTime: '4:00 pm',
			createdByUserId: 'seed-script',
			createdAt: now,
			updatedAt: now
		});

		return {
			success: true,
			created: true,
			clubId,
			code: FIXED_TEST_CLUB_CODE
		};
	}
});

export const seedNetherlandsMapClubs = mutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const seededClubIds: string[] = [];
		let createdCount = 0;
		let updatedCount = 0;

		for (const seed of NETHERLANDS_TEST_CLUBS) {
			const existing = await ctx.db
				.query('clubs')
				.withIndex('by_club_code', (q) => q.eq('clubCode', seed.clubCode))
				.first();

			if (existing) {
				await ctx.db.patch(existing._id, {
					name: seed.name,
					description: seed.description,
					location: seed.location,
					locationLatitude: seed.locationLatitude,
					locationLongitude: seed.locationLongitude,
					meetingDay: seed.meetingDay,
					meetingTime: seed.meetingTime,
					updatedAt: now
				});
				seededClubIds.push(existing._id);
				updatedCount += 1;
				continue;
			}

			const clubId = await ctx.db.insert('clubs', {
				name: seed.name,
				clubCode: seed.clubCode,
				description: seed.description,
				location: seed.location,
				locationLatitude: seed.locationLatitude,
				locationLongitude: seed.locationLongitude,
				meetingDay: seed.meetingDay,
				meetingTime: seed.meetingTime,
				createdByUserId: 'seed-script',
				createdAt: now,
				updatedAt: now
			});

			seededClubIds.push(clubId);
			createdCount += 1;
		}

		return {
			success: true,
			createdCount,
			updatedCount,
			total: NETHERLANDS_TEST_CLUBS.length,
			clubIds: seededClubIds
		};
	}
});

const bookletActivitiesData: Array<{
	name: string;
	content: string;
	minutes: number;
	blocks: string[];
}> = [
	{
		name: 'Two Truths and a Lie',
		content:
			'Each person shares three statements about themselves — two true, one false. The group guesses which is the lie. Great for learning fun facts about each other and breaking the ice in new or mixed groups.',
		minutes: 15,
		blocks: ['team-building']
	},
	{
		name: 'The Human Knot',
		content:
			'Everyone stands in a circle, reaches across, and grabs two different hands. Without letting go, the group works together to untangle into a circle. Builds communication, patience, and problem-solving skills.',
		minutes: 10,
		blocks: ['team-building']
	},
	{
		name: 'Marshmallow Challenge',
		content:
			'Teams of 4 get 20 sticks of spaghetti, 1 metre of tape, 1 metre of string, and 1 marshmallow. The goal: build the tallest freestanding structure with the marshmallow on top. Debrief on prototyping and iteration.',
		minutes: 25,
		blocks: ['team-building', 'mini-projects']
	},
	{
		name: 'Appreciation Circle',
		content:
			'Sit in a circle. Each person shares one thing they appreciate about the person to their left. Strengthens bonds and creates a positive atmosphere. Works best after a few sessions together.',
		minutes: 10,
		blocks: ['team-building', 'share-experiences']
	},
	{
		name: 'Question Carousel',
		content:
			'Post big questions around the room (e.g., "What problem would you love to solve?", "What skill do you wish you had?"). Learners rotate in pairs, discussing each question for 2 minutes before moving on.',
		minutes: 20,
		blocks: ['get-curious']
	},
	{
		name: 'Wonder Wall',
		content:
			'Give everyone sticky notes. Each person writes 3 things they wonder about or want to learn. Post them on a shared wall. Group similar questions together and discuss the top themes.',
		minutes: 15,
		blocks: ['get-curious']
	},
	{
		name: 'Expert Interview',
		content:
			'Invite a community member, parent, or professional as a guest. Learners prepare questions in advance, then conduct the interview as a group. Debrief on what surprised them.',
		minutes: 30,
		blocks: ['get-curious', 'share-experiences']
	},
	{
		name: 'Curiosity Safari',
		content:
			'Go on a walk around the local area with notebooks. Learners document interesting things they notice — patterns, problems, surprises. Return and share top findings. Great for sparking project ideas.',
		minutes: 30,
		blocks: ['get-curious']
	},
	{
		name: 'Project Pitch Practice',
		content:
			'Each team gets 5 minutes to pitch their project idea to the group. Use the format: Problem → Solution → First Step. Other teams give constructive feedback using "I like / I wish / What if" prompts.',
		minutes: 25,
		blocks: ['plan-projects']
	},
	{
		name: 'Goal Setting Workshop',
		content:
			'Each team defines their project goal using the SMART framework (Specific, Measurable, Achievable, Relevant, Time-bound). Write it on a poster and present to the group for feedback.',
		minutes: 20,
		blocks: ['plan-projects']
	},
	{
		name: 'Task Breakdown',
		content:
			'Teams take their project goal and break it into individual tasks. Use sticky notes — one task per note. Arrange them in order, assign owners, and estimate time. Post the plan visibly.',
		minutes: 20,
		blocks: ['plan-projects', 'work-on-projects']
	},
	{
		name: 'Focused Work Sprint',
		content:
			'Set a timer for 25 minutes of focused project work (Pomodoro style). No phones, no switching tasks. After the sprint, take a 5-minute break and share one thing you accomplished.',
		minutes: 30,
		blocks: ['work-on-projects']
	},
	{
		name: 'Pair Programming / Pair Work',
		content:
			'Two learners work on the same task together — one drives, one navigates. Switch roles halfway. Builds collaboration skills and helps learners get unstuck faster.',
		minutes: 25,
		blocks: ['work-on-projects']
	},
	{
		name: 'Stand-Up Check-In',
		content:
			'Quick round-the-room update: each person shares (1) what they did since last session, (2) what they plan to do today, (3) any blockers. Keep it to 1-2 minutes per person.',
		minutes: 10,
		blocks: ['work-on-projects', 'share-experiences']
	},
	{
		name: 'Demo Day',
		content:
			'Each team demonstrates their project progress to the group. Can be a working prototype, a design, or a plan walkthrough. Other teams ask questions and give feedback.',
		minutes: 30,
		blocks: ['share-experiences']
	},
	{
		name: 'Reflection Journal',
		content:
			'Give learners 10 minutes of quiet writing time. Prompts: "What did I learn today?", "What am I proud of?", "What would I do differently?". Optional: share one highlight with the group.',
		minutes: 15,
		blocks: ['share-experiences']
	},
	{
		name: 'Gallery Walk',
		content:
			'Teams set up stations showing their work. Everyone walks around, views each project, and leaves feedback on sticky notes. Rotate every 3-4 minutes. Debrief as a full group.',
		minutes: 20,
		blocks: ['share-experiences']
	},
	{
		name: 'One-Hour Website',
		content:
			'Build a simple personal or project website in one session using a free tool (Google Sites, Carrd, or HTML). Focus on "done is better than perfect". Share the link at the end.',
		minutes: 45,
		blocks: ['mini-projects']
	},
	{
		name: 'Design a Logo',
		content:
			'Each learner or team designs a logo for their project or club using paper, markers, or a free design tool like Canva. Present the logo and explain the design choices.',
		minutes: 25,
		blocks: ['mini-projects']
	},
	{
		name: 'The Envelope Please',
		content:
			'Write a challenge on a card and seal it in an envelope. Teams swap envelopes and have 20 minutes to solve the challenge. Present solutions at the end. Challenges can be creative, technical, or community-based.',
		minutes: 30,
		blocks: ['mini-projects', 'get-curious']
	}
];

export const seedBookletActivities = mutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();

		// Ensure building blocks exist first
		const allBlocks = await ctx.db.query('buildingBlocks').collect();
		const blockBySlug = new Map(allBlocks.map((b) => [b.slug, b._id] as const));

		// Clear existing booklet activities and their links
		const existingActivities = await ctx.db.query('bookletActivities').collect();
		for (const activity of existingActivities) {
			const links = await ctx.db
				.query('bookletActivityBuildingBlocks')
				.withIndex('by_activity', (q) => q.eq('activityId', activity._id))
				.collect();
			for (const link of links) {
				await ctx.db.delete(link._id);
			}
			await ctx.db.delete(activity._id);
		}

		for (const item of bookletActivitiesData) {
			const activityId = await ctx.db.insert('bookletActivities', {
				name: item.name,
				content: item.content,
				minutes: item.minutes,
				status: 'published',
				createdAt: now,
				updatedAt: now
			});

			for (const slug of item.blocks) {
				const blockId = blockBySlug.get(slug);
				if (blockId) {
					await ctx.db.insert('bookletActivityBuildingBlocks', {
						activityId,
						buildingBlockId: blockId
					});
				}
			}
		}

		return { success: true, count: bookletActivitiesData.length };
	}
});

export const setClubMemberRoleByEmail = mutation({
	args: {
		email: v.string(),
		roleName: v.union(v.literal('Guide'), v.literal('Learner')),
		clubCode: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const normalizedEmail = args.email.trim().toLowerCase();
		if (!normalizedEmail) {
			throw new Error('Email is required');
		}

		const targetRole = await ctx.db
			.query('clubRoles')
			.withIndex('by_name', (q) => q.eq('name', args.roleName))
			.first();
		if (!targetRole) {
			throw new Error(`Role ${args.roleName} not found`);
		}

		let targetClubId: Id<'clubs'> | null = null;
		let normalizedClubCode: string | null = null;
		if (args.clubCode) {
			const requestedClubCode = args.clubCode.trim().toUpperCase();
			normalizedClubCode = requestedClubCode;
			const club = await ctx.db
				.query('clubs')
				.withIndex('by_club_code', (q) => q.eq('clubCode', requestedClubCode))
				.first();
			if (!club) {
				throw new Error(`Club with code ${normalizedClubCode} was not found`);
			}
			targetClubId = club._id;
		}

		const profiles = await ctx.db
			.query('profiles')
			.withIndex('by_email', (q) => q.eq('email', normalizedEmail))
			.collect();
		if (!profiles.length) {
			throw new Error(`No profile found for email ${normalizedEmail}`);
		}

		const userIds = Array.from(new Set(profiles.map((profile) => profile.userId)));
		const candidates: Array<{
			membership: Doc<'clubMembers'>;
			previousRoleName: string | null;
			clubCode: string | null;
		}> = [];

		for (const userId of userIds) {
			const memberships = await ctx.db
				.query('clubMembers')
				.withIndex('by_user', (q) => q.eq('userId', userId))
				.collect();
			for (const membership of memberships) {
				if (membership.leftAt) continue;
				if (targetClubId && membership.clubId !== targetClubId) continue;

				const [previousRole, club] = await Promise.all([
					ctx.db.get(membership.roleId),
					ctx.db.get(membership.clubId)
				]);

				candidates.push({
					membership,
					previousRoleName: previousRole?.name ?? null,
					clubCode: club?.clubCode ?? null
				});
			}
		}

		if (!candidates.length) {
			throw new Error(
				targetClubId
					? `No active membership found for ${normalizedEmail} in club ${normalizedClubCode}`
					: `No active membership found for ${normalizedEmail}`
			);
		}

		if (!targetClubId && candidates.length > 1) {
			const memberships = candidates.map((candidate) => ({
				clubMemberId: candidate.membership._id,
				clubCode: candidate.clubCode,
				currentRole: candidate.previousRoleName
			}));
			throw new Error(
				`Multiple active memberships found for ${normalizedEmail}. Re-run with clubCode. ` +
					`Matches: ${JSON.stringify(memberships)}`
			);
		}

		let updated = 0;
		let unchanged = 0;
		for (const candidate of candidates) {
			if (candidate.membership.roleId === targetRole._id) {
				unchanged += 1;
				continue;
			}
			await ctx.db.patch(candidate.membership._id, { roleId: targetRole._id });
			updated += 1;
		}

		return {
			success: true,
			email: normalizedEmail,
			roleName: args.roleName,
			updated,
			unchanged,
			memberships: candidates.map((candidate) => ({
				clubMemberId: candidate.membership._id,
				clubId: candidate.membership.clubId,
				clubCode: candidate.clubCode,
				previousRoleName: candidate.previousRoleName,
				newRoleName: args.roleName
			}))
		};
	}
});
