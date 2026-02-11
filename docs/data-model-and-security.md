# Data Model and Security (Current State + Hardening Notes)

This document describes what is currently implemented in this repo (Convex schema + queries/mutations + Better Auth integration), plus the main security gaps and decisions to make before hardening.

## Identity and Auth Plumbing

- Auth provider: Better Auth with Convex integration.
  - Convex auth component: `/Users/ronberlinski/Documents/curiosity-learning-flutter-to-svelte/src/convex/auth.ts`
  - Convex HTTP routes for auth: `/Users/ronberlinski/Documents/curiosity-learning-flutter-to-svelte/src/convex/http.ts`
  - SvelteKit auth handler route: `/Users/ronberlinski/Documents/curiosity-learning-flutter-to-svelte/src/routes/api/auth/[...all]/+server.ts`
- Token propagation:
  - SvelteKit `handle` populates `event.locals.token` from Better Auth cookies.
  - `/Users/ronberlinski/Documents/curiosity-learning-flutter-to-svelte/src/hooks.server.ts`
  - Server-side Convex client is created with this token in `/Users/ronberlinski/Documents/curiosity-learning-flutter-to-svelte/src/lib/server/convex.ts`.
- AuthZ identity:
  - Convex code generally treats `identity.subject` as the canonical `userId` string.
  - `profiles.userId`, `clubMembers.userId`, `projectMembers.userId`, `participants.userId`, etc. all store this string.

### Trusted Origins / CSRF Hardening

- Better Auth `trustedOrigins` is configured in `/Users/ronberlinski/Documents/curiosity-learning-flutter-to-svelte/src/convex/auth.ts`.
- Local dev ports are allowed.
- Optional LAN wildcard origins are enabled only when `ALLOW_LAN_TRUSTED_ORIGINS === 'true'` (this weakens origin protections and should remain disabled in production).

## Schema (Convex Tables)

Schema: `/Users/ronberlinski/Documents/curiosity-learning-flutter-to-svelte/src/convex/schema.ts`

### Profiles and Preferences

- `profiles`
  - Purpose: per-user profile and onboarding state.
  - Key fields: `userId` (Better Auth user id), `email`, `username?`, `activeClubId?`, `isVerified`, `firstLoginCompleted`, `pendingClubCode?`, `pendingRole?`, `updatedAt`.
  - Indexes: `by_user_id`, `by_email`, `by_username`.
- `userPreferences`
  - Purpose: theme + notification settings + `activeClubId?` mirror.
  - Index: `by_user`.

### Clubs / Membership / Permissions

- `clubRoles`
  - Purpose: role definitions with `permissions: string[]` and `order` (used for kick hierarchy).
  - Index: `by_name`.
- `clubs`
  - Purpose: club record (name/description/location/meeting metadata).
  - Fields include `createdByUserId`, timestamps.
  - Index: `by_created_by`.
- `clubCodes`
  - Purpose: invite code for a club.
  - Fields: `clubId`, `code`.
  - Indexes: `by_code`, `by_club`.
- `clubMembers`
  - Purpose: membership link between user and club with role.
  - Fields: `clubId`, `userId`, `roleId`, `leftAt?`.
  - Indexes: `by_club`, `by_user`, `by_club_and_user`.

### Sessions / Activities / Attendance

- `sessions`
  - Purpose: session event within a club.
  - Fields: `clubId`, `datetime`, `startTime`, `endTime`, `description`, `createdByUserId`, timestamps.
  - Indexes: `by_club`, `by_club_and_start`.
- `buildingBlocks`
  - Purpose: global taxonomy used by activities.
  - Index: `by_slug`.
- `bookletActivities`
  - Purpose: reusable activity templates (currently present in schema but not exposed via queries/mutations in this repo yet).
  - Fields: `name?`, `content?`, `minutes?`, `status?`, `reviewedAt?`, `previousActivityId?`, `createdByUserId?`, timestamps.
  - Index: `by_created_by`.
- `bookletActivityBuildingBlocks`
  - Purpose: join table between `bookletActivities` and `buildingBlocks`.
  - Indexes: `by_activity`, `by_building_block`.
- `sessionActivities`
  - Purpose: activities inside a session (optionally linked to a booklet activity).
  - Fields: `sessionId`, `name`, `slug?`, `content?`, `minutes?`, `bookletActivityId?`, `createdByUserId`, timestamps.
  - Index: `by_session`.
- `sessionActivityBuildingBlocks`
  - Purpose: join table between `sessionActivities` and `buildingBlocks`.
  - Indexes: `by_session_activity`, `by_building_block`.
- `attendances`
  - Purpose: attendance for a user at a session.
  - Fields: `sessionId`, `userId`, `createdByUserId`, `createdAt`.
  - Indexes: `by_session`, `by_session_and_user`.

### Projects / Updates / Files

- `projectRoles`
  - Purpose: project-specific role definitions with permissions.
  - Index: `by_name`.
- `projects`
  - Purpose: project record (not directly tied to a club; linkage is via `projectClubs`).
  - Fields: `name`, `description?`, `dueDate?`, `doneDate?`, `createdByUserId`, timestamps.
  - Index: `by_created_by`.
- `projectClubs`
  - Purpose: join table to link projects to clubs.
  - Fields: `projectId`, `clubId`.
  - Indexes: `by_project`, `by_club`, `by_club_and_project`.
- `projectMembers`
  - Purpose: membership for a user in a project with projectRole.
  - Fields: `projectId`, `userId`, `roleId`, `leftAt?`.
  - Indexes: `by_project`, `by_user`, `by_project_and_user`.
- `questions`
  - Purpose: question prompts for updates (currently minimal).
- `updates`
  - Purpose: update posts, optionally linked to a project and/or question.
  - Fields: `projectId?`, `questionId?`, `content`, `createdByUserId`, timestamps.
  - Indexes: `by_project`, `by_project_and_created`.
- `updateFiles`
  - Purpose: files attached to updates.
  - Fields: `updateId`, `storageId` (currently stored as `string`), `createdAt`.
  - Index: `by_update`.

### Notifications / Privacy

- `notifications`
  - Purpose: per-user notifications.
  - Fields: `userId`, `clubId?`, `title`, `message`, `url?`, `isRead`, `createdAt`.
  - Indexes: `by_user`, `by_user_and_created`.
- `privacyPolicy`
  - Purpose: versioned policy content with `isActive`.
  - Index: `by_active`.

### Chat

- `rooms`
  - Purpose: chat room, direct or group.
- `participants`
  - Purpose: room membership.
  - Indexes: `by_room`, `by_user`, `by_room_and_user`.
- `messages`
  - Purpose: messages in a room.
  - Fields: `roomId`, `userId`, `content?`, `type`, `mediaUrl?`, `isDeleted`, `createdAt`.
  - Indexes: `by_room`, `by_room_and_created`.

## Permissions Model (What Exists Today)

Primary helpers: `/Users/ronberlinski/Documents/curiosity-learning-flutter-to-svelte/src/convex/permissions.ts`

- `requireIdentity(ctx)` is the base auth gate.
- Club permissions are computed via `clubMembers` -> `clubRoles.permissions[]`.
- `getActiveClubContext` uses `profiles.activeClubId` and returns `permissions[]` for the active club.
  - `/Users/ronberlinski/Documents/curiosity-learning-flutter-to-svelte/src/convex/clubs.ts`
- Project permissions are checked via:
  - club-level permissions across linked clubs (`projectClubs`) OR
  - project-membership role permissions (`projectMembers` -> `projectRoles.permissions[]`).
  - `/Users/ronberlinski/Documents/curiosity-learning-flutter-to-svelte/src/convex/projects.ts`

Seeded defaults (idempotent):
- `/Users/ronberlinski/Documents/curiosity-learning-flutter-to-svelte/src/convex/bootstrap.ts`
  - Club roles: `Guide` and `Learner`.
  - Project roles: `Creator` and `Contributor`.
  - Note: permission strings include `updates:*`, but current `updates.ts` primarily gates on `project:read` and `project:update` rather than `updates:*`.

## Access Control (Current Behavior)

This is a “what the code enforces” map, not a desired-state policy.

### Profiles

- `profiles.getMe`: requires auth.
- `profiles.updateMe`: requires auth; enforces username uniqueness.
- `profiles.checkUsernameAvailability`: no auth required (public).

### Clubs

- `clubs.getMyClubs`: requires auth.
- `clubs.getClubPreviewByCode`: public; returns basic club metadata + member count if you have a valid code.
- `clubs.createClub`: requires auth; creator becomes a `Guide`; generates invite code; sets `profiles.activeClubId`.
- `clubs.joinClubWithCode`: requires auth; join as `Learner`; sets `profiles.activeClubId`.
- `clubs.switchActiveClub`: requires auth + must be a (non-left) member.
- `clubs.getActiveClubContext`: requires auth; if activeClubId exists but membership doesn’t, returns empty permissions.
- `clubs.getClubById`: requires `club:read` in that club.
- `clubs.updateClub`: requires `club:edit` in that club.
- `clubs.getMembers`: requires `club_member:read_active` in that club.
- `clubs.kickMember`: requires `club_member:kick`, plus role-order check (can’t kick equal/higher role).

### Sessions

All session endpoints require auth and then check club permissions via `requirePermission`:
- `session:read|create|update|delete`
- `session_activity:read|create|update|delete`
- `attendance:read|create`

### Projects

- `projects.listByClub`: requires `project:read` in the given club.
- `projects.getById`: requires `project:read` via (linked clubs OR project member role).
- `projects.create`: requires `project:create` in the given club; links project to club; adds creator as project member with `Creator` role.
- `projects.update`: requires `project:update` via (linked clubs OR project member role).
- `projects.listMembers`: requires `project:read` via (linked clubs OR project member role).
- `projects.addMember/removeMember`: requires `project:update` via (linked clubs OR project member role).

### Updates

- `updates.listByProject`: requires `project:update` (note: not `project:read`).
- `updates.listByClub`: requires `project:read` in that club; aggregates updates across linked projects.
- `updates.create/update/attachFiles`: requires `project:update`.
- `updates.listFiles`: requires auth only (no project/club permission check).

### Preferences / Notifications / Privacy Policy

- `preferences.get/upsert`: requires auth.
- `notifications.list/markRead`: requires auth; `markRead` enforces ownership.
- `privacyPolicy.getActive`: public read.
- `privacyPolicy.upsertActive`: requires auth only (no role/admin permission check).

### Chat

- `chat.listRooms/listRoomSummaries/getViewerIdentity`: requires auth; rooms are scoped to `participants` by user.
- `chat.getOrCreateDirectRoom`: requires auth. Does not require shared club with `otherUserId`.
- `chat.listMessages/sendMessage`: requires auth + must be a participant in the room.

## Security Gaps / Hardening Opportunities

These are the main “worth fixing” items surfaced by reading the current code.

### High Priority

- Privacy policy write access is too broad.
  - `privacyPolicy.upsertActive` is currently callable by any authenticated user.
  - Desired behavior likely: restrict to “admin” or “Guide in at least one club”, or a dedicated global admin allowlist.
- Update file listing is too broad.
  - `updates.listFiles(updateId)` only checks `requireIdentity`.
  - Any authenticated user who learns an `updateId` could list its files metadata.
- Bootstrap mutation writes without auth.
  - `bootstrap.seedDefaults` does not call `requireIdentity`.
  - It’s idempotent, but it is still a public write surface and should likely be `internalMutation` or require auth.

### Medium Priority

- Chat direct rooms can be created with any `otherUserId`.
  - The UI likely only surfaces club members, but the backend does not enforce “shared club” or any explicit allowlist.
- Permission string drift / inconsistencies.
  - Permissions include `updates:*` but `updates.ts` primarily gates on `project:*`.
  - `updates.listByProject` requires `project:update` which is stricter than `project:read` and inconsistent with `updates.listByClub`.
- Storage IDs are typed as `string`.
  - `updateFiles.storageId` and `attachFiles.storageIds` use `string`; if using Convex file storage, prefer `Id<'_storage'>` with validators to reduce mistakes.

## Decisions to Make (So the Model Stays Coherent)

1. Global admin model:
   - Do we need a dedicated “site admin” concept (e.g., env allowlist, `admins` table, or Better Auth role claims)?
2. Policy editing:
   - Should any `Guide` be allowed to update global policy text, or only site admins?
3. Chat scope:
   - Is chat intended to be only within a club, or global across users?
4. Project permissions vs club permissions:
   - Should project membership allow “project:update” even for users that are `Learner` at club-level?
5. Updates permissions:
   - Do we want explicit `updates:read/create/update` checks, or is “updates are part of project:update” intentional?

## Proposed Hardening Plan (Implementation Outline)

1. Write an explicit access-control matrix:
   - For each Convex function, record: who can call it, and which entity scope it should be tied to (club/project/user/room).
2. Fix the three high priority gaps:
   - Restrict `privacyPolicy.upsertActive`.
   - Add permission checks to `updates.listFiles`.
   - Make `bootstrap.seedDefaults` authenticated or internal-only.
3. Resolve permission drift:
   - Pick a single rule for updates access (either `updates:*` or project/club permissions) and make all endpoints consistent.
4. Decide and enforce chat scope:
   - If club-scoped, enforce shared club membership on `getOrCreateDirectRoom`.
5. Tighten types and validators:
   - Switch storage ids to proper Convex storage id typing if you’re using Convex file storage.
6. Add tests at the milestone:
   - Focused unit tests (or Convex function tests) for the fixed security boundaries, then E2E only if needed.
