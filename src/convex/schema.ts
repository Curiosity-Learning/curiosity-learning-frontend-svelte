import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { mediaAssetFields } from './mediaModel';

export default defineSchema({
	profiles: defineTable({
		userId: v.string(),
		firstName: v.optional(v.string()),
		lastName: v.optional(v.string()),
		username: v.optional(v.string()),
		coverPhotoUrl: v.optional(v.string()),
		// Legacy Convex storage field kept optional for backward-compatibility with older records.
		profileImageStorageId: v.optional(v.string()),
		profileImageMediaAssetId: v.optional(v.id('mediaAssets')),
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
		signUpWith: v.optional(v.union(v.literal('email'), v.literal('google'))),
		parentId: v.optional(v.id('parents')),
		pendingClubCode: v.optional(v.string()),
		pendingRole: v.optional(v.union(v.literal('Learner'), v.literal('Guide'))),
		updatedAt: v.number()
	})
		.index('by_user_id', ['userId'])
		.index('by_username', ['username'])
		.index('by_profile_image_media_asset', ['profileImageMediaAssetId']),

	parents: defineTable({
		userId: v.string(),
		profileId: v.id('profiles'),
		email: v.string(),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_user_id', ['userId'])
		.index('by_profile_id', ['profileId'])
		.index('by_email', ['email']),

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
		clubCode: v.optional(v.string()),
		location: v.optional(v.string()),
		locationLatitude: v.optional(v.number()),
		locationLongitude: v.optional(v.number()),
		description: v.optional(v.string()),
		time: v.optional(v.number()),
		// Legacy Convex storage field kept optional for backward-compatibility with older records.
		videoStorageId: v.optional(v.string()),
		videoMediaAssetId: v.optional(v.id('mediaAssets')),
		meetingDay: v.optional(v.string()),
		meetingTime: v.optional(v.string()),
		createdByUserId: v.string(),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_created_by', ['createdByUserId'])
		.index('by_club_code', ['clubCode'])
		.index('by_video_media_asset', ['videoMediaAssetId']),

	clubInterestSignups: defineTable({
		email: v.string(),
		location: v.string(),
		locationLatitude: v.optional(v.number()),
		locationLongitude: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_email', ['email'])
		.index('by_created_at', ['createdAt']),

	clubMembers: defineTable({
		clubId: v.id('clubs'),
		userId: v.string(),
		roleId: v.id('clubRoles'),
		// Denormalized profile fields for faster member lists.
		firstName: v.optional(v.string()),
		lastName: v.optional(v.string()),
		username: v.optional(v.string()),
		coverPhotoUrl: v.optional(v.string()),
		leftAt: v.optional(v.number()),
		createdAt: v.number()
	})
		.index('by_club', ['clubId'])
		.index('by_user', ['userId'])
		.index('by_club_and_user', ['clubId', 'userId']),

	clubApplications: defineTable({
		applicantUserId: v.string(),
		applicantProfileId: v.id('profiles'),
		status: v.union(v.literal('incomplete'), v.literal('pending'), v.literal('finalized')),
		name: v.string(),
		description: v.optional(v.string()),
		location: v.optional(v.string()),
		locationLatitude: v.optional(v.number()),
		locationLongitude: v.optional(v.number()),
		videoMediaAssetId: v.optional(v.id('mediaAssets')),
		applicantRole: v.optional(v.string()),
		referralSource: v.optional(v.string()),
		referralOther: v.optional(v.string()),
		createdClubId: v.optional(v.id('clubs')),
		finalizedByUserId: v.optional(v.string()),
		finalizedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_applicant_user_id', ['applicantUserId'])
		.index('by_status_and_created_at', ['status', 'createdAt'])
		.index('by_created_club_id', ['createdClubId']),

	applicationReviews: defineTable({
		applicationId: v.id('clubApplications'),
		reviewerUserId: v.string(),
		reviewerProfileId: v.id('profiles'),
		score: v.number(),
		note: v.string(),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_application_id', ['applicationId'])
		.index('by_reviewer_user_id', ['reviewerUserId'])
		.index('by_application_id_and_reviewer_user_id', ['applicationId', 'reviewerUserId']),

	parentChildConsents: defineTable({
		childUserId: v.string(),
		childProfileId: v.id('profiles'),
		parentId: v.optional(v.id('parents')),
		parentUserId: v.optional(v.string()),
		parentProfileId: v.optional(v.id('profiles')),
		parentEmail: v.string(),
		status: v.union(v.literal('pending'), v.literal('approved')),
		token: v.string(),
		onboardingIntentPath: v.optional(v.string()),
		termsAcceptedAt: v.optional(v.number()),
		privacyPolicyAcceptedAt: v.optional(v.number()),
		approvedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_child_user_id', ['childUserId'])
		.index('by_parent_email', ['parentEmail'])
		.index('by_token', ['token'])
		.index('by_status_and_created_at', ['status', 'createdAt']),

	sessions: defineTable({
		clubId: v.id('clubs'),
		description: v.optional(v.string()),
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
		order: v.optional(v.number()),
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
		dueDate: v.number(),
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
		mediaAssetId: v.id('mediaAssets'),
		createdAt: v.number()
	})
		.index('by_update', ['updateId'])
		.index('by_media_asset', ['mediaAssetId']),

	mediaAssets: defineTable(mediaAssetFields)
		.index('by_owner', ['ownerUserId'])
		.index('by_owner_and_status', ['ownerUserId', 'status'])
		.index('by_source_object_key', ['sourceObjectKey']),

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

	legalDocuments: defineTable({
		documentKey: v.union(
			v.literal('privacy_policy'),
			v.literal('terms_and_conditions'),
			v.literal('cookie_policy')
		),
		fullName: v.union(
			v.literal('Privacy Policy'),
			v.literal('Terms and Conditions'),
			v.literal('Cookie Policy')
		),
		title: v.string(),
		content: v.string(),
		version: v.string(),
		isActive: v.boolean(),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_document_key', ['documentKey'])
		.index('by_document_key_and_active', ['documentKey', 'isActive'])
		.index('by_document_key_and_updated', ['documentKey', 'updatedAt']),

	pledges: defineTable({
		key: v.string(),
		title: v.string(),
		description: v.string(),
		bullets: v.array(v.string()),
		order: v.number(),
		isActive: v.boolean(),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_key', ['key'])
		.index('by_active_and_order', ['isActive', 'order']),

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
		lastReadAt: v.optional(v.number()),
		unreadCount: v.optional(v.number()),
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
