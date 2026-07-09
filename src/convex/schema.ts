import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { mediaAssetFields } from './mediaModel';
import { clubRoleKeyValidator, projectRoleKeyValidator } from './roles';
import { dayOfWeekValidator } from './scheduleModel';

export default defineSchema({
	profiles: defineTable({
		authUserId: v.string(),
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
		parentProfileId: v.optional(v.id('profiles')),
		pendingClubCode: v.optional(v.string()),
		pendingRole: v.optional(v.union(v.literal('Learner'), v.literal('Guide'))),
		updatedAt: v.number()
	})
		.index('by_auth_user_id', ['authUserId'])
		.index('by_username', ['username'])
		.index('by_profile_image_media_asset', ['profileImageMediaAssetId']),

	clubRoles: defineTable({
		key: clubRoleKeyValidator,
		name: v.string(),
		description: v.optional(v.string()),
		color: v.optional(v.string()),
		permissions: v.array(v.string()),
		order: v.number(),
		createdAt: v.number()
	})
		.index('by_key', ['key'])
		.index('by_name', ['name']),

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
		createdByProfileId: v.id('profiles'),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_created_by_profile', ['createdByProfileId'])
		.index('by_club_code', ['clubCode'])
		.index('by_video_media_asset', ['videoMediaAssetId']),

	clubScheduleSlots: defineTable({
		clubId: v.id('clubs'),
		dayOfWeek: dayOfWeekValidator,
		startTime: v.string(),
		endTime: v.string(),
		location: v.string(),
		createdAt: v.number(),
		updatedAt: v.number()
	}).index('by_club', ['clubId']),

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
		profileId: v.id('profiles'),
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
		.index('by_profile', ['profileId'])
		.index('by_club_and_profile', ['clubId', 'profileId']),

	clubApplications: defineTable({
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
		finalizedByProfileId: v.optional(v.id('profiles')),
		finalizedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_applicant_profile_id', ['applicantProfileId'])
		.index('by_status_and_created_at', ['status', 'createdAt'])
		.index('by_created_club_id', ['createdClubId']),

	applicationReviews: defineTable({
		applicationId: v.id('clubApplications'),
		reviewerProfileId: v.id('profiles'),
		score: v.number(),
		note: v.string(),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_application_id', ['applicationId'])
		.index('by_reviewer_profile_id', ['reviewerProfileId'])
		.index('by_application_id_and_reviewer_profile_id', ['applicationId', 'reviewerProfileId']),

	parentChildConsents: defineTable({
		childProfileId: v.id('profiles'),
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
		.index('by_child_profile_id', ['childProfileId'])
		.index('by_parent_email', ['parentEmail'])
		.index('by_token', ['token'])
		.index('by_status_and_created_at', ['status', 'createdAt']),

	sessions: defineTable({
		clubId: v.id('clubs'),
		description: v.optional(v.string()),
		location: v.optional(v.string()),
		startTime: v.number(),
		endTime: v.number(),
		createdByProfileId: v.id('profiles'),
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
		createdByProfileId: v.optional(v.id('profiles')),
		createdAt: v.number(),
		updatedAt: v.number()
	}),

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
		createdByProfileId: v.id('profiles'),
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
		profileId: v.id('profiles'),
		createdByProfileId: v.id('profiles'),
		createdAt: v.number()
	})
		.index('by_session', ['sessionId'])
		.index('by_session_and_profile', ['sessionId', 'profileId']),

	projectRoles: defineTable({
		key: projectRoleKeyValidator,
		permissions: v.array(v.string()),
		name: v.string(),
		order: v.number(),
		createdAt: v.number()
	})
		.index('by_key', ['key'])
		.index('by_name', ['name']),

	projects: defineTable({
		name: v.string(),
		dueDate: v.number(),
		doneDate: v.optional(v.number()),
		description: v.optional(v.string()),
		createdByProfileId: v.id('profiles'),
		createdAt: v.number(),
		updatedAt: v.number()
	}),

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
		profileId: v.id('profiles'),
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
		.index('by_profile', ['profileId'])
		.index('by_project_and_profile', ['projectId', 'profileId']),

	questions: defineTable({
		content: v.string(),
		createdAt: v.number()
	}),

	updates: defineTable({
		projectId: v.optional(v.id('projects')),
		content: v.string(),
		createdByProfileId: v.id('profiles'),
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
		profileId: v.id('profiles'),
		clubId: v.optional(v.id('clubs')),
		title: v.string(),
		message: v.string(),
		isRead: v.boolean(),
		url: v.optional(v.string()),
		createdAt: v.number()
	})
		.index('by_profile', ['profileId'])
		.index('by_profile_and_created', ['profileId', 'createdAt']),

	userPreferences: defineTable({
		profileId: v.id('profiles'),
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
	}).index('by_profile', ['profileId']),

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

	rooms: defineTable(
		v.union(
			v.object({
				contextType: v.literal('club'),
				clubId: v.id('clubs')
			}),
			v.object({
				contextType: v.literal('project'),
				projectId: v.id('projects')
			}),
			v.object({
				contextType: v.literal('clubApplication'),
				clubApplicationId: v.id('clubApplications')
			})
		)
	)
		.index('by_club_id', ['clubId'])
		.index('by_project_id', ['projectId'])
		.index('by_club_application_id', ['clubApplicationId']),

	messages: defineTable({
		roomId: v.id('rooms'),
		profileId: v.id('profiles'),
		content: v.string()
	}).index('by_room', ['roomId'])
});
