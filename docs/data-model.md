# Data Model

> Convex schema tables, fields, and indexes. For access control and permissions see [security.md](security.md).

Schema source: `src/convex/schema.ts`

## Profiles and Preferences

| Table             | Purpose                               | Key Fields                                                                                                                                                | Indexes                                                     |
| ----------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `profiles`        | Per-user profile and onboarding state | `userId`, `username?`, `profileImageMediaAssetId?`, `activeClubId?`, `isVerified`, `firstLoginCompleted`, `parentId?`, `pendingClubCode?`, `pendingRole?` | `by_user_id`, `by_username`, `by_profile_image_media_asset` |
| `parents`         | Parent marker/link table              | `userId`, `profileId`, `email`                                                                                                                            | `by_user_id`, `by_profile_id`, `by_email`                   |
| `userPreferences` | Theme + notification settings         | `userId`, `activeClubId?`                                                                                                                                 | `by_user`                                                   |

## Clubs / Membership / Permissions

| Table                 | Purpose                                              | Key Fields                                                                                                                                                             | Indexes                                                                              |
| --------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `clubRoles`           | Role definitions with permissions                    | `name`, `permissions[]`, `order`                                                                                                                                       | `by_name`                                                                            |
| `clubs`               | Club record                                          | `name`, `clubCode?`, `description?`, `location?`, `locationLatitude?`, `locationLongitude?`, `videoMediaAssetId?`, `createdByUserId`                                   | `by_created_by`, `by_club_code`, `by_video_media_asset`                              |
| `clubMembers`         | User-club membership with role                       | `clubId`, `userId`, `roleId`, `leftAt?`                                                                                                                                | `by_club`, `by_user`, `by_club_and_user`                                             |
| `clubInterestSignups` | Email interest capture when no public club is nearby | `email`, `location`, `locationLatitude?`, `locationLongitude?`                                                                                                          | `by_email`, `by_created_at`                                                          |
| `clubApplications`    | Start Club applications awaiting review/finalization | `applicantUserId`, `applicantProfileId`, `status`, `name`, `description?`, `location?`, `videoMediaAssetId?`, `createdClubId?`                                         | `by_applicant_user_id`, `by_status_and_created_at`, `by_created_club_id`             |
| `applicationReviews`  | Guide reviews for club applications                  | `applicationId`, `reviewerUserId`, `reviewerProfileId`, `score`, `note`                                                                                                | `by_application_id`, `by_reviewer_user_id`, `by_application_id_and_reviewer_user_id` |
| `parentChildConsents` | Parent/guardian consent for under-16 learners        | `childUserId`, `childProfileId`, `parentId?`, `parentEmail`, `status`, `token`, `onboardingIntentPath?`, `termsAcceptedAt?`, `privacyPolicyAcceptedAt?`, `approvedAt?` | `by_child_user_id`, `by_parent_email`, `by_token`, `by_status_and_created_at`        |

## Sessions / Activities / Attendance

| Table                           | Purpose                            | Key Fields                                                                           | Indexes                                                  |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `sessions`                      | Session event within a club        | `clubId`, `startTime`, `endTime`, `description?`, `createdByUserId`                  | `by_club`, `by_club_and_start`                           |
| `buildingBlocks`                | Global taxonomy for activities     | `name`, `slug`                                                                       | `by_slug`                                                |
| `bookletActivities`             | Reusable activity templates        | `name?`, `content?`, `minutes?`, `status?`, `createdByUserId?`                       | `by_created_by`                                          |
| `bookletActivityBuildingBlocks` | Join: activities ↔ building blocks | `activityId`, `buildingBlockId`                                                      | `by_activity`, `by_building_block`                       |
| `sessionActivities`             | Activities inside a session        | `sessionId`, `name`, `slug?`, `content?`, `minutes?`, `order?`, `bookletActivityId?` | `by_session`                                             |
| `sessionActivityBuildingBlocks` | Join: session activities ↔ blocks  | `sessionActivityId`, `sessionId?`, `buildingBlockId`                                 | `by_session_activity`, `by_session`, `by_building_block` |
| `attendances`                   | User attendance at a session       | `sessionId`, `userId`, `createdByUserId`, `createdAt`                                | `by_session`, `by_session_and_user`                      |

## Projects / Updates / Files

| Table            | Purpose                                 | Key Fields                                                        | Indexes                                        |
| ---------------- | --------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| `projectRoles`   | Project role definitions                | `name`, `permissions[]`                                           | `by_name`                                      |
| `projects`       | Project record                          | `name`, `description?`, `dueDate`, `doneDate?`, `createdByUserId` | `by_created_by`                                |
| `projectClubs`   | Join: projects ↔ clubs                  | `projectId`, `clubId`                                             | `by_project`, `by_club`, `by_club_and_project` |
| `projectMembers` | User membership in a project            | `projectId`, `userId`, `roleId`, `leftAt?`                        | `by_project`, `by_user`, `by_project_and_user` |
| `questions`      | Question prompts for updates            | `content`, `createdAt`                                            |                                                |
| `updates`        | Update posts on projects                | `projectId?`, `questionId?`, `content`, `createdByUserId`         | `by_project`, `by_project_and_created`         |
| `updateClubs`    | Denormalized club feed join for updates | `updateId`, `clubId`, `projectId?`, `createdAt`                   | `by_club_and_created`, `by_update`             |
| `updateFiles`    | Files attached to updates               | `updateId`, `mediaAssetId`                                        | `by_update`, `by_media_asset`                  |

## Media Pipeline

| Table         | Purpose                                              | Key Fields                                                                                                                                                                                                                                                           | Indexes                                                   |
| ------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `mediaAssets` | Shared upload pipeline records for user-facing media | `ownerUserId`, `status`, `acceptedContentTypes[]`, `maxBytes`, `enableCompression`, `enableSafetyScreening`, `storageProvider`, `sourceObjectKey?`, `processedObjectKey?`, `mediaKind?`, `contentType?`, `sizeBytes?`, `durationSeconds?`, `sha256?`, `lastFailure?` | `by_owner`, `by_owner_and_status`, `by_source_object_key` |

## Notifications / Privacy

| Table            | Purpose                                     | Key Fields                                                           | Indexes                                                                        |
| ---------------- | ------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `notifications`  | Per-user notifications                      | `userId`, `clubId?`, `title`, `message`, `url?`, `isRead`            | `by_user`, `by_user_and_created`                                               |
| `legalDocuments` | Versioned legal docs (privacy/terms/cookie) | `documentKey`, `fullName`, `title`, `content`, `version`, `isActive` | `by_document_key`, `by_document_key_and_active`, `by_document_key_and_updated` |
| `privacyPolicy`  | Legacy compatibility wrapper source table   | `title`, `content`, `version`, `isActive`                            | `by_active`                                                                    |
| `pledges`        | Onboarding pledge content                   | `key`, `title`, `description`, `bullets[]`, `order`, `isActive`      | `by_key`, `by_active_and_order`                                                |

## Chat

| Table          | Purpose            | Key Fields                                                                    | Indexes                                  |
| -------------- | ------------------ | ----------------------------------------------------------------------------- | ---------------------------------------- |
| `rooms`        | Chat rooms         | `isGroupChat`, `name?`, `directKey?`, `lastMessageAt?`, `lastMessagePreview?` | `by_direct_key`                          |
| `participants` | Room membership    | `roomId`, `userId`, `isAdmin`, `displayName?`, `lastReadAt?`, `unreadCount?`  | `by_room`, `by_user`, `by_room_and_user` |
| `messages`     | Messages in a room | `roomId`, `userId`, `content?`, `type`, `mediaUrl?`, `isDeleted`              | `by_room`, `by_room_and_created`         |
