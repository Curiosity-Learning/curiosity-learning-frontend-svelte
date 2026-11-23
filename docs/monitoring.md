# Production Monitoring

Sentry project:

- Organization: `curiosity-learning`
- Project: `javascript-sveltekit`
- Region: EU

The application sends browser and SvelteKit server errors directly to Sentry. Because the Convex deployment remains on Starter, targeted Convex actions report through a secret-protected SvelteKit endpoint instead of Convex's Professional-only native integration.

## What Sentry Receives

This is what the privacy policy (section 6, `src/convex/legalContent.ts`) and the app-store privacy forms (CL-813) describe. Change them together.

Sent:

- Error type, message and stack trace (source-mapped), and the `operational.area` / `operational.operation` tags.
- Allowlisted record ids from `SAFE_IDENTIFIER_KEYS` (`src/lib/monitoring/payload.ts`, `src/convex/monitoring.ts`): application, asset, status, provider, HTTP status, email type, failure code, function name. No profile, user or account ids.
- Browser, OS and runtime name and version, the environment and release.
- The page or request URL with its query string and fragment removed, and token path segments (`/verify-email/…`, `/onboarding/parent-consent/…`, `/auth/reset-password/…`) redacted. Route ids such as `/profile/<profileId>` stay.
- Breadcrumbs: navigations, fetch/XHR URLs (same URL rules), console messages, and UI clicks as CSS selectors. Every breadcrumb gets the same redaction, whether it goes through `beforeBreadcrumb` or arrives already attached to the event (`event.breadcrumbs`), which `beforeSend` scrubs again.

Never sent (fixed in `sentry-config.ts` and `redaction.ts`, not overridable by env):

- No IP address stored with events. Requests to Sentry's EU ingest endpoint still arrive over HTTPS from the sender's address (the visitor's browser, or our SvelteKit server on Vercel), but every event tells Sentry's Relay `infer_ip: "never"`, so it neither stores nor infers an IP into the event, and the events carry no IP of their own. `sendDefaultPii: false` keeps the SDKs from adding one, and the setting differs by runtime:
  - Browser: the SDK itself sends `sdk.settings.infer_ip: "never"`.
  - SvelteKit server: the SDK sends no `infer_ip` setting and no `user` field, so `redaction.ts` sets `sdk.settings.infer_ip: "never"` on every event and transaction, creating the `sdk` block if an event has none. It also deletes `request.env` and the headers that carry the visitor's IP (`x-forwarded-for`, `x-real-ip`, `x-vercel-forwarded-for`, `x-vercel-ip-*`, `cf-connecting-ip`, `true-client-ip`, `forwarded`).
  - Convex: Convex never connects to Sentry. It POSTs its reports to the SvelteKit endpoint `/api/internal/monitoring/report`, and the SvelteKit server (on Vercel) makes the HTTPS request to Sentry with its server SDK, so the server rules above apply and the connection comes from our server's address, not a visitor's or Convex's.
- No user, cookies or request headers with credentials. `event.user` is deleted even if something sets it; the app never calls `setUser`.
- No session replay (both replay sample rates are 0) and no device or advertising identifiers. The web SDK has none; the native SDK (CL-811) must keep it that way.
- Request bodies, form data, query strings and cookies are deleted; values under keys matching passwords, tokens, secrets, signatures, credentials, emails and bodies become `[Redacted]`.
- Email addresses anywhere in text become `[Redacted email]`.
- Names: values under name keys (`username`, `displayName`, `firstName`, `lastName`, `fullName`, `childName`, `parentName`, `guardianName`, … in camel or snake case) become `[Redacted]`. In free text, a value after a name label (`username "ava"`, `display name: Ava`, `{"firstName":"Ava"}`) becomes `[Redacted name]`. An unquoted value is redacted up to the next comma, semicolon, bracket, line end or `key:` / `key=` pair, so `full name: Ava Brown` loses both words, except that an unquoted username is one word (`username=ava is already taken` keeps "is already taken"); a quoted value is redacted whole, escaped quotes included, and one with no closing quote is redacted to the end of its line. Quoted values are read by a one-pass scanner, not a backtracking regex, so long or malformed input cannot stall redaction. The `aria-label`, `title` and `alt` values that Sentry copies into `ui.*` click breadcrumbs become `[Redacted]`, even when the label itself contains quotes, brackets or `>` (the value ends only where the rest of the selector still parses; an unclosed label is redacted to the end), because labels like "Remove Ava" carry names. Plain `name` keys are kept: Sentry uses them for the SDK, browser and OS.

A name with no label in front of it cannot be recognised, so **error messages must refer to people by id, never by name or username**. Convex errors reach Sentry through `/api/internal/monitoring/report`, which runs the same text redaction on the message and stack.

## Production Configuration

Set these values in Vercel production:

```text
PUBLIC_SENTRY_DSN=https://d01f876073a72f8b3d36d41a8372e2c8@o4511563803852800.ingest.de.sentry.io/4511563814207568
PUBLIC_SENTRY_ENVIRONMENT=production
SENTRY_ENVIRONMENT=production
SENTRY_AUTH_TOKEN=<private source-map upload token>
MONITORING_REPORT_SECRET=<random high-entropy shared secret>
RESEND_WEBHOOK_SECRET=<Resend webhook signing secret>
```

Set the same `MONITORING_REPORT_SECRET` in the production Convex deployment:

```sh
npx convex env set MONITORING_REPORT_SECRET <same-random-secret>
```

`SENTRY_AUTH_TOKEN` is used only during builds to upload source maps. Never expose it through a `PUBLIC_` variable or commit it.

## Resend Webhook

In Resend, create a webhook for:

```text
https://<production-domain>/api/webhooks/resend
```

Subscribe to:

- `email.failed`
- `email.bounced`
- `email.suppressed`
- `email.delivery_delayed`
- `email.complained`

Put the webhook signing secret in Vercel as `RESEND_WEBHOOK_SECRET`. Routine sent, delivered, opened, and clicked events are intentionally ignored.

## Sentry Alerts

Configure email notifications for the team:

1. Alert when a new production issue is created.
2. Alert when a resolved production issue regresses.
3. Alert when an issue has at least three events in fifteen minutes.

Create the included Sentry uptime monitor for the production root URL. Do not create a cron monitor yet; the application currently has scheduled background actions but no recurring cron job.

## Verification

After deploying production configuration:

1. Trigger one controlled browser exception and confirm it appears without user, IP, cookie, query-string, or request-body data.
2. Trigger one controlled SvelteKit server exception and confirm source-mapped stack frames resolve.
3. Temporarily use an invalid Google Chat or media storage configuration and confirm the scheduled action reaches Sentry through `backend` or `media` tags.
4. Send a Resend test event for `email.failed` and confirm it appears with only provider, event type, and email type.
5. Remove all controlled failure conditions immediately after verification.

The code intentionally does not include a public Sentry test route.
