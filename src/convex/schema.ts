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
		// PRD 5.10: platform-wide capability, orthogonal to club/project roles. Grants access to
		// the separate /admin route group (CL-693) only — must never be branched on inside normal
		// member flows/permissions. v1 assignment is CLI/ops-only (see profiles.setGlobalRole).
		globalRole: v.optional(v.literal('admin')),
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
		// Separate code that grants the Guide role on join (PRD 6.1.8: any Guide can invite a
		// new Guide directly). Distinct from `clubCode` (which always joins as Learner) so
		// existing learner-invite links/flows are unaffected.
		guideInviteCode: v.optional(v.string()),
		location: v.optional(v.string()),
		locationLatitude: v.optional(v.number()),
		locationLongitude: v.optional(v.number()),
		description: v.optional(v.string()),
		time: v.optional(v.number()),
		// Legacy Convex storage field kept optional for backward-compatibility with older records.
		videoStorageId: v.optional(v.string()),
		videoMediaAssetId: v.optional(v.id('mediaAssets')),
		// Whether the club is visible on the public discovery map and has a public club page.
		// Club-code joins work regardless of this flag.
		discoverable: v.boolean(),
		// Set when the club has no remaining Guides (PRD 6.2.3). Codes are invalidated and the
		// club is excluded from discovery; history (sessions/projects/chat) stays intact.
		abandonedAt: v.optional(v.number()),
		// PRD 6.10/5.3: distinguishes a regular Curiosity Club from a Club of Clubs (CoC) group.
		// CoC groups are clubs rows too, so they get chat/sessions/projects/attendance "for free".
		// Optional only so pre-existing dev rows can be backfilled via clubs.backfillClubKind;
		// once backfilled, every row has a kind and new rows always set it explicitly.
		kind: v.optional(v.union(v.literal('curiosity'), v.literal('coc'))),
		// Set on a Curiosity Club once it is auto-assigned to a CoC group at launch (CL-707).
		// Points at the CoC group's clubs row. One assignment per club, permanent for v1 (leaving
		// the CoC via the normal leave-club path is possible and out of scope to prevent, see
		// clubs.ts leaveClub).
		cocGroupId: v.optional(v.id('clubs')),
		// Set on a CoC group club at creation time (CL-707), derived from its first member club's
		// longitude. Used to keep matching newly-launched clubs to groups within +/-3h without
		// recomputing from member clubs on every assignment.
		timezoneOffset: v.optional(v.number()),
		createdByProfileId: v.id('profiles'),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_created_by_profile', ['createdByProfileId'])
		.index('by_club_code', ['clubCode'])
		.index('by_guide_invite_code', ['guideInviteCode'])
		.index('by_video_media_asset', ['videoMediaAssetId'])
		.index('by_coc_group', ['cocGroupId'])
		.index('by_kind', ['kind']),

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
		// Set together with `leftAt` when a Guide removes this member (PRD 6.2.5).
		kickReason: v.optional(v.string()),
		kickedByProfileId: v.optional(v.id('profiles')),
		createdAt: v.number()
	})
		.index('by_club', ['clubId'])
		.index('by_profile', ['profileId'])
		.index('by_club_and_profile', ['clubId', 'profileId']),

	clubApplications: defineTable({
		applicantProfileId: v.id('profiles'),
		status: v.union(
			v.literal('incomplete'),
			v.literal('pending'),
			v.literal('interview'),
			v.literal('accepted'),
			v.literal('rejected'),
			v.literal('finalized')
		),
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
		// Set when a reviewing Guide moves the application into the interview stage
		// (moveToInterview in clubApplications.ts).
		movedToInterviewAt: v.optional(v.number()),
		movedToInterviewByProfileId: v.optional(v.id('profiles')),
		// Set on Accept/Reject decisions made from the clubApplication chat (decideApplication).
		decidedAt: v.optional(v.number()),
		decidedByProfileId: v.optional(v.id('profiles')),
		rejectionNote: v.optional(v.string()),
		// Set once the onboarding call is confirmed, just before club creation runs
		// (confirmOnboardingCall).
		onboardingCallCompletedAt: v.optional(v.number()),
		// Lightweight flag for Core Team follow-up (e.g. interview no-show); does not reject the
		// application. Surfaced later by CL-730/732 admin tooling.
		adminFollowUpFlag: v.optional(
			v.object({
				reason: v.string(),
				createdAt: v.number(),
				createdByProfileId: v.id('profiles')
			})
		),
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

	joinRequests: defineTable({
		clubId: v.id('clubs'),
		requesterProfileId: v.id('profiles'),
		status: v.union(
			v.literal('pending'),
			v.literal('accepted'),
			v.literal('declined'),
			v.literal('cancelled')
		),
		createdAt: v.number(),
		decidedAt: v.optional(v.number()),
		decidedByProfileId: v.optional(v.id('profiles')),
		cancelledAt: v.optional(v.number())
	})
		.index('by_club', ['clubId'])
		.index('by_requester_profile_id', ['requesterProfileId'])
		.index('by_club_and_requester', ['clubId', 'requesterProfileId'])
		.index('by_club_and_status', ['clubId', 'status']),

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
		cancelled: v.optional(v.boolean()),
		cancelledAt: v.optional(v.number()),
		cancelledByProfileId: v.optional(v.id('profiles')),
		// Scheduled function id for the "attendance unmarked" reminder (fires at startTime + 1h).
		// Tracked so it can be cancelled and rescheduled if the session's startTime changes or it's cancelled.
		attendanceReminderJobId: v.optional(v.id('_scheduled_functions')),
		// Scheduled function id for the member-facing session reminder (fires at startTime - 24h).
		// Same cancel/reschedule lifecycle as attendanceReminderJobId.
		sessionReminderJobId: v.optional(v.id('_scheduled_functions')),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_club', ['clubId'])
		.index('by_club_and_start', ['clubId', 'startTime']),

	sessionRsvps: defineTable({
		sessionId: v.id('sessions'),
		profileId: v.id('profiles'),
		status: v.union(v.literal('going'), v.literal('not_going')),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_session', ['sessionId'])
		.index('by_session_and_profile', ['sessionId', 'profileId'])
		.index('by_profile', ['profileId']),

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
		status: v.union(v.literal('present'), v.literal('absent')),
		recordedByProfileId: v.id('profiles'),
		recordedAt: v.number()
	})
		.index('by_session', ['sessionId'])
		.index('by_session_and_profile', ['sessionId', 'profileId']),

	sessionPhotos: defineTable({
		sessionId: v.id('sessions'),
		mediaAssetId: v.id('mediaAssets'),
		uploadedByProfileId: v.id('profiles'),
		createdAt: v.number()
	}).index('by_session', ['sessionId']),

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
		// Set once (PRD 6.6.5) the moment the last active member marks themselves Done and
		// `isProjectArchived` (see `projectsModel.ts`) becomes true for this project. Cheap to
		// query directly instead of re-deriving archival status from all member rows every time
		// (e.g. Showcase/Current tab filtering in `listByClub`/`listPreviewsByClub`).
		archivedAt: v.optional(v.number()),
		description: v.optional(v.string()),
		// PRD 6.6.2/6.6.11: 'clubs' restricts direct viewing/requesting to members of attributed
		// clubs (plus project members themselves); 'global' allows any authenticated user. Any
		// active member can toggle this (PRD 6.6.8). Required — every pre-existing row was
		// backfilled to 'clubs' via the (now-removed) `projects.backfillVisibility` migration.
		visibility: v.union(v.literal('clubs'), v.literal('global')),
		// PRD 6.6.3: optional at creation, editable by any active member. Uploaded via the
		// `projectCover` media-field kind (images only, compression + safety screening on).
		coverImageMediaAssetId: v.optional(v.id('mediaAssets')),
		createdByProfileId: v.id('profiles'),
		createdAt: v.number(),
		updatedAt: v.number()
	}),

	// PRD 5.11/6.6.6: per-member, per-club attribution links (replaces the old project-level
	// `projectClubs` table entirely — no back-compat). A project's "attributed clubs" is the
	// distinct set of `clubId`s across all its attribution rows; a club attribution naturally
	// disappears once the last row for that club is removed ("last person out", PRD 6.6.6).
	// Unique per (projectId, profileId, clubId) — enforced by the app layer via
	// `by_project_and_profile_and_club` lookups before insert, since Convex has no native unique
	// constraint.
	projectAttributions: defineTable({
		projectId: v.id('projects'),
		profileId: v.id('profiles'),
		clubId: v.id('clubs'),
		createdAt: v.number()
	})
		.index('by_project', ['projectId'])
		.index('by_club', ['clubId'])
		.index('by_club_and_project', ['clubId', 'projectId'])
		.index('by_project_and_profile', ['projectId', 'profileId'])
		.index('by_project_and_profile_and_club', ['projectId', 'profileId', 'clubId']),

	projectMembers: defineTable({
		projectId: v.id('projects'),
		profileId: v.id('profiles'),
		leftAt: v.optional(v.number()),
		// Set when this member presses "I'm Done" (PRD 6.8.4/6.8.5). Per-member and permanent;
		// distinct from `leftAt` (self-removal). Once every current member has `doneDate` set,
		// the project is considered Archived and its chat closes for everyone.
		doneDate: v.optional(v.number()),
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

	// PRD 6.6.10: platform-wide project invitations. Any ACTIVE project member can invite any
	// user on the platform; the invitee decides via a banner on the project page (see
	// `canViewProject`'s pending-invite carve-out, projectsModel.ts). One pending invite per
	// (projectId, inviteeProfileId) at a time — enforced in `projects.inviteMember` via
	// `by_project_and_invitee`. `decidedAt` is set on accept/decline; cancelling (by the
	// inviter) reuses the 'cancelled' status rather than deleting the row, matching the
	// club-level `joinRequests` table's shape.
	projectInvites: defineTable({
		projectId: v.id('projects'),
		inviteeProfileId: v.id('profiles'),
		invitedByProfileId: v.id('profiles'),
		status: v.union(
			v.literal('pending'),
			v.literal('accepted'),
			v.literal('declined'),
			v.literal('cancelled')
		),
		createdAt: v.number(),
		decidedAt: v.optional(v.number())
	})
		.index('by_project', ['projectId'])
		.index('by_invitee', ['inviteeProfileId'])
		.index('by_project_and_invitee', ['projectId', 'inviteeProfileId'])
		.index('by_project_and_status', ['projectId', 'status']),

	// PRD 6.6.10: requests to join a project from any user who can currently view it
	// (`canViewProject`) and isn't already an active member. Any ACTIVE project member can
	// accept/decline. One pending request per (projectId, requesterProfileId) — enforced in
	// `projects.requestToJoinProject` via `by_project_and_requester`. No chat is created for
	// this flow (CL-722 simplification vs. the PRD's `join_request` chat type, which remains
	// club-scoped only).
	projectJoinRequests: defineTable({
		projectId: v.id('projects'),
		requesterProfileId: v.id('profiles'),
		status: v.union(
			v.literal('pending'),
			v.literal('accepted'),
			v.literal('declined'),
			v.literal('cancelled')
		),
		createdAt: v.number(),
		decidedAt: v.optional(v.number())
	})
		.index('by_project', ['projectId'])
		.index('by_requester', ['requesterProfileId'])
		.index('by_project_and_requester', ['projectId', 'requesterProfileId'])
		.index('by_project_and_status', ['projectId', 'status']),

	// Immutable audit trail for project member lifecycle events (PRD 6.6.8): member
	// joined/added, member marked Done, member left, project archived. No update/delete
	// mutations are exposed — entries are append-only. `actorProfileId` is undefined for
	// system-generated entries (e.g. automatic archival).
	projectChangeLogs: defineTable({
		projectId: v.id('projects'),
		actorProfileId: v.optional(v.id('profiles')),
		entryType: v.union(
			v.literal('member_joined'),
			v.literal('member_done'),
			v.literal('member_left'),
			v.literal('project_archived'),
			// CL-718: metadata edits (PRD 6.6.8 "Active members can edit: Name, Deadline,
			// Description, Cover Image, Visibility, Attribution").
			v.literal('name_changed'),
			v.literal('description_changed'),
			v.literal('deadline_changed'),
			v.literal('visibility_changed'),
			v.literal('cover_changed'),
			// CL-721: per-member attribution link/unlink (PRD 6.6.6/6.6.8 "Attribution" is one of
			// the editable/logged fields).
			v.literal('club_linked'),
			v.literal('club_unlinked'),
			// CL-722: distinct from 'member_joined' so the timeline can show "X was invited by Y"
			// (PRD 6.6.10) rather than the generic join-request wording.
			v.literal('member_invited')
		),
		text: v.string(),
		createdAt: v.number()
	}).index('by_project_and_created', ['projectId', 'createdAt']),

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
		.index('by_project_and_created', ['projectId', 'createdAt'])
		// CL-726: the "All" (global-visibility) feed scans all updates newest-first regardless of
		// project, which `by_project_and_created` can't serve (it requires a projectId prefix).
		.index('by_created', ['createdAt']),

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

	// PRD 6.7.2-6.7.4: comments on project updates. No likes. Eligibility (>=1 active club
	// membership AND `canViewProject` for the update's project) is enforced only at comment-time
	// in `updateComments.addComment` — rows are never deleted or re-validated afterward, so a
	// comment persists and remains visible even if the project's visibility later flips from
	// 'global' to 'clubs' and the commenter is no longer eligible to post a *new* comment.
	updateComments: defineTable({
		updateId: v.id('updates'),
		authorProfileId: v.id('profiles'),
		content: v.string(),
		createdAt: v.number()
	})
		.index('by_update', ['updateId'])
		.index('by_update_and_created', ['updateId', 'createdAt']),

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
			}),
			v.object({
				contextType: v.literal('joinRequest'),
				joinRequestId: v.id('joinRequests')
			})
		)
	)
		.index('by_club_id', ['clubId'])
		.index('by_project_id', ['projectId'])
		.index('by_club_application_id', ['clubApplicationId'])
		.index('by_join_request_id', ['joinRequestId']),

	messages: defineTable({
		roomId: v.id('rooms'),
		// Optional: unset for system messages (e.g. the automated rejection notice posted by
		// clubApplications.decideApplication).
		profileId: v.optional(v.id('profiles')),
		content: v.string()
	}).index('by_room', ['roomId']),

	rateLimits: defineTable({
		key: v.string(),
		windowStart: v.number(),
		count: v.number()
	}).index('by_key', ['key']),

	// PRD 6.15.1/6.15.2: Safeguarding/issue reports. Any authenticated user can report a chat
	// message, project update, user (profile), or club. v1 only stores the report and pings
	// the Core Team via Google Chat (see googleChat.ts) — admin review/workflow is CL-730.
	// PRD 5.7: academic "seasons" (e.g. "Autumn 2026") that future tickets (CL-701 admin UI,
	// CL-729/709 review-window-gated flows) key off of. All boundaries are stored as absolute ms
	// timestamps (UTC), same convention as `sessions.startTime`/`endTime` — no per-club timezone
	// concept at this level. Foundation only here: internal CRUD + authenticated read queries, no
	// admin UI and no overlap/validation beyond what createSeason/updateSeason enforce.
	seasons: defineTable({
		name: v.string(),
		startDate: v.number(),
		endDate: v.number(),
		reviewWindowOpen: v.number(),
		reviewWindowClose: v.number(),
		feedbackDeadline: v.number(),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_start_date', ['startDate'])
		.index('by_end_date', ['endDate']),

	reports: defineTable({
		reporterProfileId: v.id('profiles'),
		category: v.union(
			v.literal('safeguarding'),
			v.literal('inappropriate_content'),
			v.literal('other')
		),
		description: v.optional(v.string()),
		targetType: v.union(
			v.literal('chat_message'),
			v.literal('project_update'),
			v.literal('user'),
			v.literal('club'),
			// CL-726: individual comments on project updates.
			v.literal('comment')
		),
		// The id of the reported document, stored as a string since it can reference several
		// different tables depending on targetType.
		targetId: v.string(),
		// Short snapshot of the reported content at report time (e.g. the chat message text) —
		// useful because the underlying content could change or be deleted later. Capped length.
		contextText: v.optional(v.string()),
		// 'open' is the only status for v1; admin workflow (CL-730) will extend this.
		status: v.literal('open'),
		createdAt: v.number()
	}).index('by_status_and_created', ['status', 'createdAt']),

	// PRD 6.11.1/6.11.2: quarterly feedback forms. A form targets one audience ('guide' or
	// 'learner') for a given season; questions are a fixed structured list (no branching/logic).
	// Admin creation UI is CL-701 — for now forms are only created via an internal mutation and
	// dev seed scripts. Curiosity Clubs only (kind 'curiosity'); CoC groups are excluded from
	// feedback collection entirely (see forms.ts listMyOutstandingForms).
	forms: defineTable({
		title: v.string(),
		audience: v.union(v.literal('guide'), v.literal('learner')),
		seasonId: v.id('seasons'),
		questions: v.array(
			v.object({
				id: v.string(),
				label: v.string(),
				kind: v.union(v.literal('scale_1_10'), v.literal('text'), v.literal('yes_no')),
				required: v.boolean()
			})
		),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_season', ['seasonId'])
		.index('by_season_and_audience', ['seasonId', 'audience']),

	// One response per (form, profile, club) — enforced in forms.ts submitResponse via the
	// `by_form_profile_club` index. Responses are immutable: no update/delete path exists.
	formResponses: defineTable({
		formId: v.id('forms'),
		profileId: v.id('profiles'),
		clubId: v.id('clubs'),
		answers: v.array(
			v.object({
				questionId: v.string(),
				value: v.union(v.string(), v.number(), v.boolean())
			})
		),
		submittedAt: v.number()
	})
		.index('by_form_profile_club', ['formId', 'profileId', 'clubId'])
		.index('by_profile', ['profileId'])
});
