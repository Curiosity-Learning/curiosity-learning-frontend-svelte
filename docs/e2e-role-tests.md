# Signed-in end-to-end tests (one per role)

`e2e/roles/` is a Playwright suite that signs in as each kind of user and walks the pages they
use. It is the safety net for changes to auth and page loading (CL-815, CL-814). It runs in
under a minute.

## Run it

```sh
cp .env.e2e.example .env.e2e        # once: fill in the test-account passwords
npm run dev                         # in another terminal
npm run test:e2e:roles              # targets this worktree's URL from .env.local
```

Against a Vercel branch preview:

```sh
E2E_BASE_URL='https://<project>-git-<branch>-<team>.vercel.app' \
VERCEL_AUTOMATION_BYPASS_SECRET='<Protection Bypass for Automation secret>' \
npm run test:e2e:roles
```

The bypass header is sent once, on a request that sets Vercel's bypass cookie
(`e2e/roles/helpers.ts`, `primeVercelBypass`), and only to an `https://*.vercel.app` base URL. It is not sent on every request, because
`extraHTTPHeaders` would also send it to Convex and Google and break CORS. Traces are off by
default because they record request headers; `E2E_TRACE=1` turns them on, and is ignored
while the bypass secret is set.

On the Mac mini, use Node 24 (`PATH=/opt/homebrew/opt/node@24/bin:$PATH`): under Node 25 a
failed sign-in through the local auth proxy returns a 500.

CI does not run this suite. It needs a running app, a backend with the dev data and the
passwords, so it is a local and preview check. `npm test` and `npm run test:e2e:local` skip
`e2e/roles/`.

## How it works

- `auth.setup.ts` (the `setup` project) signs in once per role with a password, or a username
  for children. It checks where each account lands and saves the session to
  `playwright/.auth/<role>.json`, which is gitignored. This follows
  https://playwright.dev/docs/auth.
- The `roles` project depends on `setup`. Each spec starts from its role's saved session.
- `flows.ts` holds the page visits. Each one checks that the page's main content rendered. It
  also checks that every visible `<img>` in the content column (not the header or nav) decoded (`naturalWidth > 0`), and that at least N of
  them are signed CDN media (URLs with `Signature` and `Key-Pair-Id`).
- The suite only reads data. Its only side effects are sign-ins, which add sessions.

## Roles and accounts

The accounts are the `cl-e2e-*` test accounts in the shared dev data. Worktree and preview
backends copy that data, ids included (`e2e/roles/accounts.ts`).

| Role       | Account              | What is checked                                                                                                         |
| ---------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| learner    | `cl-e2e-adult1`      | Lisbon club pages, feeds, a project, profiles, settings; no Guide controls; other clubs are not found                   |
| guide      | `cl-e2e-adult2`      | Amsterdam club with Guide controls, a session and a project; none of those controls in Lisbon, where they are a Learner |
| parent     | `cl-e2e-parent2`     | Lands on their child's read-only page; club pages redirect there                                                        |
| child      | `cl_e2e_kid_club`    | Username sign-in; Amsterdam club, a session and a project without Guide controls; no access to an application review    |
| clubLess   | `cl_e2e_kid_applied` | Lands on `/new-club` with their pending application; club pages redirect there                                          |
| reviewer   | `cl-e2e-parent1`     | Review queue (empty, see below), review guide, an assigned application's review page; their club                        |
| signed out | —                    | Protected page → sign-in with `next` → back to that page (email and username); wrong password                           |

The reviewer's queue is empty on purpose: the review assignments in dev data point at
applications without a `reviewSeasonId`, so no current-season queue lists them. The assigned
application's page is opened directly instead.

If the dev data changes (an account loses its club, the Amsterdam sessions are deleted),
update `accounts.ts` and the expectations with it.
