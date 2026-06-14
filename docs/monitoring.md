# Production Monitoring

Sentry project:

- Organization: `curiosity-learning`
- Project: `javascript-sveltekit`
- Region: EU

The application sends browser and SvelteKit server errors directly to Sentry. Because the Convex deployment remains on Starter, targeted Convex actions report through a secret-protected SvelteKit endpoint instead of Convex's Professional-only native integration.

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

1. Trigger one controlled browser exception and confirm it appears without user, cookie, query-string, or request-body data.
2. Trigger one controlled SvelteKit server exception and confirm source-mapped stack frames resolve.
3. Temporarily use an invalid Google Chat or media storage configuration and confirm the scheduled action reaches Sentry through `backend` or `media` tags.
4. Send a Resend test event for `email.failed` and confirm it appears with only provider, event type, and email type.
5. Remove all controlled failure conditions immediately after verification.

The code intentionally does not include a public Sentry test route.
