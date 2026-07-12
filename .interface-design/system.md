# Curiosity Learning — interface system

Captured 2026-07-11 during the branch-wide UI audit. This documents the system as
built and CEO-approved; hold to it.

## Direction & feel
Warm, tactile, encouraging — a paper notebook for a learning community, not a SaaS
tool. Paper-texture warm background, white rounded cards, one orange brand accent,
chunky hand-drawn display font for page titles, calm density with generous card
padding.

## Tokens (src/routes/layout.css)
- Semantic: `--foreground/--muted-foreground/--card/--border/--primary(...)` as
  Tailwind classes (`text-foreground`, `bg-card`, `border-border`, …). Always
  prefer these. **No arbitrary hex in class names** (exception: Mapbox canvas
  colors in public-club-map, decorative illustration fills in onboarding).
- Brand ramps are first-class tokens: `orange-50..900` (primary accent),
  `purple-*` (secondary/received-message accent), `green-500`, `gray-*`.
  Using `orange-500` etc. is correct for accent intent.
- Known gaps (flagged for design-system evolution): no weight-600 type class;
  no type class for 2rem/1.35rem bold heroes; six nav-shell hexes have no token
  equivalent (`#f8ecdf` active-nav bg, `#5e637a`, `#44495f`, `#7a8093`,
  `#4c5167`, `#6d7286`).

## Typography
`.type-*` utility system (135 classes in layout.css): `type-h1..h6(-medium/-bold)`,
`type-body(-compact/-medium/-bold)`, `type-lead(-bold)`, `type-sm(-bold)`,
`type-xs`, `type-caption(-bold)`, `type-step-title`, `type-control`,
`type-field-label`, `type-link`. Use the closest class; raw `text-*/font-*` only
where no class matches the required rendering (document it). Dynamic numbers get
`tabular-nums`.

## Depth & surfaces
One strategy: white `bg-card` cards with `rounded-2xl` and soft borders on the warm
paper canvas. No drop-shadow stacking, no harsh lines, no mixed strategies.
Inputs use the `type-control` base; empty states use the dashed-border card idiom.

## Spacing & density
4px grid. Cards: p-4 (sm:p-6) rhythm; page gutters -mx-4 px-4 (sm:-mx-6 …).
Bottom nav on mobile; single column mobile → 2-col grids ≥lg. Hit areas ≥40px
(size-10 icon buttons; ToggleGroup size="lg" for tap scales).

## Components (always use, never hand-roll)
- Primitives: src/lib/components/ui (button, dialog, alert, badge, card, input,
  switch, tabs, dropdown-menu, toggle-group, skeleton, spinner, field...).

### Button variants (CEO consistency review 2026-07-12 — component-level contract)
Every interactive control that looks like a button or text link uses the Button
component (or `buttonVariants` for styled links). No raw `<button>`/`<a>` with
utility classes replicating button looks.

Typography is IDENTICAL across all variants — `text-base font-bold` lives in the
base, never per variant — so paired actions (Accept/Reject, Going/Not going) can
never differ in weight. Color alone assigns emphasis:

| Variant       | Renders                                                    | Use for |
|---------------|------------------------------------------------------------|---------|
| `default`     | solid orange-500, white text, darkens on hover/press       | THE primary action of a surface |
| `outline`     | orange border + orange text, orange-50 hover wash          | secondary action with brand emphasis (e.g. unselected RSVP, dialog Cancel next to a solid confirm) |
| `secondary`   | quiet warm-gray (`bg-secondary`) fill, foreground text     | primary action in compact/inline rows (banner action rows) where solid orange is too loud |
| `ghost`       | no fill, foreground text, `bg-muted` hover                 | de-emphasized companion action (Reject, Decline, Dismiss, Cancel-request). NEVER orange — orange is reserved for primary emphasis |
| `destructive` | solid `bg-destructive` red, white text                     | irreversible/dangerous confirms |
| `link`        | inline orange text, no box (size geometry collapses), darkens on hover/press | the text-link idiom: "See all", "View all", "Change", "Read more", "enter here". Add `type-sm-bold`/`text-sm` at the call site for 14px links |

Compound rules baked into the component:
- `ghost` + `size="icon|icon-sm|icon-lg"` → `text-muted-foreground hover:text-foreground`:
  the ONE icon-action convention (header search, ActionMenu, add/edit/delete row
  actions, chat members). Square `rounded-md` container — never `rounded-full`.
- `link` collapses to `h-auto p-0` at any size; it is text, not a box.

Documented exceptions (deliberate, keep):
- Composer send buttons (chat + project update) are ghost icon buttons with explicit
  orange classes — primary emphasis inside a composer.
- Floating overlay pills (language switcher on public pages, activity-booklet FAB)
  are Button with `rounded-full` + shadow — a distinct floating-affordance idiom.
- ReportIssueDialog's tiny round flag trigger (size-7) stays a raw button defined
  once inside that component: it is an inline content affordance in dense rows,
  not an action-bar icon button.
- `ScreenBackButton` (app component) is the back-chevron for full-screen flows
  outside the app shell (auth, onboarding, legal, public club page).
- App idioms: `ConfirmDialog` (all confirmations — never window.confirm;
  destructive variant for irreversible actions), `EmptyState`
  (`bordered={false}` inside an existing Card), `LoadingState`, `ActionMenu`,
  `UpdateCard` (the ONLY renderer for project updates anywhere; system variant
  for change-log entries; media grid built in), `HeaderTabs` (aliases are
  exact-match parent paths), `FieldLabel`/`FieldError` for forms,
  club-session-card / club-project-card for those entities.
- Entry rows on profile: icon + `type-lead-bold` title + count Badge, one idiom.

## Recurring patterns
- Status banners: Alert-based, one parameterized block per surface (see the
  enforcement banners in (app)/+layout.svelte). Chat action banners (Accept/Decline,
  Move to interview, etc.) render the action buttons INSIDE the Alert as a compact
  `size="sm"` row (`secondary` for the primary action, `ghost` for the secondary/
  decline one — both render bold foreground text, see Button variants) — CEO
  review 2026-07-11: standalone solid buttons read as "too in your face". Read-only/closed chat states show the explanatory banner and remove
  the composer entirely (no disabled-input idiom) — CEO review 2026-07-11.
- Chat member overview: a join_request/clubApplication room's header shows the
  "other party" (requester/applicant) name+avatar directly, with a `Users` icon
  affordance opening a "Chat members" Dialog listing every participant
  (name/avatar/role) — see chat.getRoomParticipants. Inbound messages (not the
  viewer's own) always show sender name+avatar; own messages don't.
- Chat list actionability: rooms carry an `actionState` (`open`/`action_needed`/
  `closed`) from chat.listRoomSummaries; the list only renders a Badge for the
  two states worth a glance (action_needed: filled orange; closed: outline) —
  nothing shown for the unremarkable "open" default.
- Report entry points: flag affordance via ReportIssueDialog on any user content.
- i18n: every user-facing string through src/lib/i18n (en + nl), always.
- Empty/loading are mandatory per data region; async actions show pending state.

## Future (approved, not yet built)
Skeleton loaders everywhere for instant page shells — Fibery CL-756.
