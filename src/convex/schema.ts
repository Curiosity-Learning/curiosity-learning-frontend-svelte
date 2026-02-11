import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
	profiles: defineTable({
		userId: v.string(),
		email: v.string(),
		firstName: v.optional(v.string()),
		lastName: v.optional(v.string()),
		username: v.optional(v.string()),
		coverPhotoUrl: v.optional(v.string()),
		dateOfBirth: v.optional(v.string()),
		isVerified: v.boolean(),
		activeClubId: v.optional(v.id('clubs')),
		lastLogin: v.optional(v.number()),
		fcmToken: v.optional(v.string()),
		firstLoginCompleted: v.boolean(),
		about: v.optional(v.string()),
		howDidYouFindUs: v.optional(v.string()),
		identity: v.optional(v.string()),
		locationAddress: v.optional(v.string()),
		videoUrl: v.optional(v.string()),
		pendingClubCode: v.optional(v.string()),
		pendingRole: v.optional(v.union(v.literal('Learner'), v.literal('Guide'))),
		updatedAt: v.number()
	})
		.index('by_user_id', ['userId'])
		.index('by_email', ['email'])
		.index('by_username', ['username']),

	clubRoles: defineTable({
		name: v.string(),
		description: v.optional(v.string()),
		color: v.optional(v.string()),
		permissions: v.array(v.string()),
		order: v.number(),
		createdAt: v.number()
	}).index('by_name', ['name']),

	clubs: defineTable({
		name: v.string(),
		location: v.optional(v.string()),
		description: v.optional(v.string()),
		time: v.optional(v.number()),
		videoUrl: v.optional(v.string()),
		meetingDay: v.optional(v.string()),
		meetingTime: v.optional(v.string()),
		createdByUserId: v.string(),
		createdAt: v.number(),
		updatedAt: v.number()
	}).index('by_created_by', ['createdByUserId']),

	clubCodes: defineTable({
		clubId: v.id('clubs'),
		code: v.string(),
		createdAt: v.number()
	})
		.index('by_code', ['code'])
		.index('by_club', ['clubId']),

	clubMembers: defineTable({
		clubId: v.id('clubs'),
		userId: v.string(),
		roleId: v.id('clubRoles'),
		// Denormalized profile fields for faster member lists.
		firstName: v.optional(v.string()),
		lastName: v.optional(v.string()),
		username: v.optional(v.string()),
		email: v.optional(v.string()),
		coverPhotoUrl: v.optional(v.string()),
		leftAt: v.optional(v.number()),
		createdAt: v.number()
	})
		.index('by_club', ['clubId'])
		.index('by_user', ['userId'])
		.index('by_club_and_user', ['clubId', 'userId']),

	sessions: defineTable({
		clubId: v.id('clubs'),
		datetime: v.number(),
		description: v.string(),
		startTime: v.number(),
		endTime: v.number(),
		createdByUserId: v.string(),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_club', ['clubId'])
		.index('by_club_and_start', ['clubId', 'startTime']),

	buildingBlocks: defineTable({
		name: v.string(),
		description: v.optional(v.string()),
		slug: v.optional(v.string()),
		createdAt: v.number()
	}).index('by_slug', ['slug']),

	bookletActivities: defineTable({
		name: v.optional(v.string()),
		content: v.optional(v.string()),
		minutes: v.optional(v.number()),
		status: v.optional(v.string()),
		reviewedAt: v.optional(v.number()),
		previousActivityId: v.optional(v.id('bookletActivities')),
		createdByUserId: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number()
	}).index('by_created_by', ['createdByUserId']),

	bookletActivityBuildingBlocks: defineTable({
		activityId: v.id('bookletActivities'),
		buildingBlockId: v.id('buildingBlocks')
	})
		.index('by_activity', ['activityId'])
		.index('by_building_block', ['buildingBlockId']),

	sessionActivities: defineTable({
		sessionId: v.id('sessions'),
		name: v.string(),
		slug: v.optional(v.string()),
		content: v.optional(v.string()),
		minutes: v.optional(v.number()),
		createdByUserId: v.string(),
		bookletActivityId: v.optional(v.id('bookletActivities')),
		createdAt: v.number(),
		updatedAt: v.number()
	}).index('by_session', ['sessionId']),

	sessionActivityBuildingBlocks: defineTable({
		sessionActivityId: v.id('sessionActivities'),
		// Optional denormalized foreign key to allow single-query fetch per session.
		sessionId: v.optional(v.id('sessions')),
		buildingBlockId: v.id('buildingBlocks'),
		createdAt: v.number()
	})
		.index('by_session_activity', ['sessionActivityId'])
		.index('by_session', ['sessionId'])
		.index('by_building_block', ['buildingBlockId']),

	attendances: defineTable({
		sessionId: v.id('sessions'),
		userId: v.string(),
		createdByUserId: v.string(),
		createdAt: v.number()
	})
		.index('by_session', ['sessionId'])
		.index('by_session_and_user', ['sessionId', 'userId']),

	projectRoles: defineTable({
		permissions: v.array(v.string()),
		name: v.string(),
		order: v.number(),
		createdAt: v.number()
	}).index('by_name', ['name']),

	projects: defineTable({
		name: v.string(),
		dueDate: v.optional(v.number()),
		doneDate: v.optional(v.number()),
		description: v.optional(v.string()),
		createdByUserId: v.string(),
		createdAt: v.number(),
		updatedAt: v.number()
	}).index('by_created_by', ['createdByUserId']),

	projectClubs: defineTable({
		projectId: v.id('projects'),
		clubId: v.id('clubs'),
		createdAt: v.number()
	})
		.index('by_project', ['projectId'])
		.index('by_club', ['clubId'])
		.index('by_club_and_project', ['clubId', 'projectId']),

	projectMembers: defineTable({
		projectId: v.id('projects'),
		userId: v.string(),
		leftAt: v.optional(v.number()),
		roleId: v.id('projectRoles'),
		// Denormalized profile fields for faster member lists.
		firstName: v.optional(v.string()),
		lastName: v.optional(v.string()),
		username: v.optional(v.string()),
		email: v.optional(v.string()),
		coverPhotoUrl: v.optional(v.string()),
		createdAt: v.number()
	})
		.index('by_project', ['projectId'])
		.index('by_user', ['userId'])
		.index('by_project_and_user', ['projectId', 'userId']),

	questions: defineTable({
		content: v.string(),
		createdAt: v.number()
	}),

	updates: defineTable({
		projectId: v.optional(v.id('projects')),
		content: v.string(),
		createdByUserId: v.string(),
		questionId: v.optional(v.id('questions')),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_project', ['projectId'])
		.index('by_project_and_created', ['projectId', 'createdAt']),

	updateClubs: defineTable({
		updateId: v.id('updates'),
		clubId: v.id('clubs'),
		projectId: v.optional(v.id('projects')),
		createdAt: v.number()
	})
		.index('by_club_and_created', ['clubId', 'createdAt'])
		.index('by_update', ['updateId']),

	updateFiles: defineTable({
		updateId: v.id('updates'),
		storageId: v.string(),
		createdAt: v.number()
	}).index('by_update', ['updateId']),

	notifications: defineTable({
		userId: v.string(),
		clubId: v.optional(v.id('clubs')),
		title: v.string(),
		message: v.string(),
		isRead: v.boolean(),
		url: v.optional(v.string()),
		createdAt: v.number()
	})
		.index('by_user', ['userId'])
		.index('by_user_and_created', ['userId', 'createdAt']),

	userPreferences: defineTable({
		userId: v.string(),
		activeClubId: v.optional(v.id('clubs')),
		theme: v.union(v.literal('light'), v.literal('dark'), v.literal('system')),
		notificationsEnabled: v.boolean(),
		notificationPreferences: v.object({
			clubMemberChanges: v.boolean(),
			projectDeadlineReminder: v.boolean(),
			projectMemberAdded: v.boolean(),
			projectCompleted: v.boolean(),
			sessionReminder: v.boolean(),
			sessionActivityChanges: v.boolean(),
			updateLikes: v.boolean(),
			updateComments: v.boolean(),
			chatMessages: v.boolean()
		}),
		updatedAt: v.number()
	}).index('by_user', ['userId']),

	privacyPolicy: defineTable({
		title: v.string(),
		content: v.string(),
		version: v.string(),
		isActive: v.boolean(),
		createdAt: v.number(),
		updatedAt: v.number()
	}).index('by_active', ['isActive']),

	rooms: defineTable({
		isGroupChat: v.boolean(),
		name: v.optional(v.string()),
		// For direct rooms: stable lookup key of the two participants.
		directKey: v.optional(v.string()),
		lastMessageAt: v.optional(v.number()),
		lastMessagePreview: v.optional(v.string()),
		createdAt: v.number()
	}).index('by_direct_key', ['directKey']),

	participants: defineTable({
		roomId: v.id('rooms'),
		userId: v.string(),
		isAdmin: v.boolean(),
		// Denormalized profile fields for faster room summaries.
		displayName: v.optional(v.string()),
		coverPhotoUrl: v.optional(v.string()),
		createdAt: v.number()
	})
		.index('by_room', ['roomId'])
		.index('by_user', ['userId'])
		.index('by_room_and_user', ['roomId', 'userId']),

	messages: defineTable({
		roomId: v.id('rooms'),
		userId: v.string(),
		content: v.optional(v.string()),
		type: v.union(v.literal('text'), v.literal('media')),
		mediaUrl: v.optional(v.string()),
		isDeleted: v.boolean(),
		createdAt: v.number()
	})
		.index('by_room', ['roomId'])
		.index('by_room_and_created', ['roomId', 'createdAt'])
});
