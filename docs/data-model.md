# Data Model

> Convex schema tables, fields, and indexes. For access control and permissions see [security.md](security.md).

Schema source: `src/convex/schema.ts`

## Profiles and Preferences

| Table             | Purpose                                 | Key Fields                                                              | Indexes                              |
| ----------------- | --------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------ |
| `profiles`        | Per-user profile and onboarding state   | `userId`, `email`, `username?`, `activeClubId?`, `isVerified`, `firstLoginCompleted`, `pendingClubCode?`, `pendingRole?` | `by_user_id`, `by_email`, `by_username` |
| `userPreferences` | Theme + notification settings           | `userId`, `activeClubId?`                                               | `by_user`                            |

## Clubs / Membership / Permissions

| Table         | Purpose                            | Key Fields                                      | Indexes                                |
| ------------- | ---------------------------------- | ----------------------------------------------- | -------------------------------------- |
| `clubRoles`   | Role definitions with permissions  | `name`, `permissions[]`, `order`                 | `by_name`                              |
| `clubs`       | Club record                        | `name`, `description?`, `location?`, `createdByUserId` | `by_created_by`                 |
| `clubCodes`   | Invite codes                       | `clubId`, `code`                                 | `by_code`, `by_club`                   |
| `clubMembers` | User-club membership with role     | `clubId`, `userId`, `roleId`, `leftAt?`          | `by_club`, `by_user`, `by_club_and_user` |

## Sessions / Activities / Attendance

| Table                          | Purpose                               | Key Fields                                                    | Indexes                                    |
| ------------------------------ | ------------------------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| `sessions`                     | Session event within a club           | `clubId`, `datetime`, `startTime`, `endTime`, `description`, `createdByUserId` | `by_club`, `by_club_and_start` |
| `buildingBlocks`               | Global taxonomy for activities        | `name`, `slug`                                                | `by_slug`                                  |
| `bookletActivities`            | Reusable activity templates           | `name?`, `content?`, `minutes?`, `status?`, `createdByUserId?` | `by_created_by`                           |
| `bookletActivityBuildingBlocks`| Join: activities ↔ building blocks    | `activityId`, `buildingBlockId`                               | `by_activity`, `by_building_block`         |
| `sessionActivities`            | Activities inside a session           | `sessionId`, `name`, `slug?`, `content?`, `minutes?`, `bookletActivityId?` | `by_session`                  |
| `sessionActivityBuildingBlocks`| Join: session activities ↔ blocks     | `sessionActivityId`, `buildingBlockId`                        | `by_session_activity`, `by_building_block` |
| `attendances`                  | User attendance at a session          | `sessionId`, `userId`, `createdByUserId`, `createdAt`         | `by_session`, `by_session_and_user`        |

## Projects / Updates / Files

| Table            | Purpose                                | Key Fields                                            | Indexes                                    |
| ---------------- | -------------------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| `projectRoles`   | Project role definitions               | `name`, `permissions[]`                               | `by_name`                                  |
| `projects`       | Project record                         | `name`, `description?`, `dueDate?`, `doneDate?`, `createdByUserId` | `by_created_by`                |
| `projectClubs`   | Join: projects ↔ clubs                 | `projectId`, `clubId`                                 | `by_project`, `by_club`, `by_club_and_project` |
| `projectMembers` | User membership in a project           | `projectId`, `userId`, `roleId`, `leftAt?`            | `by_project`, `by_user`, `by_project_and_user` |
| `questions`      | Question prompts for updates           | (minimal)                                             |                                            |
| `updates`        | Update posts on projects               | `projectId?`, `questionId?`, `content`, `createdByUserId` | `by_project`, `by_project_and_created` |
| `updateFiles`    | Files attached to updates              | `updateId`, `storageId`                               | `by_update`                                |

## Notifications / Privacy

| Table           | Purpose                      | Key Fields                                           | Indexes                          |
| --------------- | ---------------------------- | ---------------------------------------------------- | -------------------------------- |
| `notifications` | Per-user notifications       | `userId`, `clubId?`, `title`, `message`, `url?`, `isRead` | `by_user`, `by_user_and_created` |
| `privacyPolicy` | Versioned policy content     | `content`, `isActive`                                | `by_active`                      |

## Chat

| Table          | Purpose            | Key Fields                                               | Indexes                              |
| -------------- | ------------------ | -------------------------------------------------------- | ------------------------------------ |
| `rooms`        | Chat rooms         | `name?`, `type`                                          |                                      |
| `participants` | Room membership    | `roomId`, `userId`                                       | `by_room`, `by_user`, `by_room_and_user` |
| `messages`     | Messages in a room | `roomId`, `userId`, `content?`, `type`, `mediaUrl?`, `isDeleted` | `by_room`, `by_room_and_created` |
