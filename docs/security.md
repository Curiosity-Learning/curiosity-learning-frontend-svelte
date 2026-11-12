# Security & Access Control

> Permissions model, per-endpoint access rules, and known gaps. For table schemas see [data-model.md](data-model.md).

## Auth Plumbing

- **Provider:** Better Auth with Convex integration.
- **Token flow:** SvelteKit `hooks.server.ts` populates `event.locals.token` from Better Auth cookies. Server-side Convex client is created with this token.
- **Identity:** `identity.subject` is resolved to `profiles.authUserId` at the auth boundary. App-owned relationships use `profiles._id`.
- **Trusted origins:** Configured in `src/convex/auth.ts`. LAN origins only enabled when `ALLOW_LAN_TRUSTED_ORIGINS === 'true'`.

## Parent Accounts & Sign-in Links

- **Parent account at consent approval.** `childSignup.approveConsent` finds or creates the Better Auth user for `parentChildConsents.parentEmail` (the consent token was only ever emailed there, so holding it proves ownership of the address). A new user is created verified and password-less. Settings offers "Set a password" to accounts without a `credential` account (`auth.getMySignInMethods`, caller-scoped; never to child accounts): it sends Better Auth's password-reset email to the caller's own address, which creates the credential account. `/auth/reset-password?token=…` opens for a signed-in visitor too (`auth/+layout.server.ts`; without a token a signed-in visitor is still redirected), so the link works in the browser that asked for it. A club-less account with a `parentLinks` row lands on `/child/{firstLinkedChildId}` instead of `/new-club` (`parentAccounts.getMyFirstLinkedChildId`, `clubLessLandingPath`).
- **Adopting an unverified user (CL-768).** If a user already exists under that address but is unverified, whoever registered it never proved they own the address (most plausibly the child). Before marking it verified, approval deletes all of its `account` rows (password, linked providers) and `session` rows and resets its self-chosen name and image, so no sign-in method the registrant set up survives. The username is left as it is: the auth adapter's uniqueness check treats null as a value, so clearing it broke every later adoption (found in QA on CL-784), and without a password account it cannot sign in. A verified existing user is adopted unchanged.
- **Accounts adopted before the strip (review S3, deployment note).** Approvals before 6fa7edb only flipped `emailVerified` and kept the registrant's password. Right after deploying, run `npx convex run childSignup:auditAdoptedParentAccounts --prod`: it lists approved consents whose parent auth user has a `credential` account created before `approvedAt` (consent id, child profile id, parent auth user id, timestamps; no emails). A legitimate adult who signed up with a password and verified before approving also matches, so review each row by hand (e.g. the user's `createdAt` close to the child's signup suggests a pre-registration). For each confirmed case run `npx convex run childSignup:stripAdoptedParentCredentials '{"consentId":"<id>"}' --prod`, which deletes that user's `account` and `session` rows (as approval now does) and refuses consents that do not match the audit; then tell the parent they can sign in by email link or set a password, and record the outcome in Fibery.
- **Who can sign in by email link.** `magicLinks.isMagicLinkRecipient` is the single rule for both server-minted links (`magicLinks.mintMagicLink`) and the plugin's own "send me a new link" (`sendMagicLink` in `auth.ts`): verified users only (the verify endpoint would otherwise mark an unverified user verified), never platform admins (`profiles.globalRole === 'admin'`; admin sessions are shared with the admin portal), and never child accounts (synthetic `@children.curiosity.local` address). Ineligible addresses get no link, silently: the endpoint answers the same either way.
- **What a link grants.** A full 7-day session for that account (see Sessions below), i.e. everything a parent can do: read the linked child's chats (including other members' messages in those rooms), change the child's email routing, and use the account like any other adult. Links are single use, hashed at rest (`storeToken: 'hashed'`), 32 random letters, `disableSignUp`, relative callback paths only. Rate limits: see below.
- **Lifetimes (`src/lib/auth/magic-link.ts`).** Consent success screen 30 min; notification and chat email buttons 48 h; the sign-in page's "Send me a new link" (plugin `expiresIn`) 30 min; the "different email" recovery link (`APPROVING_ACCOUNT_MAGIC_LINK_SECONDS`) 30 min. An expired link lands on the sign-in page, which offers a new one and continues to the same page.
- **One token per email.** Only the button signs in; other links in a parent email (e.g. "Open {child}'s page" under the "add an email address" note) are plain paths the button's session covers. Parent emails say under the button that it signs in and should not be forwarded.
- **Interstitial (`/auth/link`).** Every emailed or displayed link points at `/auth/link#t=<token>&next=<path>&as=<masked email>`, never at `/api/auth/magic-link/verify`. The fragment never reaches a server (no token in request logs, proxies or Referer); the page drops it from the address bar with `replaceState`, shows "Sign in as p…@x.com?" (an `as` that is not in `maskEmail`'s shape is dropped, so the page shows no attacker-written text), and only calls the verify endpoint when the person presses the button, so mail scanners that GET links cannot consume the token or receive the session. The plugin's own emailed links are re-pointed at the interstitial in `sendMagicLink`.
- **Where tokens are minted.** Email links are minted in the send action (`notifications.deliverNotificationEmail`, the one place a parent audience becomes a link), right before `sendEmail`; scheduled-function args carry only the address, audience and app path, never a token. The consent screen's link is minted in the `approveConsent` mutation because the page needs it in the response: Convex mutations back `crypto.getRandomValues` with a ChaCha12 CSPRNG seeded per execution (not OS randomness), accepted for a 30-minute link. The token still exists in plaintext in the sent email (Resend keeps bodies): keep Resend click tracking off and dashboard access limited.
- **Rate limits.** Better Auth's built-in limiter is **not** relied on and not configured (`rateLimit` unset in `auth.ts`): in 1.4.9 it is on only when `NODE_ENV === 'production'` (the Convex runtime does not set it unless the deployment env does: `npx convex env list --prod`), keeps counters in memory by default (per isolate in Convex), and skips any request without a client IP. Requests reach it through the SvelteKit proxy (`/api/auth/[...all]` copies the incoming headers, so Vercel's `x-forwarded-for` is passed on), but the Convex site URL is also directly reachable, where `x-forwarded-for` is whatever the caller sends, and if the header ever carried the proxy's own address every visitor would share one bucket (3 sign-ins per 10 s for everyone). So the limits that are enforced are app-level, per address: the plugin's "Send me a new link" sends at most 5 links per address per hour (`magicLinks.consumeSelfServiceMagicLinkAllowance`, `rateLimiting.ts`; over the cap the request is answered the same and nothing is sent); the "different email" recovery link 3 per caller and child and 3 per consent per 24 h; child confirmation emails 3 per child per 24 h. Password reset and email OTP have no app-level cap yet.
- **Cleanup.** A daily cron (`magicLinks.deleteExpiredVerifications` via `crons.runDailyMaintenance`) deletes expired `verification` rows (unclicked links, OTP codes, reset tokens).
- **No email to synthetic child addresses.** `sendEmail` refuses `@children.curiosity.local` (fails like any send); password reset for a child username is silently skipped. Children have no self-service password reset yet.
- **Version pinning.** `magicLinks.ts` reimplements the plugin's storage and verify contract (including the verify endpoint's extra `decodeURIComponent` of callback params), so `better-auth` and `@convex-dev/better-auth` are pinned to exact versions; `magicLinks.spec.ts` round-trips real links, including an expired link's `next` with a query string. Re-run it and re-check `src/convex/magicLinks.ts` on every upgrade.

## Signed In With a Different Email (review S9)

- **The situation.** The approving parent's account is the one under the consent address A. A parent who later signs up or signs in with another address B has a second, unlinked account: `syncParentLinks` matches consents by the caller's own auth email only, so B never claims A's children. There is no "link this account" flow (it would need both a B session and a fresh confirmation sent to A, S9-3); an old consent link never attaches a signed-in account.
- **Sign-in page.** "Email me a sign-in link" appears as soon as the typed identifier is an email whose account has no password and no Google (`isPasswordlessSignInAccount` over `auth.getSignupAccountStatusByEmail`, unchanged — nothing is added to what that query already reveals). Every consent-created parent account qualifies. The copy is generic ("for example from approving a child's account").
- **`/child/{id}` "not linked".** Explains "You are signed in as {B}" and offers `parentAccounts.requestApprovingAccountSignInLink({ childProfileId })`. The mutation resolves the approved, not-unlinked consent server-side and, when its `parentEmail` is not the caller's own (and the caller is not a child account), schedules an action that mints a 30-minute sign-in link (the parent is waiting for it) continuing to `/child/{id}` for that address and emails it with the plain "Your sign-in link" template (logged as `approving_account_sign_in_link`). It answers `requested` whether or not a consent exists or anything was sent and never returns the address, not even masked; `rateLimited` (3 per caller and child per 24 h, counted for every request) depends on the caller's own requests only. Separately, at most 3 links per consent per 24 h are sent whoever asks (review S4), so a group of accounts cannot flood the parent; over that cap nothing is sent and the answer is still `requested`. The link signs in as A, never as B. It takes a `childProfileId` without `requireParentLink` (the caller is unlinked by definition) and is on the structural scan's allowlist with that reason.
- **Never revealed.** The approving address (to a different signed-in account), whether a child has a consent, and whether a sign-in link was sent.

## Child Notification Email (CL-768)

- **Pending until the child confirms.** A parent can give a child account a real notification address (`parentAccounts.setChildNotificationEmail`, linked parent only). It stays pending until the child confirms it, and a pending address receives nothing except the confirmation email: `notificationRouting.resolveEmailRecipients` only routes to it once `notificationEmailVerifiedAt` is set (chat falls back to the parent, other high-tier kinds are not emailed, critical notices always go to the parent).
- **Confirmation is bound to the child's session, not to the inbox.** Clicking a link only proves control of an inbox, and the address may be a typo or someone else's. The emailed link opens `/verify-email/{token}` inside the signed-in `(app)` group; `childEmailVerification.confirmChildEmail` requires an unconsumed, unexpired (72 h) token whose row names the caller's own profile and the child's current address. Any other signed-in account gets "different account" (`getChildEmailVerification` returns `wrongAccount` before any other state, without the child's name) and the token is not consumed. Tokens are 32 random letters generated in the send action (OS randomness), stored only as a sha-256 hash, never in scheduler args; a new request or a change or removal invalidates older links.
- **What the confirmation email contains.** Only: the parent added this address for notifications for the account `{username}`; sign in as `{username}` to confirm; ignore it if unknown. No club names, no dates, no sign-in link and no other link than the confirmation page. The address is notification-only, never a sign-in identifier or a password-reset target.
- **Validation.** The parent's own sign-in email and the consent `parentEmail` are refused (child-worded email would reach the parent). Addresses belonging to other accounts are allowed (siblings may share an inbox; refusing would also reveal which addresses have accounts). At most 3 confirmation emails per child per 24 h (set, change and resend all count; `rateLimiting.ts`).
- **Fresh sign-in for routing changes.** Setting, changing, resending and removing require a Better Auth session created within the last 15 minutes (`sessionFreshness.requireFreshSession`): the Convex JWT's `sessionId` claim (added by the `@convex-dev/better-auth` convex plugin) is looked up in the component's `session` table and its `createdAt` checked (refresh never moves `createdAt`). Otherwise the mutation throws `FRESH_SESSION_REQUIRED` and the child page offers "Sign in again" (sign out, then `/auth/sign-in?next=/child/{id}`; the sign-in page offers "Email me a sign-in link" whenever the typed email's account has no password). This stops a parent session left on a shared computer from redirecting the child's emails.
- **Chosen on the consent screen.** `childSignup.approveConsent` (token-keyed, no `childProfileId` argument) takes an optional `childEmail`, validated with the same rules (`parentAccounts.normalizeChildNotificationEmail`, against the consent `parentEmail`, which is also the parent account's auth email) before anything is written, so a refused address leaves the consent pending. A valid one is stored pending (`notificationEmailSource: 'consent'`) and goes through the same confirmation email and rate limit. No fresh-sign-in rule (the consent token is the proof; there is no session yet) and no parent notice (the parent chose it on that screen).
- **3-day reminder (edge case 4).** A daily cron (`childEmailVerification.schedulePendingEmailReminders`) emails the parent once per address still pending 3+ days after it was set: "{child} hasn't confirmed their email address yet", masked address, plain `/child/{id}` link. Stamped `notificationEmailReminderSentAt` first (once per address even if the send fails); setting a new address clears it. Addresses a 16+ child entered themselves are stamped without an email.
- **Email language.** Every email the backend sends (`email/templates.ts`, chat and notification copy, parent prefixes and CTAs) is English-only, deliberately, for now; the app UI is EN + NL.
- **Parent notice.** Every routing change (pending, confirmed by the child, removed) emails the approved consent address a plain notice with the masked address and "Not you? Open {child}'s page to undo." — a plain `/child/{id}` link, never a sign-in link. Logged on `emailDeliveries`.

## Child Aged 16+: Own Email and Unlinking (CL-769, review S7/D4, edge case 13)

- **The 16+ child owns their own address.** `parentAccounts.setMyNotificationEmail` (caller-keyed, no profile id argument) lets a child account aged 16+ set, change, resend or remove their own notification email; `getMyNotificationEmail` returns null for everyone else, and Settings shows the "Your email address" card only when it is not null. Both check server-side: synthetic child auth email and `isAtLeast16FromDateOfBirth` (the permissive first-of-birth-month reading also used for unlinking). The address goes through the same pending flow as a parent-entered one (confirmation email, `/verify-email/{token}` bound to the child's session, 72 h, 3 per 24 h shared with the parent's form), with `notificationEmailSource: 'self'` and the child as `requestedByProfileId`; the confirmation email says "You added this address". Every approved consent address and every linked parent's sign-in email is refused. Requires a session created within 15 minutes. A linked parent gets the usual plain routing-changed notice and, while linked, can still change the address from the child's page.
- **Date of birth is immutable for child accounts (review B1).** Every 16+ gate reads `profiles.dateOfBirth`, so a child account's value is set once, at child signup (`childSignup.createPendingChildAccount`), and never from the client afterwards: `profiles.updateMe` and `auth.completeSignupProfile` throw when a child (any `parentChildConsents` row, or a synthetic auth email: `notificationRouting.isChildAccount`) sends a value that differs from the stored one, including a first value when none is stored (`assertDateOfBirthChangeAllowed`). Correcting a child's date of birth is an admin/data fix. Adults may edit theirs (`YYYY-MM` only).
- **Unlinking requires a confirmed own address.** `unlinkParent` throws `UNLINK_REQUIRES_CONFIRMED_EMAIL` unless `notificationEmailVerifiedAt` is set; the Settings dialog explains it and disables the button. After unlinking, removing the address is refused (`OWN_EMAIL_REQUIRED`); changing it is allowed, and until the new one is confirmed emails reach nobody (in-app rows still arrive).
- **What unlinking does.** Deletes the `parentLinks` row and the pair's `parentNotificationSettings` row, stamps `unlinkedAt` on the consent(s) (kept as the legal record; `syncParentLinks` and the `/child` claim skip them, so the link cannot be claimed back), and sends the parent ONE final plain email — "{child} has unlinked your parent account. You will no longer receive emails about {child}." — with no link at all, logged on `emailDeliveries` (`kind: parent_unlinked`, `audience: parent`). A repeated call unlinks nothing and sends nothing.

## Who Gets a Child Account's Emails (CL-768/CL-769)

Routing lives in `src/convex/notificationRouting.ts` (one matrix, used by dispatched notifications and chat emails). "Confirmed" means the child confirmed their notification address (`notificationEmailVerifiedAt`).

| Kind                                                                                                                 | No confirmed child email                   | Confirmed child email                                                                    |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Critical (`application_status`, `kicked_from_club`, `account_*`, `parental_consent_request`, `review_chat_activity`) | parent                                     | parent **and** child, as two separate emails                                             |
| Club/project chat (`chat_activity`)                                                                                  | parent (mandatory, otherwise nobody hears) | child (child's mute applies) + parent copy only if the parent turned on `chatCopies`     |
| Other high kinds (session reminders/cancellations, join and project requests, promotions, feedback, quality flags)   | nobody                                     | child (child's mute applies) + parent copy only if the parent turned on `activityCopies` |
| Medium                                                                                                               | in-app only                                | in-app only                                                                              |

- **Never one email with two recipients.** A notice owed to the parent and the child is two sends and two `emailDeliveries` rows (`audience` `parent` / `self`). The parent copy carries the one-time sign-in link and parent wording; the child copy is plain.
- **Mutes govern only the muter's own copy (review S6/D3).** A child's preferences remove the child's own email and the in-app row, never the parent's copy (before this, the child's `chatMessages` mute silenced the parent's chat emails). Critical kinds ignore every mute and setting.
- **Parent per-child settings (`parentNotificationSettings`).** Default off ("child only, parent can opt back in", D7). `parentAccounts.setParentNotificationSettings` requires a `parentLinks` row and a session created within 15 minutes, like the routing changes above (S5): a child using the parent's leftover session cannot switch the parent's copies off. A parent cannot turn off critical notices or, before the child has a confirmed address, chat emails.
- **Unlinked parents (16+ child, `parentChildConsents.unlinkedAt`; review S7/D4).** An unlinked consent is no parent for routing at all: no critical notices, no chat, no copies, and therefore no sign-in link is ever minted for them (`deliverNotificationEmail` only mints for the `parent` audience, which routing never yields for an unlinked consent). The child is in effect an independent user: critical notices go to their confirmed address only, chat and other high kinds to that address subject to the child's own mutes. A child who unlinked before this rule and has no confirmed address gets in-app rows only until they add one.
- **Chat coverage per audience.** `roomEmailMarkers` rows are per (recipient, room, audience), so a failed parent copy never advances or blocks the child's (review edge case 5). Only the child reading the room counts as read: the parent copy repeats at most every 12 h while the child leaves the batch unread (edge case 7).

## Parent Mutations Guard (review S13)

Every public `mutation` whose args include a `v.id('profiles')` (any name) must call `requireParentLink(` in its handler, or be on a short allowlist with the guard it calls instead and why it is not a parent acting on a child (admin, club-staff and project-staff mutations, `unlinkParent`, which the child calls about their own link, and `requestApprovingAccountSignInLink`, which an unlinked caller uses and which discloses nothing; it is the only entry allowed a `childProfileId` argument). The scan is the first test under "structural guard" in `src/convex/parentAccounts.spec.ts`; the same block tests that an adult without a link gets "You do not have access to this child account" from each parent mutation.

## Sessions

- **Lifetime.** Normal sign-ins (password, Google, email OTP) last 30 days (`REMEMBERED_SESSION_SECONDS`) and are refreshed on use. Sessions created by a one-time sign-in link (`/magic-link/verify`) last 7 days (`SIGN_IN_LINK_SESSION_SECONDS`, CL-769): a session `databaseHooks.create.before` hook in `auth.ts` sets the shorter expiry, and an `update.before` hook keeps any session whose lifetime is at most 7 days capped at `createdAt + 7 days`, because Better Auth's refresh would otherwise reset it to the full 30 days on first use. The session row's own lifetime is the marker; no extra table.
- **Sign out everywhere.** Settings → "Signed-in devices" revokes every other session (`authClient.revokeOtherSessions`) and then signs this device out.
- **Shared devices.** A visit that arrived through a sign-in link lands with `via=link` (added by the `/auth/link` interstitial to the verify callback). `/child/[id]` reads it once, remembers it in `sessionStorage` for the tab, strips it from the address bar, and shows a dismissible "Not your device? Sign out" banner.

## Permissions Model

Source: `src/convex/permissions.ts`

- `requireIdentity(ctx)` — base auth gate.
- Club permissions: `clubMembers.profileId` → `clubRoles.permissions[]`.
- Project permissions: club-level via `projectClubs` OR `projectMembers.profileId` → `projectRoles.permissions[]`.
- Stable role keys drive system behavior: club roles use `guide`/`learner`; project roles use `creator`/`contributor`. Display names may change.

## Access Control Matrix

### Profiles

| Endpoint                             | Auth | Permission | Notes                                                                      |
| ------------------------------------ | ---- | ---------- | -------------------------------------------------------------------------- |
| `profiles.getMe`                     | Yes  | —          |                                                                            |
| `profiles.updateMe`                  | Yes  | —          | Enforces username uniqueness; a child account's `dateOfBirth` is immutable |
| `profiles.checkUsernameAvailability` | No   | —          | Public                                                                     |

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

| Endpoint                                      | Auth | Permission             | Notes                                                                                                             |
| --------------------------------------------- | ---- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `clubApplications.saveIncompleteApplication`  | Yes  | —                      | Creates or updates the applicant's incomplete Start Club application draft                                        |
| `clubApplications.submitApplication`          | Yes  | —                      | Requires a ready video, promotes incomplete draft to pending review; blocked while a child consent row is pending |
| `clubApplications.listMyApplications`         | Yes  | —                      | Applicant-scoped                                                                                                  |
| `clubApplications.listReviewableApplications` | Yes  | Guide role in any club | Excludes applicant's own applications                                                                             |
| `clubApplications.upsertApplicationReview`    | Yes  | Guide role in any club | One review per reviewer/application; score 0-10 and note required                                                 |
| `clubApplications.finalizeApplication`        | Yes  | Convex env allowlist   | Creates club + Guide membership; no reject path in v1                                                             |

### Parent Consent

| Endpoint                                           | Auth | Permission                                   | Notes                                                                                                                                                                                                                                                                       |
| -------------------------------------------------- | ---- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `childSignup.registerChild`                        | No   | —                                            | Action creates pending child username/password account and emails parent consent link                                                                                                                                                                                       |
| `childSignup.getConsentByToken`                    | No   | —                                            | Public consent-link preview                                                                                                                                                                                                                                                 |
| `childSignup.approveConsent`                       | No   | —                                            | Token-based approval records parent terms/privacy acceptance (versions, wording key, locale) for that child and, once, on the parent profile; links/creates the parent, verifies the child, optionally stores a pending child email, and completes pending Join Club intent |
| `parentAccounts.setChildNotificationEmail`         | Yes  | linked parent + session < 15 min             | Sets/changes/resends/removes a child's pending notification email; emails the parent a notice                                                                                                                                                                               |
| `parentAccounts.setParentNotificationSettings`     | Yes  | linked parent + session < 15 min             | The caller's own `chatCopies` / `activityCopies` for that child; a no-op needs no fresh session                                                                                                                                                                             |
| `parentAccounts.setMyNotificationEmail`            | Yes  | child account 16+ + session < 15 min         | The caller's own pending notification email; removal refused once no parent is linked                                                                                                                                                                                       |
| `parentAccounts.unlinkParent`                      | Yes  | child account 16+ with a confirmed own email | Caller-keyed; ends every email to that parent after one final notice                                                                                                                                                                                                        |
| `parentAccounts.requestApprovingAccountSignInLink` | Yes  | — (caller is unlinked by design)             | Emails a 48 h sign-in link to the child's approving address if it is not the caller's; same answer either way, 3/24 h per caller and child                                                                                                                                  |
| `childEmailVerification.getChildEmailVerification` | Yes  | —                                            | Link state for the caller; `wrongAccount` unless the caller is the child                                                                                                                                                                                                    |
| `childEmailVerification.confirmChildEmail`         | Yes  | the child the token names                    | Token-keyed; confirms the pending address                                                                                                                                                                                                                                   |

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

| Endpoint                           | Auth | Permission       | Notes                                        |
| ---------------------------------- | ---- | ---------------- | -------------------------------------------- |
| `updates.listByProject`            | Yes  | `project:read`   | Via linked clubs OR project membership       |
| `updates.listByClub`               | Yes  | `project:read`   | Aggregates across linked projects            |
| `updates.listForViewer`            | Yes  | `project:read`   | Aggregates viewer-readable club feed updates |
| `updates.create/update`            | Yes  | `project:update` |                                              |
| `updates.attachFiles`              | Yes  | `project:update` |                                              |
| `updates.listFiles`                | Yes  | `project:read`   | Via linked clubs OR project membership       |
| `updates.getProjectDeliveryAssets` | Yes  | `project:read`   | Project-scoped signed media lookup           |

### Media Delivery

| Endpoint                                                                                             | Auth | Permission     | Notes                                                    |
| ---------------------------------------------------------------------------------------------------- | ---- | -------------- | -------------------------------------------------------- |
| `media.beginUpload/finalizeUpload/cancelUpload/retryProcessing/deleteUpload/getUpload/listMyUploads` | Yes  | owner-scoped   | Upload control plane is always scoped to the asset owner |
| `POST /api/media/refresh` (`owned`)                                                                  | Yes  | owner-scoped   | Mints signed URLs only for caller-owned ready assets     |
| `POST /api/media/refresh` (`project`)                                                                | Yes  | `project:read` | Uses `updates.getProjectDeliveryAssets`                  |

Notes:

- Client upload constraints sent to Convex must stay limited to the backend validator shape (`acceptedContentTypes`, `maxBytes`, processing flags). UI helpers such as HTML `accept` strings are client-only metadata and must not be forwarded through `media.beginUpload`.
- Signed delivery is URL-based via `/api/media/refresh`; the app no longer relies on a shared `/media/[assetId]` route or CloudFront signed cookies.

### Operational Monitoring

| Endpoint                               | Auth                       | Notes                                                                |
| -------------------------------------- | -------------------------- | -------------------------------------------------------------------- |
| `POST /api/internal/monitoring/report` | `MONITORING_REPORT_SECRET` | Accepts only size-limited, allowlisted, redacted Convex failure data |
| `POST /api/webhooks/resend`            | Resend webhook signature   | Captures delivery failures without storing recipient or message data |

- Sentry default PII collection, tracing, replay, and Sentry logs are disabled.
- Monitoring redacts cookies, authorization headers, request bodies, query strings, emails, consent/reset/email-confirmation (`/verify-email/{token}`) tokens, sign-in link tokens (`#t=`, `?token=`), and signed URL parameters.
- Entity IDs, operation names, provider names, statuses, and failure codes are allowed when needed to debug an operational failure.
- `MONITORING_REPORT_SECRET`, `RESEND_WEBHOOK_SECRET`, and `SENTRY_AUTH_TOKEN` must remain outside the repository.

### Preferences / Notifications / Legal Documents

| Endpoint                                   | Auth   | Permission | Notes                                            |
| ------------------------------------------ | ------ | ---------- | ------------------------------------------------ |
| `preferences.get/upsert`                   | Yes    | —          |                                                  |
| `notifications.list/markRead`              | Yes    | —          | `markRead` enforces ownership                    |
| `legalDocuments.getActiveByKey/listActive` | No     | —          | Public                                           |
| `legalDocuments.upsertActive`              | Yes    | —          | **Gap:** any auth user can edit legal docs       |
| `privacyPolicy.getActive/upsertActive`     | Yes/No | —          | Legacy alias behavior backed by `legalDocuments` |

### Chat

| Endpoint                 | Auth | Permission | Notes                                                                       |
| ------------------------ | ---- | ---------- | --------------------------------------------------------------------------- |
| `chat.listRoomSummaries` | Yes  | —          | Rooms are derived from the viewer's club, project, and application contexts |
| `chat.listMessages`      | Yes  | —          | Requires current or historical access to the room context                   |
| `chat.sendMessage`       | Yes  | —          | Requires active access to the room context                                  |

## Known Gaps

### High Priority

1. **Legal document write is too broad** — `legalDocuments.upsertActive` is callable by any auth user. Should restrict to admin.

### Medium Priority

1. **Permission vocabulary drift** — Some role records may still carry legacy `updates:*` permissions, while project update APIs use `project:*`.

## Hardening Plan

1. Keep this access-control matrix current as endpoints change.
2. Fix high-priority gaps (policy write, file listing).
3. Resolve permission string drift (pick `updates:*` or `project:*`).
4. Add focused tests for security boundaries.
