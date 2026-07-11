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
  decline one) — CEO review 2026-07-11: standalone solid buttons read as "too in
  your face". Read-only/closed chat states show the explanatory banner and remove
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
