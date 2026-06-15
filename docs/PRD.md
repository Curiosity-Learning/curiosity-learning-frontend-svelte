# **Curiosity Club Platform — Product Requirements Document**

**Version:** 1.3 **Date:** March 5, 2026 **Author:** Curiosity Learning Core Team **Status:** Draft — open design question resolution pending

---

## *Table of Contents*

1. [Product Overview](#1-product-overview)  
2. [User Roles & Personas](#2-user-roles--personas)  
3. [App Structure & Navigation](#3-app-structure--navigation)  
4. [Platform Requirements](#4-platform-requirements)  
5. [Data Model & Ownership](#5-data-model--ownership)  
6. [Feature Specifications](#6-feature-specifications)  
   - 6.1 [Authentication & Onboarding](#61-authentication--onboarding)  
   - 6.2 [Club Creation & Management](#62-club-creation--management)  
   - 6.3 [Club Discovery & Joining](#63-club-discovery--joining)  
   - 6.4 [Sessions & Attendance](#64-sessions--attendance)  
   - 6.5 [Activity Booklet](#65-activity-booklet)  
   - 6.6 [Projects & Attribution](#66-projects--attribution)  
   - 6.7 [Project Updates & Feed](#67-project-updates--feed)  
   - 6.8 [Chat & Messaging](#68-chat--messaging)  
   - 6.9 [Guide Application & Peer Review](#69-guide-application--peer-review)  
   - 6.10 [Club of Clubs](#610-club-of-clubs)  
   - 6.11 [Quarterly Feedback Forms](#611-quarterly-feedback-forms)  
   - 6.12 [User Profiles](#612-user-profiles)  
   - 6.13 [Notifications](#613-notifications)  
   - 6.14 [Admin Dashboard](#614-admin-dashboard)  
   - 6.15 [Safeguarding & Reporting](#615-safeguarding--reporting)  
   - 6.16 [Search](#616-search)  
7. [Permissions Matrix](#7-permissions-matrix)  
8. [Safety & Compliance](#8-safety--compliance)  
9. [Edge Cases & Business Rules](#9-edge-cases--business-rules)  
10. [Open Design Questions](#10-open-design-questions)  
11. [Non-Functional Requirements](#11-non-functional-requirements)  
12. [Tech Stack (Decided)](#12-tech-stack-decided)  
13. [v1 Scope vs. Future Roadmap](#13-v1-scope-vs-future-roadmap)  
14. [Glossary](#14-glossary)

---

## *1\. Product Overview*

### 1.1 What We're Building

The Curiosity Club Platform is a web application (with future mobile support) that powers the operational backbone of Curiosity Learning — a global, decentralized network of learning clubs. The platform replaces the current WhatsApp \+ Google Drive workflow with a purpose-built system for managing clubs, sessions, projects, peer support, and community.

### 1.2 Why We're Building It

Curiosity Learning's mission is to nurture intrinsic motivation to learn. Clubs operate independently across the world, but they need shared infrastructure for:

- **Onboarding and vetting** new Guides through a peer-reviewed application process.  
- **Running club sessions** with structured activities and attendance tracking.  
- **Managing learner projects** with updates, collaboration, and cross-club attribution.  
- **Peer support** through the Club of Clubs system.  
- **Quality assurance** via mandatory feedback forms and health metrics.  
- **Safety** through safeguarding tools, parental oversight, and age-appropriate access controls.  
- **Community** through a global feed of project updates that inspires and connects clubs worldwide.

### 1.3 Success Metrics

| Metric | Target (Season 1\) |
| :---- | :---- |
| Active clubs on platform | 100 |
| Active Guides | \~100 |
| Active Learners | \~1,000 |
| Sessions logged per club per season | ≥12 (weekly) |
| Projects created | ≥200 |
| Guide feedback form completion rate | 100% |
| Learner feedback form completion rate | ≥80% |

### 1.4 Timeline

| Milestone | Date |
| :---- | :---- |
| Full v1 launch | May 1, 2026 |
| Test with existing clubs | As early as possible |
| New club season begins | September 1, 2026 |

### 1.5 Theoretical Foundation

The platform is designed around Self-Determination Theory (Deci & Ryan). Every feature decision should reinforce three psychological needs:

- **Autonomy** — Learners choose their own projects, set their own pace, and are never forced to attend.  
- **Relatedness** — Club chat, collaborative projects, team building, and the global feed create connection.  
- **Competence** — Project timelines, progress updates, and celebrations make learning visible and tangible.

The platform enables this by providing structure (sessions, building blocks, feedback loops) without control (no grades, no mandatory curriculum, no imposed outcomes).

---

## *2\. User Roles & Personas*

### 2.1 Key Concept: Roles Are Per-Club, Not Global

A user does not have a single global role. Their role is **contextual to each club they belong to.** The same person can be:

- A **Guide** in Club A.  
- A **Learner** in Club B.  
- A **parent** of another user (account-level relationship, not a club role).

A user can also have an account **without being a member of any club** (e.g., a parent who only monitors their child, or someone in the process of starting a club). The platform must handle this empty state gracefully.

### 2.2 Guide (club role)

A person who facilitates a Curiosity Club. They plan sessions, track attendance, support learners, and connect with peer Guides via their Club of Clubs. Guides are vetted through a peer application process and trained at the start of each season.

### 2.3 Learner (club role)

A person of any age who attends a Curiosity Club and creates projects. There is no age ceiling — while the typical range is youth, adults can also be learners.

### 2.4 Parent (account-level relationship)

A parent or legal guardian linked to one or more users under 16\. The parent has their **own full, independent account** on the platform. The parental relationship is an account setting, not their identity.

**How parent accounts work:**

- The parent creates an account like any other user.  
- In **account settings**, they have a "Linked Children" section.  
- The parent can **"View as \[child's name\]"** to see the platform from their child's perspective — the child's clubs, projects, chats (all read-only). They switch between their own view and each child's view.  
- The parent can independently join clubs as a Learner or Guide.  
- One parent account can be linked to multiple children.

**Parent permissions in "View as Child" mode:** Read-only access to the child's club activity, projects, and all messages sent/received. Can report issues. Cannot edit, post, or chat.

⚠️ **OPEN DESIGN QUESTION:** The full parent experience needs more exploration. See [Section 10.1](#101-parent-experience).

### 2.5 Core Team / Admin (platform role)

The central Curiosity Learning team. Manages the global platform, seasons, Activity Booklet, dispute resolution, and safeguarding escalations. Does not manage individual clubs.

### 2.6 Accounts Without a Club

A user can exist on the platform without being a member of any club. This is an allowed state, though the default onboarding flow (Join/Start a Club) does not explicitly guide users here.

**Use cases:** A parent who only monitors their child. A person in the process of applying to start a club. Someone whose club became dormant.

**What they can access:** Chat (for existing conversations, e.g., join request or application chats), account settings, and the safeguarding report tool. If the user is a linked parent, they can also use **View as Child** (read-only). They **cannot** access the Club Dashboard, Feed tabs (`My Clubs` / `All`) (except through View as Child), profile browsing, or create projects until they join or start a club. A clear prompt to join or start a club should be shown.

### 2.7 Roles NOT in v1

- **Country Coordinators** — out of scope. Absorbed by the Core Team.

---

## *3\. App Structure & Navigation*

### 3.1 The Two Contexts

The app has two distinct contexts that are important for understanding how information flows:

**Club Dashboard (club-specific):**

- The only part of the app that is scoped to a single club.  
- Contains: Sessions, Projects (Current/Showcase tabs), Members list, Club Settings.  
- Has a **club switcher** for users who are members of multiple clubs.  
- Changing the club switcher changes everything visible within the Club Dashboard.

**Everything else (user-specific):**

- **Feed:** One feed experience with two tabs:  
  - **My Clubs** \= aggregated updates from all clubs the user belongs to.  
  - **All** \= globally shared updates from across the platform. This feed is not filtered by the club switcher.  
- **Chat:** Shows ALL chats across all clubs, projects, applications, etc.  
- **Profile, Settings, Notifications:** User-level.

### 3.2 Navigation Structure (Conceptual)

The exact navigation UI is for design to determine, but the conceptual hierarchy is:

- **Club Dashboard** — club-specific views  
  - Sessions  
  - Projects (Current / Showcase)  
  - Members  
  - Settings (Guide only)  
  - Club Switcher  
- **Feed** — two tabs: `My Clubs` and `All`  
- **Chat** — all conversations  
- **Profile / Settings**  
- **Application Reviews** (conditional — appears when review assignments exist, with badge count)

---

## *4\. Platform Requirements*

### 4.1 Platforms

- **v1:** Responsive web application (web-first). Should work well on desktop and mobile browsers.  
- **Future:** Native mobile apps (iOS/Android).  
- **Recommendation:** Evaluate PWA for v1.

### 4.2 Localization

- **v1:** English only.  
- **Architecture:** i18n-ready from day one. All strings externalized. RTL-compatible layout.

### 4.3 Timezones

All times stored in UTC in the database. The application converts to the user's local timezone for display. Session times, RSVP deadlines, attendance locks, and notification scheduling all operate based on the **club's timezone** (derived from the club's location). The user sees times in their local timezone but the business logic (e.g., "lock attendance 12 hours after session ends") uses the club's timezone.

### 4.4 Hosting & Infrastructure

- Budget: \~€100/month.  
- Architected for growth beyond 100 clubs.  
- Real-time capabilities required for chat.

### 4.5 Third-Party Integrations (v1)

| Integration | v1 Status | Notes |
| :---- | :---- | :---- |
| Google Maps / Mapbox | Required | Club discovery map (club-level location pins) |
| Google OAuth | Required | Login option |
| Email service (e.g., SendGrid, Resend) | Required | Transactional emails |
| better-auth | Required | Auth library (username plugin for username-based login) |
| NSFW detection API (e.g., Google Cloud Vision SafeSearch) | Required | Automated screening on all media uploads (pledges, session photos, project updates, application videos). See [Section 6.15.3](#6153-media-content-screening). |
| Video calling | Not integrated | External links for interviews/CoC meetings/onboarding calls |
| Stripe / Payments | Not in v1 | Future |
| Calendar sync | Not in v1 | — |

### 4.6 Admin Dashboard

The Admin Dashboard should be a **separate internal application** (different URL/route, potentially separate frontend build), sharing the same backend/database and auth system. Admin users need profiles in the main system so they can chat with Guides (e.g., for safeguarding follow-up).

⚠️ **OPEN DESIGN QUESTION:** See [Section 10.5](#105-admin-dashboard-architecture).

---

## *5\. Data Model & Ownership*

### 5.1 Ownership Principles

| Entity | Owned By | Notes |
| :---- | :---- | :---- |
| Club | No single owner | All Guides have equal permissions. Clubs cannot be deleted (can be abandoned). |
| Session | Club | Any Guide can create, edit, or cancel future sessions. |
| Activity (in session) | Session | Copied from Booklet or created from scratch; editable per session. |
| Project | Its members (collectively) | No single "owner." All active members have equal rights. |
| Project Update | User who posted it | Immutable to regular users; Core Team can take down via moderation. |
| Chat | System | Auto-created for clubs, projects, join requests, applications. |
| Feedback Form | System / Core Team | Core Team defines; users submit responses. |

### 5.2 Key Architectural Decisions

**Roles are per-club.** A `club_memberships` table stores `user_id`, `club_id`, and `club_role_id` (FK to `club_roles`). Same user can have different roles in different clubs.

**Permissions are data-driven, backend-enforced.** Role permissions are stored in data (not hardcoded in frontend logic). Permission flags are string keys (e.g., `club:view`, `club_details:edit`, `project_members:remove`, `attendance_create_within_time:create`). The backend is the source of truth for authorization; frontend uses permissions only for UI affordances.

**Projects are owned collectively by their members.** The creator has no special privileges beyond being the first member. All active members have equal editing rights.

**Projects are NOT nested under clubs.** They are top-level entities linked to clubs through per-member attribution. Attribution to a club is optional — projects can exist with zero club attribution. A single project can be attributed to multiple clubs at the same time, and each member can attribute the project to multiple clubs they belong to.

**Project participants include non-members.** A `project_participants` table tracks both project members and Guide observers. See [Section 6.6.9](#669-project-participants-data-model).

**Sessions are owned by clubs.** Any Guide can create, edit, or cancel future sessions. Past sessions cannot be cancelled. Cancelled sessions are flagged, not deleted.

**Clubs cannot be deleted.** They can become dormant or abandoned.

**Updates are immutable to users.** Project updates cannot be edited or deleted by members/authors. Core Team can apply moderation takedowns from the Admin Dashboard when required for safety/compliance. System-generated change log entries are also immutable.

**Pending club joins are stored separately.** When a user signs up to join a specific club but hasn't yet completed onboarding (consent \+ pledge), the intended club is stored in a `pending_club_joins` table — not on the user record. This data is only needed during onboarding and is cleaned up once the user is fully onboarded or the account expires.

**Seasons are explicit.** A `seasons` table stores season start/end dates, review window dates, and feedback deadlines. Season-related automations (application distribution, feedback form triggers, enforcement timelines) reference this table.

### 5.3 Club Types & Hierarchy

⚠️ **OPEN DESIGN QUESTION:** The right model for club types and relationships needs more thought. See [Section 10.2](#102-club-types--hierarchy). For v1, the system needs to distinguish at minimum between Curiosity Clubs and Club of Clubs groups, but the mechanism (reference table, hierarchy, etc.) is TBD.

### 5.4 Chat Types

Chat types should use a **`chat_types` reference table** rather than an enum for extensibility. Initial rows:

| Type | Description |
| :---- | :---- |
| `club` | Club-level group chat |
| `project` | Project team chat (includes attributed club Guides) |
| `join_request` | Requester \+ club Guides |
| `club_application` | Applicant \+ interviewer Guides |

Chat permissions should be role-based:

- `chat_participants` includes `chat_role_id` (FK to `chat_roles`).  
- `chat_roles` connect to permission flags (e.g., `chat_message:create`, `chat_action:join_request_accept`, `chat_action:join_request_decline`, `chat_action:application_decide`).  
- Action buttons are shown only when the current user has the required chat permission.

### 5.5 Club Schedule (Structured Data)

A club can meet on multiple days at different times and locations. Recommended: a **`club_schedule_slots` table** (not JSONB) for queryability:

| Column | Type |
| :---- | :---- |
| id | UUID |
| club\_id | FK → clubs |
| day\_of\_week | Enum (mon–sun) |
| start\_time | Time |
| end\_time | Time |
| location | Text (address or description) |

This table is the source of defaults when creating sessions. A club can have multiple rows (e.g., Tuesdays 4–5:30pm at the library, Thursdays 2–3:30pm at the park).

### 5.6 Pending Club Joins

Stores the intended club for users who haven't completed onboarding yet. Separate from user or club tables since this data is transient.

| Column | Type |
| :---- | :---- |
| id | UUID |
| user\_id | FK → users |
| club\_id | FK → clubs |
| created\_at | Timestamp |
| source | Enum (code, map\_request) |

Cleaned up when: (a) user completes onboarding and is added as a club member, or (b) 90-day auto-cleanup fires for unconsented accounts.

### 5.7 Seasons

| Column | Type |
| :---- | :---- |
| id | UUID |
| name | Text (e.g., "Autumn 2026") |
| start\_date | Date |
| end\_date | Date |
| review\_window\_open | Date (3 months before start) |
| review\_window\_close | Date (2 months before start) |
| feedback\_deadline | Date (\~2 weeks after end) |

Season-related automations (application distribution, feedback triggers, enforcement timelines) reference this table.

### 5.8 Project Participants

Tracks both project members and Guide observers in a unified table. See [Section 6.6.9](#669-project-participants-data-model).

| Column | Type |
| :---- | :---- |
| id | UUID |
| project\_id | FK → projects |
| user\_id | FK → users |
| project\_role\_id | FK → project\_roles |
| status | Enum (active, done, left) — for members only |
| club\_id | FK → clubs (nullable) — for guide\_observer: which club's attribution added them |
| added\_by | FK → users (nullable) |
| created\_at | Timestamp |

### 5.9 Permission Model (Role \+ Flags)

Canonical permission flags are stored centrally in a `permission_flags` reference table (or equivalent config). Role-permission mappings are many-to-many:

- `club_roles` \+ `club_role_permissions`  
- `project_roles` \+ `project_role_permissions`  
- `chat_roles` \+ `chat_role_permissions`

Implementation note: storage can be normalized tables (recommended) and optionally materialized as arrays in API responses for fast permission checks/UI rendering.

### 5.10 Global Roles (Admin Scope)

Use `global_roles` only for platform-level capabilities (e.g., Admin/Core Team). Admin permissions are scoped to the Admin platform routes and APIs. They do not grant extra actions inside standard user-facing workflows unless explicitly specified.

### 5.11 Project Member Attribution Links

Use a dedicated join table for per-member multi-club attribution:

| Column | Type |
| :---- | :---- |
| id | UUID |
| project\_id | FK → projects |
| user\_id | FK → users |
| club\_id | FK → clubs |
| created\_at | Timestamp |

Constraint: unique (`project_id`, `user_id`, `club_id`).

### 5.12 Session Attendance Records

Store attendance as a per-session snapshot only when a Guide submits attendance:

| Column | Type |
| :---- | :---- |
| id | UUID |
| session\_id | FK → sessions |
| user\_id | FK → users |
| status | Enum (`present`, `absent`) |
| recorded\_by | FK → users |
| recorded\_at | Timestamp |

If attendance is never submitted, no attendance rows are created for that session.

---

## *6\. Feature Specifications*

### 6.1 Authentication & Onboarding

#### 6.1.1 Authentication Methods

| User Type | Methods |
| :---- | :---- |
| Users 16+ | Email \+ password, Google OAuth, or username. All three can be used to log in. |
| Users under 16 | Username \+ parent's email address during sign-up. Log in with username \+ password. |

**Everyone sets a username/display name during account creation**, regardless of age.

**Technical note:** Using better-auth with the username plugin.

#### 6.1.2 Landing Screen (Unauthenticated)

Three paths:

1. **"Join a Club"** → Enter a club code OR browse the map.  
2. **"Start a Club"** → Begin the Guide application process.  
3. **"I already have an account"** → Login (via email, username, or OAuth).

#### 6.1.3 Join via Club Code (Detailed Flow)

1. User enters a club code on the landing screen.  
2. System validates the code. If invalid: error message.  
3. If valid: **Club Preview screen** — shows club name, description, location, and schedule. No sensitive information.  
4. User taps **"Join this Club."**  
5. System asks for **date of birth.**  
6. Based on age:  
   - **Under 16:** Account creation with username \+ parent's email. → Pending state (see 6.1.6).  
   - **16+:** Account creation with email \+ password or Google OAuth \+ username. → Pledge upload prompt (see 6.1.7).  
7. Once all gates cleared, user is placed directly into the club.

**Security for club codes:**

- Club codes should be **short, memorable** (e.g., 6–8 alphanumeric characters).  
- **Rate limiting** on code entry to prevent brute-force discovery.  
- Codes are **only visible to Guides** of that club.  
- Guides can **reset their club code** at any time (invalidates the old one).  
- Club codes are **not the same as public club links** (see 6.3.3).

#### 6.1.4 Join via Map (Detailed Flow)

1. User taps "Don't have a club code? See clubs near you" on the landing screen.  
2. Map shows pins for all discoverable clubs.  
3. User taps a pin → **Club Preview** (same as above: name, description, location, schedule).  
4. User taps **"Request to Join."**  
5. System asks for **date of birth.**  
6. Based on age, account creation flow as above.  
7. Once account is created (and consent obtained if under 16): a **join request chat** is created between the requester and the club's Guides.  
8. Guides can chat with the requester, then **Accept** or **Decline** via action buttons in the chat.  
9. On acceptance: user is added to the club. If pledge not yet uploaded, pending state applies.

**Key difference from club code:** Code \= instant join. Map \= request \+ chat \+ Guide decision.

#### 6.1.5 Guide Sign-Up Flow (Start a Club)

1. User selects "Start a Club."  
2. System asks for **date of birth.**  
3. Based on age, account creation flow.  
4. If under 16: parental consent is obtained first (see 6.1.6). **Application is held in "waiting for consent" state and is NOT sent for review until the parent approves.**  
5. Once account is active: user fills out the Guide application form (see [Section 6.9](#69-guide-application--peer-review)).  
6. Application goes through peer review → interview → acceptance.  
7. On acceptance (after successful interview): pledge upload prompt, club is created, and the new club is auto-assigned to Club of Clubs.

#### 6.1.6 Under-16 Flow (Parental Consent \+ Pledge)

Users under 16 must clear two gates. Both result in a "pending" state. **Parental consent must happen before pledge upload.**

**Pending state UX:**

- The user sees a clear screen showing their progress through the two steps.  
- Step 1: "Waiting for parent approval" — shows status (email sent to [parent@email.com](mailto:parent@email.com), resend option).  
- Step 2: "Upload your pledge" — unlocked only after Step 1 is complete.  
- Until both steps are done: the user **cannot access any platform features**. No club dashboard, no Feed tabs, no chat, no project visibility. The pending screen is the only thing they see.

**The user is NOT a club member while pending.** The intended club is stored in the `pending_club_joins` table (see [Section 5.6](#56-pending-club-joins)), not as a club membership. The membership is created only after both gates are cleared.

**The pending state is user-level, not club-level.** If a user has already completed both steps for a previous club, they do NOT need to repeat them when joining a new club.

**90-day auto-cleanup:** If parental consent is never obtained within 90 days, the account and all associated data (including the `pending_club_joins` record) are automatically purged. This ensures GDPR compliance — minimal data is stored, and only for the purpose of facilitating the consent flow.

**Parent consent flow:**

1. System sends consent email to the parent.  
2. Parent clicks link and approves the child.  
3. Child's Step 1 is marked complete immediately on approval (parent account creation is not required).  
4. Parent is offered an optional account creation step using the same email (can skip).  
5. If parent returns later, they can reclaim/access that parent account via standard forgot-password flow on the same email.  
6. If an old consent link is expired, parent is routed to a "resend secure access link" flow tied to that email.  
7. v1 uses self-attestation for parent eligibility (checkbox: legal guardian and 18+). No hard age verification in v1.

#### 6.1.7 Pledge Upload (All Users)

- All users must upload a handwritten pledge of the Guiding Principles.  
- **Pledge is user-level:** uploaded once, applies across all clubs.  
- Until uploaded, user is in pending state (see above for under-16; for 16+, the pledge is the only gate).  
- Pledge upload unlocks full platform access.

#### 6.1.8 Adding a Guide to an Existing Club

- Any current Guide can invite a new person directly — no application process needed.  
- New Guide must upload pledge (if not already done).  
- Recommended (not required for v1) to attend next Guide Training Experience. Not a blocker — existing Guides will support and train them.  
- Automatically joins the club's Club of Clubs group.

#### 6.1.9 Promoting and Demoting

**Promote Learner to Guide:**

- Any Guide can instantly promote a Learner to Guide within their club.  
- No application needed. Role changes for that club only.

**Demote Guide to Learner (self-demotion only):**

- A Guide can demote **themselves** to Learner in a club.  
- Guides cannot demote other Guides (just as they can't kick them).  
- If the Guide is the last Guide in the club, self-demotion is blocked (same rules as leaving — must promote a Learner first).

#### 6.1.10 Age Transition (Turning 16\)

- Restrictions auto-lift.  
- User gains option to unlink parent account.  
- Parent loses "View as Child" access once unlinked.

#### 6.1.11 Password Reset

**Users 16+ (email on account):**

- Standard "Forgot password" → reset link sent to their email.

**Users under 16 (no email on account — username \+ parent's email):**

- User taps "Forgot password."  
- System sends a **6-digit reset code** to the linked parent's email address.  
- Parent relays the code to the child (e.g., reads it over the phone).  
- Child enters the code on the reset screen → sets a new password.  
- **Code expiry:** 15 minutes.  
- **Rate limiting:** 3 failed attempts → 30-minute lockout.  
- Resend option available (generates a new code, invalidates the old one).

---

### 6.2 Club Creation & Management

#### 6.2.1 Creating a Club

When a Guide application is accepted, a club is created:

| Field | Type | Required | Notes |
| :---- | :---- | :---- | :---- |
| Club name | Text | Yes | Max 50 characters. |
| Location | Address / Map pin | Yes | Geocoded address for discovery map. This is the club's primary location. |
| Schedule | Structured (see 5.5) | Yes | One or more day \+ start time \+ end time \+ location entries. |
| Description | Text | Yes | Shown on club preview. Max 2,000 characters. |
| Discoverable | Toggle | Yes | Default TBD. |

A unique **club code** is auto-generated.

**Note:** No age-range field in v1. Age-based restrictions follow the user, not the club (see [Section 8](#8-safety--compliance)). Guides can mention any age preferences in their club description.

#### 6.2.2 Club Settings

All Guides have equal permissions. No owner or lead Guide. No confirmation required from other Guides for any action — Guides are trusted. If problems emerge at scale, governance can be revisited.

#### 6.2.3 Leaving a Club & Dormancy

**If the Guide is NOT the last Guide:**

- Leave freely.

**If the Guide IS the last Guide AND Learners exist:**

- Must promote a Learner to Guide before leaving. System blocks leaving until done.

**If the Guide IS the last Guide AND no Learners:**

- Warning: "This club will be abandoned. Are you sure?"  
- On confirmation: club is marked as **abandoned**.

**To close a club entirely:** Last Guide removes all Learners (with kick reasons), then leaves. Club becomes abandoned.

**Abandoned state:**

- Club is flagged in Admin Dashboard and visible to the Club of Clubs group.  
- **No one can join an abandoned club** (code is invalidated, club removed from map).  
- The CoC group can attempt to revive (find new local Guides) or formally close it.

⚠️ **OPEN DESIGN QUESTION:** What exactly does revival look like? Can the Core Team re-activate an abandoned club and assign new Guides? Does the club's history (sessions, projects) persist? See [Section 10.3](#103-club-dormancyabandonment).

#### 6.2.4 Club Membership

- Users can be members of multiple clubs with different roles in each.  
- A Guide is always a member of at least: their Curiosity Club(s) \+ their Club of Clubs.

#### 6.2.5 Kicking Members

- Guides CAN kick Learners. **Kick reason required** (text field, max 500 characters, stored).  
- Kicked user receives a **notification** (in-app \+ email) stating they've been removed from the club. They immediately lose access to the club.  
- **No appeal process** in v1. The kicked user can contact the Core Team via the Report Issue tool if they believe the removal was unjust.  
- Guides CANNOT kick or demote other Guides. Disputes escalate via Report Issue.

#### 6.2.6 Branding

Clubs must follow brand guidelines (provided separately). Platform doesn't manage branding in v1. Future: Resources section with downloadable templates.

---

### 6.3 Club Discovery & Joining

#### 6.3.1 Join via Club Code

- Instant join, no approval.  
- Works for both discoverable and non-discoverable clubs.  
- After joining, user goes through applicable onboarding gates.

#### 6.3.2 Join via Map (Discoverable Clubs Only)

- Map shows pins for discoverable clubs.  
- Tap pin → Club Preview → "Request to Join" → join request chat → Guide Accept/Decline.

#### 6.3.3 Club Codes vs. Public Club Links

These are two different things:

|  | Club Code | Public Club Link |
| :---- | :---- | :---- |
| **Purpose** | Direct entry to club (instant join) | View-only club preview |
| **Who sees it** | Guides only (shared privately with intended joiners) | Anyone with the link |
| **Joining behavior** | Instant join | Shows club preview (same as tapping pin on map). User goes through the join request chat flow. |
| **Changes** | Guides can reset code at any time | Permanent URL (does not change) |
| **Available for** | All clubs | Discoverable clubs only. Non-discoverable clubs do NOT have a public page. |

#### 6.3.4 Cancelling a Join Request or Application

- Users can **cancel** a pending join request or club application at any time.  
- Cancellation closes the associated chat (join\_request or club\_application).  
- The user returns to the no-club state (or their existing clubs if they have others).

**No-club state:** A user who has created an account but is not yet in any club has limited access: they can see the chat section (for any active join request / application chats), account settings, and the report tool. If they are a linked parent, they can also use read-only View as Child. They cannot access the Club Dashboard, Feed tabs (`My Clubs` / `All`) (except through View as Child), profile browsing, or create projects. A clear prompt to join or start a club should be shown.

#### 6.3.5 Discoverable vs. Non-Discoverable

|  | Discoverable \= True | Discoverable \= False |
| :---- | :---- | :---- |
| Visible on map | Yes | No |
| Has public club link | Yes | No |
| Join via code | Yes (instant) | Yes (instant) |
| Join via request | Yes (chat \+ Accept/Decline) | Not possible |

---

### 6.4 Sessions & Attendance

#### 6.4.1 Creating a Session

Any Guide can create a session.

| Field | Type | Required | Notes |
| :---- | :---- | :---- | :---- |
| Date | Date picker | Yes | Smart default: next occurrence of club schedule day after last planned session. |
| Start time | Time picker | Yes | Default from club schedule. |
| End time | Time picker | Yes | Default from club schedule. |
| Location | Text (plain) | Yes | Default from club schedule slot. Can be a physical address, a description (e.g., "Building A Room 301"), or a meeting URL (e.g., Zoom/Google Meet link). Frontend auto-detects URLs and renders as clickable links. |
| Description | Text | No | Optional notes. Max 1,000 characters. |
| Activities | Ordered list | No | From Booklet or created from scratch. Drag-and-drop reordering. |

Sessions are owned by the club. Any Guide can edit or **cancel future sessions.** **Past sessions cannot be cancelled.**

**Note on location types:** The club's primary **Club Location** (in club settings) is a map pin / geocoded address used for the discovery map. The per-session **Location** field is a plain text field that defaults from the club schedule but can be anything — a street address, a room number, or a video call URL.

#### 6.4.2 Session Photos

- Guides can upload **up to 4 photos** per session.  
- Photos can be uploaded **during the session or up to 12 hours after the session ends.**  
- After 12 hours, photo upload locks.  
- Photos appear on the session detail view.

#### 6.4.3 Session Cancellation

- Any Guide can **cancel** a future session. Cancellation sets a `cancelled` flag — the session record is preserved in the database, not deleted.  
- Cancelled sessions are **hidden from the session list** in v1. (Future: show as greyed out / struck through.)  
- **Notification:** All members who RSVP'd "Going" receive a notification that the session has been cancelled.  
- Past sessions cannot be cancelled.

#### 6.4.4 RSVP System

RSVP is **optional and opt-in.** When a session is created:

- No one has any RSVP status by default.  
- Members can mark themselves as **"Going"** or **"Not Going"** at their discretion.  
- Not marking any RSVP \= unknown / no response.  
- **RSVP locks when the session start time passes.** Members cannot change their RSVP after the session has started.

#### 6.4.5 Attendance Tracking

Attendance is a separate step from RSVP, recorded by a Guide.

**How it works:**

1. Guide opens the attendance view for a session.  
2. They see a list of members **who were in the club at the time of that session** (not current members — someone who joined today doesn't appear on last week's sheet).  
3. Each member shows their RSVP status as a **visual indicator** (Going / Not Going / No response), but **attendance is NOT pre-filled from RSVP.** Guide marks from scratch.  
4. Guide marks attendance for everyone in the session roster snapshot: each person is either `present` or `absent`.

**Timing rule:**

- Attendance can only be marked **after the session start time**.

**Locking:**

- Attendance is editable until **12 hours after the session ends.** Then it locks.  
- If attendance is still unmarked 1 hour after session start, a notification is sent to all Guides in that club.  
- If unmarked by lock time, **it stays blank** — no assumptions made from RSVP. This ensures the data is clean: blank means "Guide didn't record," not "nobody came."

**Storage rule:**

- When attendance is submitted, the system writes one row per roster member at session time (`present` or `absent`).  
- If attendance is never submitted, no attendance rows are created for that session.

---

### 6.5 Activity Booklet

#### 6.5.1 Activity Fields

| Field | Type | Notes |
| :---- | :---- | :---- |
| Title | Text | — |
| Content | Rich text (Markdown) | Description, instructions, materials. |
| Building Block | FK → Building Block type | Team Building, Get Curious, Plan Projects, Work on Projects, Share Experiences, Mini Projects. |
| Duration | Number (minutes) | Estimated time. |

#### 6.5.2 v1 Behavior

- **Read-only for Guides.** Core Team curates and manages via Admin Dashboard.  
- Guides browse (search \+ filter by Building Block type) and add to sessions.  
- Adding creates a copy (fork) that the Guide can customize.  
- **Guides can also create activities from scratch** directly within a session, without using the booklet.

#### 6.5.3 Future

Guides submit, branch/fork, comment, rate activities. Collaborative resource library.

---

### 6.6 Projects & Attribution

#### 6.6.1 Core Principles

- **Collectively owned:** All active members have equal rights. No single "owner."  
- **Trust by default:** Within a project team, no approval needed for edits or changes. Joining a project requires invitation acceptance or join request approval (see 6.6.10).  
- **Transparency:** Key changes logged in project timeline.  
- **Immutable updates:** User-posted updates cannot be edited or deleted. Change log entries are also immutable.  
- **Long-term recognition:** Projects persist forever.

#### 6.6.2 Creating a Project

Any Learner or Guide can create a project.

| Field | Type | Required | Notes |
| :---- | :---- | :---- | :---- |
| Name | Text | Yes | Max 50 characters. |
| Cover image | Image upload | No | Can be added or edited later by any active member. |
| Deadline | Date | Yes | Visual indicator only when passed — no lock. |
| Description | Text | Yes | Max 500 characters. |
| Team members | User picker | No | Invite other users to collaborate. Invitees receive a notification with Accept / Decline. |
| Club attribution | Club picker | No | See 6.6.6. Defaults smartly but not required. |
| Visibility | Toggle | Yes | "Club(s) only" or "Share Globally." Default: TBD. |

**Club attribution defaults:**

- If creating from within a Club Dashboard context → defaults to that club.  
- If in only one club → defaults to that club.  
- If in multiple clubs and no context → user selects (or leaves blank).

**When team members are added:** If the added member is in the same club as the creator and the creator has attributed the project to that club, the new member's attribution defaults to the same club. If they're in a different club or multiple clubs, they're prompted to choose (or leave blank).

#### 6.6.3 Cover Image

- Any active project member can add or change the cover image.  
- When the cover image changes, a **change log entry** is created in the project timeline showing the new image (not the old one).  
- The cover image appears at the top of the project page and in project cards on feeds/club views.

#### 6.6.4 Project Member Status

| Status | Can Edit Metadata | Can Post Updates | Can Change Attribution | Can Chat | Still Credited |
| :---- | :---- | :---- | :---- | :---- | :---- |
| **Active** | Yes | Yes | Yes | Yes | Yes |
| **Done** | No | No | No | Yes | Yes |
| **Left** | No | No | No | No | No |

- **"I'm Done"** is per-member. Includes a clear explanation before confirmation. A Done member remains credited and stays in the project chat. This is permanent — cannot be undone.  
- **"Leave Project"** is a separate action. The user is fully removed: no longer credited, removed from project chat, removed from the team list. Unlike "Done," a user who left **can rejoin** (via re-invitation or new join request).  
- **Members cannot be removed by other members.** Both "I'm Done" and "Leave Project" are self-actions only. If a member is unresponsive and blocking project progress, this can be reported to the Core Team. As a practical workaround, a Guide can remove the user from the club, which affects the project's Current/Showcase placement (see 6.6.7).  
- A change log entry is created for all status changes: "X marked themselves as Done" / "X left the project."

#### 6.6.5 Project Archiving

- Archived \= all members are Done.  
- The only special behavior triggered specifically at archival (not per-member "Done") is: **project chat closes permanently.**  
- All other read-only restrictions are already applied per-member when each person presses "Done."

#### 6.6.6 Club Attribution Model (Per-Member, Optional)

Attribution is optional. Projects can exist with zero club attribution.

**Linking:**

- While Active, a member can link the project to any club they're currently a member of.  
- A single member can link the same project to multiple clubs they belong to.  
- A single project can therefore be attributed to multiple clubs simultaneously.

**Unlinking ("Last Person Out" rule):**

- While Active, a member can unlink their attribution to a club.  
- A project remains visible in a club as long as ≥1 project member has that club linked.  
- Project disappears from a club when the last member removes their link.

**Leaving a club:**

- Existing attribution links are NOT auto-removed.  
- If Active: can change attribution (link other clubs, unlink old ones).  
- If Done: cannot change attribution.  
- Cannot re-link a club you've left (linking requires current membership).

**Archiving:** All attribution links frozen.

#### 6.6.7 Club Dashboard Project Tabs

Two tabs, derived from attribution and membership data:

**Current:**

- Project attributed to this club AND ≥1 Active project member is currently a club member.  
- *"Work actively happening here."*

**Showcase:**

- Project attributed to this club AND EITHER globally Archived OR zero Active members currently in this club.  
- *"Part of this club's history — completed or no longer being actively worked on here."*

#### 6.6.8 Editing & Change Logging

Active members can edit: Name, Deadline, Description, Cover Image, Visibility, Attribution.

Every change creates an **immutable log entry** in the project timeline: who changed it, what field, new value (and prior value if feasible).

Log entries use the same visual treatment as user-posted updates in v1, with only an actor label (e.g., "System") to indicate source.

#### 6.6.9 Project Participants Data Model

The `project_participants` table (see [Section 5.8](#58-project-participants)) uses `project_role_id` linked to `project_roles`. Initial role set:

| Role | Shown in team UI? | Can edit/post? | In project chat? | How added? |
| :---- | :---- | :---- | :---- | :---- |
| `learner_member` | Yes | Yes (if Active) | Yes | Invitation, join request, or project creation |
| `guide_member` | Yes | Yes (if Active) | Yes | Invitation, join request, or project creation |
| `guide_observer` | No | No | Yes | Auto-added when a club is attributed to the project |

**Guide observers (`guide_observer`):**

- All Guides from every club the project is attributed to are auto-added as `guide_observer` participants.  
- They appear in the project chat but NOT in the project team list on the UI.  
- If a new club is attributed: its Guides are added. If a club is un-attributed: its Guides are removed (unless they are also a `learner_member` or `guide_member`).  
- Gives Guides visibility into projects happening in their club without cluttering the team.

#### 6.6.10 Project Invitation & Join Request Model

**Inviting members:**

- Any Active project member can invite any user on the platform.  
- The invitee receives a **notification with Accept / Decline** options (not a chat — lightweight).  
- On Accept: user is added as an Active member. Change log entry: "X was invited by Y."  
- On Decline: notification dismissed. No record needed.

**Requesting to join:**

- Any user who can **view** a project can request to join.  
- Visibility governs who can request: "Club(s) only" projects are viewable (and requestable) only by members of the attributed clubs. "Share Globally" projects are viewable by all authenticated users.  
- Any Active project member can Accept or Decline the request via notification.  
- On Accept: user is added as an Active member. Change log entry: "X joined the project."  
- On Decline: requester is notified. No further action.

#### 6.6.11 Project Visibility Change

When a project's visibility changes from "Share Globally" to "Club(s) only":

- Existing comments from users outside the attributed clubs **persist.** They are not deleted or hidden.  
- Users outside attributed clubs can no longer view the project or add new comments.

---

### 6.7 Project Updates & Feed

#### 6.7.1 Project Updates

Posted by Active project members.

**Format:**

- Text content (required). Max 1,000 characters.  
- Optional media: **photo or video, max 4 per update.** No other file types in v1.  
- Supported image formats: JPG, PNG, WebP. Supported video formats: MP4, MOV. Max video duration: 2 minutes (enforced on upload).  
- All media is compressed on upload (see [Section 11.6](#116-media-handling)).

Updates are **immutable for regular users** — authors and members cannot edit or delete them. Core Team can take down updates via the Admin moderation flow when necessary.

Updates appear chronologically alongside change log entries.

#### 6.7.2 Feed Tab: My Clubs

An aggregated feed showing project updates from **all clubs the user is a part of.** This is a user-level view — it is NOT filtered by the club switcher and does NOT live inside the Club Dashboard.

#### 6.7.3 Feed Tab: All

Shows project updates from all projects set to "Share Globally."

**Interactions:**

- **Comments:** Any authenticated user with at least one club membership can comment. Max 1,000 characters.  
- **No likes.** Intentional design decision.  
- **View project details** from the feed.

#### 6.7.4 Comment Moderation (v1)

- **Anyone** can report a comment via the Report Issue tool.  
- Reports go to the Core Team for review.  
- **v1: No hide feature.** Project members cannot hide comments themselves. This is deferred to a future release.  
- Core Team can take down comments from the Admin moderation queue.

**Future:** Project members (and potentially Guides of attributed clubs) can hide comments on their projects. Behavior of hidden comments (fully invisible vs. collapsed "View anyway?") is TBD. See [Section 10.4](#104-comment-moderation-future).

---

### 6.8 Chat & Messaging

#### 6.8.1 Architecture

Chat uses a `chat_types` reference table and a `resource_id`.

| Chat Type | Participants | Created When | Closed When |
| :---- | :---- | :---- | :---- |
| `club` | All club members | Club is created | Never |
| `project` | All project members \+ all Guides from all attributed clubs | Project is created | Project is Archived |
| `join_request` | Requester \+ club Guides | Join request from map | Optionally archived after decision |
| `club_application` | Applicant \+ assigned interviewers | Application reaches interview stage | After decision |

**Project chat includes Guides from attributed clubs:** All Guides from every club the project is attributed to are added to the project chat as `guide_observer` participants (see [Section 6.6.9](#669-project-participants-data-model)). They appear in the chat but NOT in the project team list. If attribution to a new club is added, Guides from that club are added to the chat. If un-attributed, they are removed (unless they are also a project member).

⚠️ **OPEN DESIGN QUESTION:** Should project chat be visible to any user if the project is globally shared? See [Section 10.7](#107-public-project-chat).

#### 6.8.2 Chat Action Buttons

Some chat types need context-specific action buttons:

- `join_request`: **Accept** / **Decline** buttons visible to Guides.  
- `club_application`: Scheduling actions, decision buttons.

Authorization for these buttons is role-permission based (`chat_roles` \+ permission flags); frontend displays actions only when backend-evaluated permissions allow it.

#### 6.8.3 Chat Behavior

- Messages support text only in v1. Media in chat is nice-to-have for future.  
- Max message length: **1,000 characters.**  
- URLs in messages are auto-detected and rendered as **clickable links** (`<a>` tags). No link previews in v1.  
- @mentions: **Not in v1.** Future feature.  
- Real-time (Convex reactive queries).  
- Persistent, scrollable history.

#### 6.8.4 Project Chat Rules

- **Active members \+ attributed Guides:** Can send/receive.  
- **Done members (project not Archived):** Can still send/receive.  
- **Archived project:** Chat closes permanently. History viewable.

#### 6.8.5 Chat on Removal/Leaving

- Removed/left user: can view history, cannot send. Banner: "You are no longer part of this chat."  
- Their messages remain visible.

#### 6.8.6 Safety

- No adult-to-minor DMs (future — DMs not in v1).  
- Parents can view all child's messages via "View as Child."  
- Report Issue tool available on all messages.

---

### 6.9 Guide Application & Peer Review

#### 6.9.1 Application Form

| Field | Type | Notes |
| :---- | :---- | :---- |
| Club name | Text (max 50 chars) | — |
| Club location | Address / Map pin | — |
| Why \+ relevant experience | Long text (max 5,000 chars) | — |
| Video (max 2 minutes) | Upload or YouTube URL | Made specifically for this application. Duration enforced: uploaded videos checked on upload; YouTube links checked via API. |

#### 6.9.2 Application Pipeline

```
[Parental Consent if under 16] → Submitted → In Review → Interview → Accepted / Rejected
```

**Applications are always open.** There is no window where applications "close." However, **reviews happen in scheduled 1-month windows:**

1. Applications submitted before the review window opens wait in queue.  
2. When the review window opens (3 months before season start), all queued applications are distributed to existing Guides for peer review.  
3. Applications submitted during the review window are distributed on a rolling basis.  
4. The review window closes 2 months before season start. Applications submitted after the window closes roll into the next season's review cycle.

**Review process:**

- System auto-assigns to multiple Guides (\~10 reviews per Guide per season).  
- Reviewers score alignment with Guiding Principles and safety.  
- Discrepancy flagging: wide score variance → Core Team intervention.

**Interview:**

- If approved in review: assigned to Guides for interview (\~3 per Guide per season).  
- `club_application` chat created for scheduling. Interview via external video call.  
- Final acceptance happens after interview completion.  
- Rejection can happen for no-shows, failure to schedule, or failed interview outcome.

**Rejection:**

- The applicant receives a **chat message** in their `club_application` chat informing them of the rejection.  
- The reviewing Guide can optionally include a **personal message** with the rejection.  
- No reapply cooldown in v1 — rejected applicants can apply again in the next review cycle.

**Acceptance (final):** Club creation, pledge prompt, CoC assignment, enrollment in Guide Training Experience.

**Mandatory onboarding call (post-acceptance):**

- After acceptance, the new Guide must schedule and attend an **onboarding call** with an existing Guide before their club is activated.  
- Scheduling happens via the `club_application` chat. The call itself takes place on an **external platform** (video call link shared in chat).  
- **No-show or failure to schedule** \= Admin follow-up flag and potential suspension decision by Core Team (case-by-case).  
- This ensures new Guides are genuinely committed and have personal contact with the community before launching.

#### 6.9.3 Capacity Management

- Max applications per season based on active Guide count. Formula configurable by Core Team.  
- When cap is reached: **users cannot apply.** They can leave their email to be notified when the next review cycle opens.

#### 6.9.4 Every New Club Requires an Application

Every new club goes through the full application process, even if the applicant is already an accepted Guide running another club.

⚠️ **OPEN DESIGN QUESTION:** If a Guide runs two clubs, should they be in two different Club of Clubs groups? See [Section 10.8](#108-multi-club-guides-and-club-of-clubs).

---

### 6.10 Club of Clubs

⚠️ **OPEN DESIGN QUESTION:** The Club of Clubs model needs more thought. See [Section 10.2](#102-club-types--hierarchy) for the broader club hierarchy question.

#### 6.10.1 Current Concept

Functions like a regular club for Guides. Has chat, sessions, projects, attendance. Each Guide's "project" in the CoC is the Curiosity Club they're building.

#### 6.10.2 Group Assignment

- \~10 clubs per group. Timezone ±3 hours \+ diversity of origin.  
- Permanent unless dormancy/removal.

#### 6.10.3 Member Clubs Summary View

Proposed: read-only cards showing each member's club health (attendance, sessions, projects, last activity).

---

### 6.11 Quarterly Feedback Forms

#### 6.11.1 Overview

End-of-season mandatory feedback. Primary quality assurance mechanism.

#### 6.11.2 Form Infrastructure

| Table | Fields |
| :---- | :---- |
| `forms` | id, title, type (guide/learner), season\_id, schema (JSONB) |
| `form_responses` | id, form\_id, user\_id, club\_id, answers (JSONB), submitted\_at |

**Per-user per-club:** A user who is a Guide in Club A and a Learner in Club B submits two forms. The `club_id` tracks which club each form relates to.

#### 6.11.3 Graduated Enforcement

| Phase | Timing | Behavior |
| :---- | :---- | :---- |
| Reminder | Days 1–7 after deadline | Persistent banner: "Your feedback for \[Club Name\] is due." |
| Escalation | Days 8–14 | Banner \+ popup modal on every app open. |
| Block | Day 15+ | Platform access blocked until all forms submitted. |

**Exception:** Safeguarding "Report Issue" tool always accessible.

#### 6.11.4 Quality Control

Scores below 7/10 trigger: flag to CoC \+ Core Team → warning → improvement plan with peer group → Core Team intervention if unresolved after second season.

#### 6.11.5 Form Content

Questions designed separately. Platform provides infrastructure.

⚠️ **OPEN DESIGN QUESTION:** Do Guides see aggregated results for their club? Can Guides add custom questions? See [Section 10.9](#109-feedback-form-guide-access).

---

### 6.12 User Profiles

#### 6.12.1 Profile Content

| Field | Notes |
| :---- | :---- |
| Username / display name | — |
| Clubs they're active in | With role per club. |
| Projects | Shown as **Current** (active) and **Showcase** (done/archived). |
| Project updates | Chronological feed. |

#### 6.12.2 Visibility

- Profiles visible to all authenticated users (not public internet).  
- Globally shared projects visible to everyone.  
- Club-only projects visible only to clubmates, with a **visual indicator** (e.g., lock icon or eye-slash icon) noting: "Visible because you're in the same club."

---

### 6.13 Notifications

#### 6.13.1 Delivery Channels

| Channel | v1 | Future |
| :---- | :---- | :---- |
| In-app | Yes (all) | — |
| Email | Yes (critical \+ high) | — |
| Push | No | Yes (mobile) |

#### 6.13.2 Notification Tiers

**Critical (always sent, not mutable):**

| Event | Recipient |
| :---- | :---- |
| Safeguarding report filed | Core Team |
| Application status change | Applicant |
| Account suspension / feedback enforcement | Affected user |
| Kicked from club | Kicked user (in-app \+ email) |
| Parental consent request | Parent (email) |

**High Priority (default on, user can mute):**

| Event | Recipient | Notes |
| :---- | :---- | :---- |
| Session reminder (24hrs before) | Club members | — |
| New chat messages (aggregated) | Participants | Digest email if user inactive — see 6.13.3 |
| Feedback form due | Users | 1 week \+ 3 days \+ day of deadline |
| Quality flag | Guides \+ CoC | — |
| Attendance reminder | All Guides in the club | Sent 1 hour after session start only if attendance is still unmarked |
| Session cancelled | Members who RSVP'd "Going" | — |
| Project invitation | Invitee | Accept / Decline action |
| Project join request | Active project members | Accept / Decline action |

**Medium Priority (default on, user can mute):**

| Event | Recipient | Notes |
| :---- | :---- | :---- |
| New project update | Project members | Fires once per update, even if user is also a club member |
| New project update (for non-project-member club members) | Club members who are NOT project members | Only if project is in Current tab for that club |
| New member joined | Club's Guides | — |

**Low Priority (default off, opt-in):**

| Event | Recipient |
| :---- | :---- |
| Trending/featured global projects | All users |
| New activity in booklet | All Guides |

**Application reviews:** No per-application notification. Instead, when review assignments exist, a **badge appears on the Application Reviews nav item** showing count of outstanding reviews.

#### 6.13.3 Chat Email Notifications

Per-message emails would be overwhelming. For v1: keep it simple. If aggregated digests are too complex, a per-message email is acceptable with a plan to improve.

---

### 6.14 Admin Dashboard

Separate internal application, shared backend. See [Section 4.6](#46-admin-dashboard) and [Section 10.5](#105-admin-dashboard-architecture).

#### 6.14.1 Overview Cards

- Active clubs / Guides / Learners (with trend).  
- Pending applications.  
- Active safeguarding alerts.  
- Feedback completion status.

#### 6.14.2 Clubs Health

Sortable table: name, location, attendance rate, sessions run, active projects, last session date, quality rating, status (active/abandoned). Filters: country, CoC group, season. Flags: low quality, inactive, abandoned, new clubs with no sessions.

#### 6.14.3 Applications Pipeline

Submitted → In Review → Interview → Accepted/Rejected. Counts, timing, discrepancy flags. Cap configuration.

#### 6.14.4 Content Moderation Queue

Safeguarding reports and reported content queue with explicit actions: review, dismiss, take down content, suspend user, escalate. All moderation actions are handled in Admin Dashboard.

#### 6.14.5 Season Management

Season dates are stored in the `seasons` table (see [Section 5.7](#57-seasons)). The Core Team creates/edits seasons via the Admin Dashboard.

| Event | Timing |
| :---- | :---- |
| Application review window opens | 3 months before season start |
| Application review window closes | 2 months before season start |
| Season start | Fixed date |
| Guide Training Experience | First weekend after season start (external for v1) |
| Feedback form opens | End of season |
| Feedback deadline | \~2 weeks after end |
| Graduated enforcement | After deadline |

**Season transitions:** Seasons primarily affect **new clubs and applications.** Existing clubs carry over between seasons — memberships, projects, and history persist. Nothing resets at season boundaries.

#### 6.14.6 Activity Booklet Management

Create, edit, delete activities. Organize by Building Block.

#### 6.14.7 User Management

Search, view, suspend/remove users. Override club settings.

---

### 6.15 Safeguarding & Reporting

#### 6.15.1 "Report Issue" Tool

Available on: all chat messages, project updates, comments, user profiles, club pages.

**Always accessible** — even when blocked for overdue feedback.

#### 6.15.2 Report Flow

1. Select category (safeguarding, inappropriate content, other).  
2. Optional description.  
3. Immediate Core Team alert.  
4. Core Team reviews in moderation queue.  
5. Core Team can take down projects, updates, and comments from the Admin Dashboard when needed.

#### 6.15.3 Media Content Screening

All media uploads are screened for inappropriate content before being stored:

- **Automated NSFW detection** via API (e.g., Google Cloud Vision SafeSearch or AWS Rekognition) on all image and video uploads.  
- Applies to: pledge uploads, session photos, project update media, application videos, and cover images.  
- **If flagged:** Upload is blocked. User sees a generic message: "This image/video could not be uploaded. If you believe this is an error, please try a different file."  
- **If borderline:** Upload proceeds but is flagged for Core Team review in the moderation queue.  
- Cost: \~$0.001 per image. Minimal at v1 scale.

**File type validation:** Only accepted formats are allowed (JPG, PNG, WebP for images; MP4, MOV for video). MIME type checked server-side, not just file extension.

#### 6.15.4 Guide Safeguarding

⚠️ **OPEN:** Background check process not finalized internally. See [Section 10.10](#1010-background-check-process).

---

### 6.16 Search

Contextual — no single global search bar.

| Screen | Searchable Content |
| :---- | :---- |
| Feed (All tab) | Projects by name, description, update content |
| Feed (My Clubs tab) | Same as All tab but filtered to user's clubs |
| Club sessions | By date, description, activity name |
| Club projects | By name, description, member |
| Activity Booklet | By title, Building Block type |
| Chat | Within conversations |

---

## *7\. Permissions Matrix*

Note: "Guide" and "Learner" refer to the user's role **in the specific club context.** This matrix is a product-facing summary; authorization is enforced from role permission flags in data (Section 5.9).

| Action | Guide | Learner | Parent (own account \+ View as Child) | Admin |
| :---- | :---- | :---- | :---- | :---- |
| **Club Management** |  |  |  |  |
| Edit club settings | ✅ | ❌ | ❌ | ✅ |
| Create sessions | ✅ | ❌ | ❌ | ✅ |
| Edit any session | ✅ | ❌ | ❌ | ✅ |
| Cancel future sessions | ✅ | ❌ | ❌ | ✅ |
| Upload session photos | ✅ | ❌ | ❌ | ✅ |
| Mark attendance | ✅ | ❌ | ❌ | ✅ |
| Add members | ✅ | ❌ | ❌ | ✅ |
| Kick Learners (with reason) | ✅ | ❌ | ❌ | ✅ |
| Kick Guides | ❌ | ❌ | ❌ | ✅ |
| Accept/decline join requests | ✅ | ❌ | ❌ | ✅ |
| Promote Learner to Guide | ✅ | ❌ | ❌ | ✅ |
| Self-demote (Guide → Learner) | ✅ | — | ❌ | — |
| Reset club code | ✅ | ❌ | ❌ | ✅ |
| **Sessions** |  |  |  |  |
| View sessions | ✅ | ✅ | ✅ | ✅ |
| RSVP (Going / Not Going) | ✅ | ✅ | ❌ | ❌ |
| **Projects** |  |  |  |  |
| Create project | ✅ | ✅ | ❌ | ✅ |
| Edit metadata (if member is Active) | ✅ | ✅ | ❌ | ✅ |
| Edit cover image (if member is Active) | ✅ | ✅ | ❌ | ✅ |
| Post updates (if member is Active) | ✅ | ✅ | ❌ | ✅ |
| Change own attribution (if Active) | ✅ | ✅ | ❌ | ✅ |
| Toggle visibility (if Active) | ✅ | ✅ | ❌ | ✅ |
| Press "I'm Done" | ✅ | ✅ | ❌ | ❌ |
| Leave project | ✅ | ✅ | ❌ | ❌ |
| Invite to project (if Active member) | ✅ | ✅ | ❌ | ✅ |
| Request to join project (if can view) | ✅ | ✅ | ❌ | ❌ |
| Accept/decline project join requests | ✅ (if Active member) | ✅ (if Active member) | ❌ | ✅ |
| **Chat** |  |  |  |  |
| Send in club chat | ✅ | ✅ | ❌ | ✅ |
| Send in project chat | ✅ (if in chat) | ✅ (if in chat) | ❌ | ✅ |
| View child's messages | — | — | ✅ | ✅ |
| **Feed (All tab)** |  |  |  |  |
| View Feed (All tab) | ✅ | ✅ | ✅ (View as Child only; own account requires club membership) | ✅ |
| Comment on projects | ✅ | ✅ | ❌ in View as Child; ✅ on own account if in a club | ✅ |
| Report | ✅ | ✅ | ✅ | ✅ |
| **Applications** |  |  |  |  |
| Apply to start a club | ✅ | ✅ | ✅ (own acct) | — |
| Review applications | ✅ (assigned) | ❌ | ❌ | ✅ |
| Conduct interviews | ✅ (assigned) | ❌ | ❌ | ✅ |
| **Feedback** |  |  |  |  |
| Submit forms | ✅ (per club) | ✅ (per club) | ❌ | ❌ |
| **Safeguarding** |  |  |  |  |
| Report issues | ✅ | ✅ | ✅ | ✅ |
| **Admin** |  |  |  |  |
| Admin Dashboard | ❌ | ❌ | ❌ | ✅ |
| Manage Booklet | ❌ | ❌ | ❌ | ✅ |
| Manage seasons/forms | ❌ | ❌ | ❌ | ✅ |
| Suspend/remove users | ❌ | ❌ | ❌ | ✅ |
| **Users without a club** |  |  |  |  |
| View Feed (All tab) | ❌ | ❌ | ✅ (only in View as Child) | ✅ |
| Access chat | ✅ (existing chats only) | ✅ (existing chats only) | ✅ (read-only in View as Child) | ✅ |
| Report issues | ✅ | ✅ | ✅ | ✅ |
| All other features | ❌ | ❌ | ❌ | — |

---

## *8\. Safety & Compliance*

### 8.1 Core Principle

Safety rules follow the **user**, not the club.

### 8.2 Age-Based Rules

| Rule | Trigger |
| :---- | :---- |
| Parental consent before platform access | Under 16 at sign-up |
| Parent "View as Child" access | Parent-child link |
| DM restrictions for under-13 | Future |
| No adult-to-minor DMs | Future |
| Restrictions auto-lift at 16 | DOB vs. current date |
| Can unlink parent at 16 | DOB vs. current date |

### 8.3 Age Visibility

⚠️ **OPEN DESIGN QUESTION:** Should age or age range be visible on profiles? Even showing age reveals birthday over time. See [Section 10.11](#1011-age-visibility).

### 8.4 Media Safety

- All media uploads are screened via automated NSFW detection API before storage (see [Section 6.15.3](#6153-media-content-screening)).  
- File type validation: only accepted image/video formats allowed, MIME type checked server-side.

### 8.5 Privacy

- Users under 16 sign up with username \+ parent email (no child email required).  
- All users have a username/display name.  
- Minimal PII collection.  
- **Under-16 accounts pending consent:** Only minimal data stored (username, DOB, parent email). Auto-purged after 90 days if consent not obtained.  
- **Privacy policy (v1):** Must clearly describe data collection, processing, parental consent mechanisms, and data retention. Required before launch.

---

## *9\. Edge Cases & Business Rules*

### 9.1 Authentication & Accounts

| Scenario | Behavior |
| :---- | :---- |
| Parent never consents | Pending state persists. Account auto-purged after 90 days (see 6.1.6). |
| User turns 16 | Restrictions auto-lift. Can unlink parent. |
| Parent has multiple children | One account, multiple links. |
| Learner → Guide | Promoted by existing Guide (per-club) or applies to start new club. |
| Parent wants to join a club | Uses own account. Parental link is separate. |
| Under-16 starts a club | Parental consent before application enters review. |
| User already completed pledge, joins new club | No re-upload needed. Pledge is account-level. |
| Account exists without any club | Allowed. Limited access: chat (existing chats only), profile, report tool. No feeds, no club dashboard. |
| Under-16 pending consent for 90 days | Account auto-purged (username, DOB, parent email deleted). |
| Under-16 password reset | 6-digit code sent to parent's email. 15-min expiry, 3 attempts then 30-min lockout. |

### 9.2 Clubs & Membership

| Scenario | Behavior |
| :---- | :---- |
| Last Guide, Learners exist | Must promote a Learner. Can't leave until done. |
| Last Guide, no Learners | Warning → abandoned. Club code invalidated, removed from map. |
| Guide wants to close club | Kick all Learners (with reasons), then leave. |
| Guide vs. Guide dispute | Ask to leave. Escalate via Report Issue. |
| Guide kicks Learner | Reason required, stored. |
| Abandoned club | No one can join. CoC can attempt revival. |
| User in multiple clubs | Fully supported. Per-club roles. |
| Guide self-demotes | Allowed unless they're the last Guide (same rules as leaving). |

### 9.3 Sessions & Attendance

| Scenario | Behavior |
| :---- | :---- |
| Session cancelled | Guide cancels the future session. Flagged as cancelled, hidden from UI. Members who RSVP'd "Going" notified. |
| Session created, Guide leaves | Session remains. Other Guides can edit/cancel. |
| New member joins after session created | No RSVP status (opt-in model). |
| Guide tries to mark attendance before session starts | Blocked. Attendance marking opens at session start time. |
| Session ends, attendance not marked | Reminder sent. Locks 12hrs after end. Stays blank. |
| Viewing past attendance | Shows members who were in the club at the time. |
| Session photos uploaded late | Allowed up to 12 hours after session end. |

### 9.4 Projects

| Scenario | Behavior |
| :---- | :---- |
| Project with zero club attribution | Allowed. Appears on members' profiles but in no club's tabs. |
| Member leaves club, Active on project | Can change attribution (link/unlink clubs). |
| Member leaves club, Done on project | Cannot change attribution. |
| Multiple members, one unlinks from club | Project stays in club if ≥1 member still links it. |
| Everyone Done | Project Archived. Chat closes. Attribution frozen. |
| Member leaves project | Fully removed: not credited, removed from chat. Can be re-added later. |
| Member invited to project | Notification with Accept/Decline. No chat created. |
| User requests to join project | Any Active member can Accept/Decline. |
| Visibility changes from Global to Club-only | Existing comments from outside users persist. No new outside access. |
| Deadline passes | Visual indicator only. |
| Update posted | Immutable. Cannot be edited or deleted. |
| Cover image changed | Logged as change entry showing new image. |

### 9.5 Applications

| Scenario | Behavior |
| :---- | :---- |
| Under-16 applies | Held until parental consent. |
| Existing Guide applies for new club | Full application required. |
| Cap reached | Cannot apply. Leave email for notification. |
| Application after review window | Rolls to next season's review cycle. |
| Application rejected | Chat message sent to applicant. Optional personal message from reviewer. Can reapply in next review cycle. |
| Accepted, doesn't schedule onboarding call | Admin follow-up flag. Core Team decides whether to suspend. |
| Accepted, no-shows onboarding call | Admin follow-up flag. Core Team decides whether to suspend. |
| Accepted, completes onboarding call, doesn't run a session | Flagged in Admin. |
| User cancels join request | Chat closed. User returns to no-club state (or existing clubs). |
| User cancels club application | Chat closed. Application withdrawn. |

### 9.6 Chat

| Scenario | Behavior |
| :---- | :---- |
| User removed from club | View history, can't send. "No longer part of this chat." |
| Project Archived | Chat closes. History viewable. |
| Done member (not Archived) | Can still chat. |
| New club attributed to project | Guides from new club added to project chat. |
| Club un-attributed from project | Guides from that club removed from project chat (unless they're project members). |
| Member leaves project | Removed from project chat. History viewable. |

---

## *10\. Open Design Questions*

### 10.1 Parent Experience

The parent experience needs more exploration before development:

- **Parent-Guide communication:** Should there be a way for Guides to contact parents? A "Parent group chat" per club? This creates complexity: the parent already accesses the club via "View as Child" but can also be a club member themselves.  
- **Notifications in "View as Child" mode:** If a parent views the child's notifications, marking them as read would affect the child. Options: (a) Don't show notifications in View as Child mode. (b) Show but don't allow marking as read. (c) Show as separate read-only copy.  
- **Empty state for parent-only accounts:** A parent who has no club of their own needs a clear UX. They land on… what? Profile settings with "View as Child" as the primary action?

### 10.2 Club Types & Hierarchy

The right data model for club relationships needs more thought:

- **Current need:** Distinguish Curiosity Clubs from Club of Clubs.  
- **Possible future need:** Sister clubs (two clubs paired), regional groupings, parent-child club hierarchies.  
- **Options considered:**  
  - Simple `club_types` reference table (current proposal).  
  - General parent-child hierarchy (clubs can have sub-clubs). But this raises attribution questions: if I do a project with my sister club, does it auto-attribute to the parent club?  
  - Graph-based relationships (clubs linked via a `club_relationships` table with a type field).  
- **For v1:** At minimum, need a way to distinguish CoC from regular clubs and link CoC to its member clubs.

### 10.3 Club Dormancy/Abandonment

What does revival look like in practice?

- Can the Core Team re-activate an abandoned club?  
- Does the club's history (sessions, projects, chat) persist through abandonment and revival?  
- Do new Guides pick up where the old club left off, or start fresh?  
- Should there be a time limit after which abandoned clubs are permanently archived?

### 10.4 Comment Moderation (Future)

When project member comment hiding is added:

- Hidden \= fully invisible, or collapsed with "View anyway?"  
- Who can hide: project members only, or also Guides of attributed clubs?  
- Can the comment author see that their comment was hidden?

### 10.5 Admin Dashboard Architecture

**Partially resolved:** Stack is SvelteKit \+ Convex. Admin Dashboard will be a separate frontend sharing the same Convex backend. Admin users have profiles in the main system so they can chat with Guides.

**Still open:**

- Should admin actions (suspend, override) be logged for audit? (Recommended yes, but not for v1.)

### 10.6 Chat Action Buttons (Resolved for v1)

Dynamic action buttons differ by chat type (Accept/Decline in join requests, scheduling in application chats).

- **Decision for v1:** Use `chat_roles` \+ permission flags (data-driven authorization) and render buttons based on permissions returned from backend.  
- Optional later extension: `chat_actions` metadata table for richer configuration if chat action types grow.

### 10.7 Public Project Chat

If a project is set to "Share Globally," should its chat be visible (read-only) to non-members viewing from the Feed `All` tab? Arguments for: transparency, learning from process. Against: chilling effect on candid conversation.

### 10.8 Multi-Club Guides and Club of Clubs

If a Guide runs two clubs:

1. One CoC per Guide (regardless of how many clubs).  
2. One CoC per club (Guide is in multiple CoCs).  
3. Guide chooses or system assigns based on primary club.

### 10.9 Feedback Form Guide Access

- Do Guides see aggregated (anonymized) results for their club?  
- Can Guides add 1–3 custom questions to their club's form?  
- Both could aid self-improvement. Risk: defensiveness, pressure on learners.

### 10.10 Background Check Process

Exact verification process for Guides in clubs with minors. Current placeholder: self-affirmation during application with Core Team audit rights. Needs internal decision.

### 10.11 Age Visibility

Should age or age range be visible on profiles? Birthday is PII. Even showing current age reveals birthday over time (someone can track when age changes). Options: show nothing, show age range (e.g., "13–15"), show only to Guides of the same club.

### 10.12 Analytics & Measurement

The PRD defines success metrics (Section 1.3) but the platform has no specification for how to measure them.

- Should there be a built-in analytics layer, or a third-party tool (PostHog, Mixpanel, etc.)?  
- What events should be tracked? (e.g., session creation, project creation, chat activity, login frequency)  
- Is the Admin Dashboard the only consumer of this data, or should Guides see club-level analytics too?  
- How do we track the "active clubs" metric — what defines "active"?

### 10.13 Search Implementation

Contextual search is defined per screen (Section 6.16) but the technical approach is undefined.

- What search technology should be used? (Convex built-in text search, or external like Meilisearch/Algolia?)  
- Is full-text search needed, or is basic substring matching sufficient for v1?  
- Does search need to respect visibility rules (e.g., club-only projects shouldn't appear in search for non-members)?

### 10.14 Caching Strategy

Several data types are highly cacheable (Activity Booklet, discovery map, global feed). No caching strategy is defined.

- Should Convex's built-in caching be sufficient for v1?  
- Are there any specific data access patterns that need optimization?

---

## *11\. Non-Functional Requirements*

### 11.1 Performance

| Requirement | Target |
| :---- | :---- |
| Page load | \<2s on 3G |
| Chat delivery | \<500ms |
| Search | \<1s |
| Concurrent users | 500+ |

### 11.2 Availability

99.5% uptime. Scheduled maintenance with notice.

### 11.3 Security

- HTTPS/TLS, encryption at rest.  
- Passwords: bcrypt or Argon2.  
- Secure sessions. Rate limiting on auth \+ club code endpoints.  
- CSRF protection. Input sanitization (XSS prevention — critical for chat/updates).  
- Club codes: rate-limited entry, resettable by Guides.  
- **Multi-device:** Users can be logged in on multiple devices simultaneously. No special session management or single-device enforcement.

### 11.4 Data

- Automated backups.  
- Projects, updates, and chat never permanently deleted.  
- GDPR full export/deletion workflows are out of v1 scope. v1 includes consent handling, privacy policy, and 90-day purge for unconsented under-16 accounts.

### 11.5 Accessibility

WCAG 2.1 AA. Keyboard nav, screen readers, color contrast.

### 11.6 Media Handling

| Requirement | Specification |
| :---- | :---- |
| Supported image formats | JPG, PNG, WebP |
| Supported video formats | MP4, MOV |
| Max video duration | 2 minutes (enforced on upload for files; checked via API for YouTube links) |
| Image compression | All images compressed on upload to reduce storage and bandwidth. Exact approach TBD (e.g., sharp/libvips server-side, or client-side before upload). |
| Video compression | Videos compressed on upload. Exact approach TBD. |
| File type validation | MIME type checked server-side (not just file extension). |
| NSFW screening | All media screened via NSFW detection API before storage (see [Section 6.15.3](#6153-media-content-screening)). |
| Storage quotas | None. No per-user or per-club limits. |

### 11.7 Character Limits

Central reference for all text field limits:

| Field | Max Characters |
| :---- | :---- |
| Club name | 50 |
| Club description | 2,000 |
| Project name | 50 |
| Project description | 500 |
| Project update text | 1,000 |
| Chat message | 1,000 |
| Feed comment (All tab) | 1,000 |
| Session description | 1,000 |
| Kick reason | 500 |
| Application "Why \+ experience" | 5,000 |
| Username / display name | 50 |

### 11.8 Scalability

10x growth (1,000 clubs, 10,000 learners) without major refactoring.

---

## *12\. Tech Stack (Decided)*

**Stack: SvelteKit \+ Convex**

| Factor | Approach |
| :---- | :---- |
| Frontend | SvelteKit (web-first, responsive) |
| Backend / Database | Convex (document model, built-in reactive queries, function-level access control) |
| Auth | better-auth (username plugin for username-based login, Google OAuth) |
| Real-time | Convex built-in reactive queries (chat, notifications) |
| Storage | Convex built-in storage (pledges, session photos, project media, application videos) |
| Geo/maps | Standard JS libraries (e.g., Leaflet, Mapbox GL JS) |
| Mobile (future) | PWA for v1. Native apps or separate build later. |
| API | Convex functions (no separate REST/GraphQL layer needed). Admin Dashboard shares same Convex backend. |
| Cost | Usage-based. |

---

## *13\. v1 Scope vs. Future Roadmap*

### 13.1 In v1 (May 2026\)

| Feature | Status |
| :---- | :---- |
| Auth \+ onboarding (consent, pledge, DOB-based flows, password reset for under-16) | ✅ |
| Club creation and management (no age-range field) | ✅ |
| Club discovery map \+ join flows (code \+ request) | ✅ |
| Club codes (rate-limited, resettable) \+ public links | ✅ |
| Sessions \+ attendance \+ session photos | ✅ |
| Activity Booklet (read-only) | ✅ |
| Projects \+ attribution \+ cover images \+ lifecycle | ✅ |
| Immutable project updates (photo/video, max 4, 2-min video limit) | ✅ |
| Feed (My Clubs \+ All tabs) | ✅ |
| Chat (club, project, join request, application) | ✅ |
| Guide application \+ peer review (always-open, scheduled reviews) | ✅ |
| Club of Clubs (basic) | ✅ |
| Quarterly feedback forms (graduated enforcement) | ✅ |
| User profiles | ✅ |
| Notifications (in-app \+ email) | ✅ |
| Admin Dashboard (separate app) | ✅ |
| Safeguarding report tool | ✅ |
| NSFW media screening on upload | ✅ |
| Media compression on upload | ✅ |
| Project invitation & join request model | ✅ |
| Season automation (seasons table, review windows, feedback triggers) | ✅ |
| Privacy policy | ✅ |

### 13.2 NOT in v1

| Feature | Priority | Notes |
| :---- | :---- | :---- |
| Native mobile apps | High | PWA for v1. Native later. |
| Comment hide by project members | Medium | See Section 10.4. |
| DMs | Medium | Adult-to-minor restrictions. |
| @mentions in chat | Medium | — |
| Link previews in chat | Low | Links are clickable in v1, no previews. |
| Collaborative Activity Booklet | Medium | Guides submit/fork/rate. |
| Resources section | Medium | Brand materials. |
| Curiosity Celebration (in-app) | Medium | Currently external. |
| Guide Training Experience (in-app) | Medium | Currently external. **Long-term:** mandatory before starting club. Exemptions: attended \<2yr ago. Added Guides exempt. |
| Parent group chat per club | Medium | See Section 10.1. |
| Payments / merch | Low | Stripe. |
| Multi-language | Medium | i18n-ready from v1. |
| Automated moderation | Low | Low spam risk. |
| Push notifications | Medium | When mobile launches. |
| Edit/delete updates | Low | Currently immutable. If added: change logs remain immutable. |
| GDPR export \+ account deletion workflows | Medium | Out of v1 scope. v1 has consent \+ privacy policy only. |
| Audit logging for admin actions | Medium | Recommended but deferred. |
| Analytics / measurement dashboard | Medium | See Section 10.12. |
| Cancelled sessions visible in UI (greyed out) | Low | v1 hides cancelled sessions. |
| Recurring/bulk session creation | Low | Auto-populated defaults sufficient for v1. |

---

## *14\. Glossary*

| Term | Definition |
| :---- | :---- |
| **Guide** | Vetted volunteer facilitating a club. Per-club role. |
| **Learner** | Person of any age attending a club. Per-club role. |
| **Parent** | Account-level relationship. User linked to child(ren) under 16\. Has own independent account. |
| **Club** | Independent local Curiosity Club. Meets on a schedule. |
| **Club of Clubs (CoC)** | Peer support group of \~10 clubs for Guides. |
| **Core Team / Admin** | Central Curiosity Learning team. |
| **Season** | 3-month administrative cycle (Spring, Summer, Autumn, Winter) governing review windows and feedback deadlines; clubs persist across seasons. |
| **Building Blocks** | Six activity types: Team Building, Get Curious, Plan Projects, Work on Projects, Share Experiences, Mini Projects. |
| **Activity Booklet** | Curated library of activity templates. |
| **Project** | Collectively-owned piece of work. Attributed to clubs optionally. |
| **Project Pillars** | Knowledge, Skills, Relevance — conversational tool for Guides, not in UI. |
| **Attribution** | Optional per-member link between project and club. |
| **"I'm Done"** | Per-member action: finished contributing. Read-only except chat. |
| **Archived** | All members Done. Chat closes. |
| **Current / Showcase** | Club dashboard tabs. Current \= active work. Showcase \= history (incl. archived). |
| **Pledge** | Handwritten commitment to Guiding Principles. Account-level, uploaded once. |
| **Guiding Principles** | (1) Guide, don't teach. (2) Learn autonomously. (3) Safe environment. (4) Consistent and reliable. (5) Work as a team. (6) Expose to new ideas. (7) Nurture love for learning. (8) Part of larger community. |
| **Abandoned** | Club where all members have left. Code invalidated, no joins possible. |
| **Pending** | User state: missing consent and/or pledge. Fully locked out — no platform access until both gates cleared. Account auto-purged after 90 days if consent not obtained. |
| **Leave Project** | Self-action: user exits a project. Not credited, removed from chat. Can rejoin via re-invitation. Distinct from "I'm Done." |
| **Club Code** | Private code for instant club join. Guide-visible only, resettable. |
| **Public Club Link** | Permanent URL showing club preview. Discoverable clubs only. Joining goes through request flow. |
| **Feed** | Unified feed with two tabs: `My Clubs` (your clubs) and `All` (globally shared projects). |
| **Club Dashboard** | Club-specific view with sessions, projects, members. Has club switcher. |

---

*End of PRD — Version 1.3*  
