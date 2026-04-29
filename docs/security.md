# Security & Access Control

> Permissions model, per-endpoint access rules, and known gaps. For table schemas see [data-model.md](data-model.md).

## Auth Plumbing

- **Provider:** Better Auth with Convex integration.
- **Token flow:** SvelteKit `hooks.server.ts` populates `event.locals.token` from Better Auth cookies. Server-side Convex client is created with this token.
- **Identity:** `identity.subject` is the canonical `userId` string used across all tables.
- **Trusted origins:** Configured in `src/convex/auth.ts`. LAN origins only enabled when `ALLOW_LAN_TRUSTED_ORIGINS === 'true'`.

## Permissions Model

Source: `src/convex/permissions.ts`

- `requireIdentity(ctx)` — base auth gate.
- Club permissions: `clubMembers` → `clubRoles.permissions[]`.
- Project permissions: club-level via `projectClubs` OR project-membership via `projectMembers` → `projectRoles.permissions[]`.
- Seeded roles (via `src/convex/bootstrap.ts`): Club has `Guide` and `Learner`; Project has `Creator` and `Contributor`.

## Access Control Matrix

### Profiles

| Endpoint                             | Auth | Permission | Notes                        |
| ------------------------------------ | ---- | ---------- | ---------------------------- |
| `profiles.getMe`                     | Yes  | —          |                              |
| `profiles.updateMe`                  | Yes  | —          | Enforces username uniqueness |
| `profiles.checkUsernameAvailability` | No   | —          | Public                       |

### Clubs

| Endpoint                     | Auth | Permission                | Notes                                                    |
| ---------------------------- | ---- | ------------------------- | -------------------------------------------------------- |
| `clubs.getMyClubs`           | Yes  | —                         |                                                          |
| `clubs.getClubPreviewByCode` | No   | —                         | Public; returns basic metadata                           |
| `clubs.createClub`           | Yes  | —                         | Legacy/direct creation; onboarding now uses applications |
| `clubs.joinClubWithCode`     | Yes  | —                         | Joins as Learner                                         |
| `clubs.switchActiveClub`     | Yes  | —                         | Must be non-left member                                  |
| `clubs.getActiveClubContext` | Yes  | —                         | Returns empty permissions if no membership               |
| `clubs.getClubById`          | Yes  | `club:read`               |                                                          |
| `clubs.updateClub`           | Yes  | `club:edit`               |                                                          |
| `clubs.getMembers`           | Yes  | `club_member:read_active` |                                                          |
| `clubs.kickMember`           | Yes  | `club_member:kick`        | Role-order check (can't kick equal/higher)               |

### Club Applications / Reviews

| Endpoint                                      | Auth | Permission             | Notes                                                                                |
| --------------------------------------------- | ---- | ---------------------- | ------------------------------------------------------------------------------------ |
| `clubApplications.submitApplication`          | Yes  | —                      | Creates pending Start Club application; blocked while a child consent row is pending |
| `clubApplications.listMyApplications`         | Yes  | —                      | Applicant-scoped                                                                     |
| `clubApplications.listReviewableApplications` | Yes  | Guide role in any club | Excludes applicant's own applications                                                |
| `clubApplications.upsertApplicationReview`    | Yes  | Guide role in any club | One review per reviewer/application; score 0-10 and note required                    |
| `clubApplications.finalizeApplication`        | Yes  | Convex env allowlist   | Creates club + Guide membership; no reject path in v1                                |

### Parent Consent

| Endpoint                        | Auth | Permission | Notes                                                                                                                                                             |
| ------------------------------- | ---- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `childSignup.registerChild`     | No   | —          | Action creates pending child username/password account and emails parent consent link                                                                             |
| `childSignup.getConsentByToken` | No   | —          | Public consent-link preview                                                                                                                                       |
| `childSignup.approveConsent`    | No   | —          | Token-based approval records parent terms/privacy acceptance for that child, links/creates the parent, verifies the child, and completes pending Join Club intent |

### Sessions

All require auth + club permission via `requirePermission`:
`session:read|create|update|delete`, `session_activity:read|create|update|delete`, `attendance:read|create`

### Projects

| Endpoint                          | Auth | Permission       | Notes                                    |
| --------------------------------- | ---- | ---------------- | ---------------------------------------- |
| `projects.listByClub`             | Yes  | `project:read`   | Scoped to club                           |
| `projects.getById`                | Yes  | `project:read`   | Via linked clubs OR project membership   |
| `projects.create`                 | Yes  | `project:create` | Links to club; creator gets Creator role |
| `projects.update`                 | Yes  | `project:update` | Via linked clubs OR project membership   |
| `projects.listMembers`            | Yes  | `project:read`   | Via linked clubs OR project membership   |
| `projects.addMember/removeMember` | Yes  | `project:update` | Via linked clubs OR project membership   |

### Updates

| Endpoint                           | Auth | Permission       | Notes                                         |
| ---------------------------------- | ---- | ---------------- | --------------------------------------------- |
| `updates.listByProject`            | Yes  | `project:update` | Stricter than `project:read` — see gaps below |
| `updates.listByClub`               | Yes  | `project:read`   | Aggregates across linked projects             |
| `updates.listForViewer`            | Yes  | `project:read`   | Aggregates viewer-readable club feed updates  |
| `updates.create/update`            | Yes  | `project:update` |                                               |
| `updates.attachFiles`              | Yes  | `project:update` |                                               |
| `updates.listFiles`                | Yes  | —                | **Gap:** only checks auth, not project scope  |
| `updates.getProjectDeliveryAssets` | Yes  | `project:update` | Manager-scoped signed media lookup            |

### Media Delivery

| Endpoint                                                                                             | Auth | Permission       | Notes                                                             |
| ---------------------------------------------------------------------------------------------------- | ---- | ---------------- | ----------------------------------------------------------------- |
| `media.beginUpload/finalizeUpload/cancelUpload/retryProcessing/deleteUpload/getUpload/listMyUploads` | Yes  | owner-scoped     | Upload control plane is always scoped to the asset owner          |
| `POST /api/media/refresh` (`owned`)                                                                  | Yes  | owner-scoped     | Mints signed URLs only for caller-owned ready assets              |
| `POST /api/media/refresh` (`project`)                                                                | Yes  | `project:update` | Uses `updates.getProjectDeliveryAssets`; currently manager-scoped |

Notes:

- Client upload constraints sent to Convex must stay limited to the backend validator shape (`acceptedContentTypes`, `maxBytes`, processing flags). UI helpers such as HTML `accept` strings are client-only metadata and must not be forwarded through `media.beginUpload`.
- Signed delivery is URL-based via `/api/media/refresh`; the app no longer relies on a shared `/media/[assetId]` route or CloudFront signed cookies.

### Preferences / Notifications / Legal Documents

| Endpoint                                   | Auth   | Permission | Notes                                            |
| ------------------------------------------ | ------ | ---------- | ------------------------------------------------ |
| `preferences.get/upsert`                   | Yes    | —          |                                                  |
| `notifications.list/markRead`              | Yes    | —          | `markRead` enforces ownership                    |
| `legalDocuments.getActiveByKey/listActive` | No     | —          | Public                                           |
| `legalDocuments.upsertActive`              | Yes    | —          | **Gap:** any auth user can edit legal docs       |
| `privacyPolicy.getActive/upsertActive`     | Yes/No | —          | Legacy alias behavior backed by `legalDocuments` |

### Chat

| Endpoint                                            | Auth | Permission         | Notes                                                 |
| --------------------------------------------------- | ---- | ------------------ | ----------------------------------------------------- |
| `chat.listRooms/listRoomSummaries/getUnreadSummary` | Yes  | —                  | Scoped to user's `participants`                       |
| `chat.getOrCreateDirectRoom`                        | Yes  | active shared club | Requires the other user to be in viewer's active club |
| `chat.listMessages/sendMessage/markRoomRead`        | Yes  | —                  | Must be room participant                              |
| `chat.listUsersForMessaging`                        | Yes  | —                  | Lists users in viewer's active club                   |

## Known Gaps

### High Priority

1. **Legal document write is too broad** — `legalDocuments.upsertActive` is callable by any auth user. Should restrict to admin.
2. **Update file listing is too broad** — `updates.listFiles(updateId)` only checks auth. Any user who knows an `updateId` can list its files.
3. **Bootstrap is unauthenticated** — `bootstrap.seedDefaults` should be `internalMutation` or require auth.

### Medium Priority

4. **Permission string drift** — Roles have `updates:*` but code checks `project:*`. `updates.listByProject` requires `project:update` (not `project:read`), inconsistent with `listByClub`.

## Hardening Plan

1. Keep this access-control matrix current as endpoints change.
2. Fix high-priority gaps (policy write, file listing, bootstrap).
3. Resolve permission string drift (pick `updates:*` or `project:*`).
4. Add focused tests for security boundaries.
