# DEPLOY — Turnstile on Vercel

**Turnstile is live (2026-11-21)** at **https://turnstile.labintelligence.co**, behind the shared demo password (D-46).
Vercel project `turnstile`, Neon database, Stripe **test mode**. Production deployment `dpl_8aMfYPVd5DxeyZ5bjHxXps2aYmub`
(commit `9d8b434`, READY, built 2026-11-21 12:35 CT, read from Vercel's API on 2026-11-21). Its build log, as reported by the owner in the
scheduled closeout brief (2026-11-21; this run did not read the build log itself): `deploy-env` OK, 25 migrations applied, `seed-hosted` loaded the six demo accounts and 216 seats + 700
customers in each of `acme` and `globex`. Two earlier Production builds of the same commit ended in ERROR (12:23 and 12:31
CT), as step 4 expects while variables are missing.

This file was written by a cloud run on 2026-11-20 as the order of work, and updated on 2026-11-21 by the closeout run
(steps 9 and 10 below). Every step that touches Vercel, Neon or Stripe is the owner's and is marked **You:**. Decisions
behind it: D-44 to D-50 and D-51 to D-53 in `docs/decisions.md`.

**Status of the steps (2026-11-21):** 1 to 4, 6 and 7 done by the owner (the READY Production
deployment above shows a project, a database the build could migrate, and variables that passed `deploy-env`). Step 5 (the
Stripe webhook endpoint, its URL and events) is **not verified**: a READY build does not show it, and Stripe was not called. **8 not yet
reported done** (the smoke check and the first real Stripe test payment, EVAL O-8). 9 done by the closeout run (this
file and the README carry the address). 10 recorded as D-52 (Vercel read; Neon not readable from a cloud session).

Still true once deployed: synthetic data only, Stripe **test mode** only, nothing is sent (notices stop in the outbox),
and no claim about any venue's policy, any ticketing law or any fire code.

## What a deploy does

Vercel runs `npm run vercel-build` (`scripts/vercel-build.mjs`) instead of `npm run build`. On a **Production** build it
runs four steps, in order, and stops at the first that fails; a failed build leaves the previous deployment serving.

| # | Step | What it does | If it fails |
|---|---|---|---|
| 1 | `scripts/deploy-env.ts` | Checks every variable in the table below. | The build log lists the names that are missing or wrong. No value is printed. |
| 2 | `prisma migrate deploy` | Applies pending migrations with `MIGRATE_URL`. | Schema and code stay in step: the new code does not ship. |
| 3 | `scripts/seed-hosted.ts` | Only when `DEMO_MODE=1`: the six demo accounts, and the fixture event loaded into each demo org that does not have it. Write-once: an event that is already there is never touched, so a deploy does not reset anyone's holds, orders or event clock. A freshly loaded event's clock is put at the moment sales open, whatever the wall date (D-60). | — |
| 4 | `npm run build` | The Next.js build. | — |

A **Preview** build is skipped altogether (`vercel.json` `ignoreCommand`, as Earmark D-56), and a build of `main` is also
skipped when only `docs/` or `*.md` files changed (the house diff check). A local `npm run vercel-build` does step 4 only.

## The 11 variables

Set all of them for the **Production** environment only. Names only here; a value never belongs in this repository, a
cloud session or CI. `VERCEL` and `VERCEL_ENV` are set by Vercel itself. Nothing else in `.env.example` should be set
(in particular: no `DATABASE_URL_SYSTEM`, no `RLS_MODE`, no `RESEND_API_KEY`, no `SSO_*`, no `ALLOW_CLOUD_DB`, no `NODE_ENV`).

| # | Name | What it is for | Where the value comes from | Needed at | Without it |
|---|---|---|---|---|---|
| 1 | `DATABASE_URL` | Every query the app makes. | Neon: the **owner** role through the **pooler** (`-pooler` host). RLS is off (D-6), so the app connects as the owner. | build (step 3) and runtime | Build refused (core schema). |
| 2 | `MIGRATE_URL` | Migrations during the build. Read only by `scripts/vercel-build.mjs`. | Neon: the **owner** role, **direct** (no `-pooler`). | build | Build refused. Code never ships ahead of its migrations. |
| 3 | `AUTH_SECRET` | Root secret for session tokens and sealed values. At least 32 characters. | You generate it (`openssl rand -hex 32`). Changing it later signs everyone out. | build and runtime | Build refused (core schema). |
| 4 | `APP_URL` | The site's own address: Stripe returns the buyer to `APP_URL` + the Buy page; cookies are `Secure` when it is https. | `https://turnstile.labintelligence.co`: origin only, no path, no trailing slash. | build and runtime | Build refused if missing, not https, localhost, or with a path. |
| 5 | `EMAIL_ENABLED` | Set to `0`. Production refuses to start unless email is configured or switched off; Turnstile sends nothing (D-33). | The literal `0`. | build and runtime | Build refused (core schema names `RESEND_API_KEY, EMAIL_FROM`). |
| 6 | `DEMO_MODE` | Set to `1`. Turns on `/demo`, the only way to sign in with email off, and the demo seed at build. | The literal `1`. | build and runtime | Build refused. (At runtime without it `/demo` is a 404 and demo sessions stop resolving.) |
| 7 | `DEMO_ACCESS_PASSWORD` | The one shared password in front of every page (HTTP Basic, any username). | You choose it and give it to the people you demo to. **16 or more characters** (PRD-2 item 8, D-66). Changing it needs a new deployment. | runtime | Build refused, also when it is shorter than 16 characters: the build names the variable and never prints the value or its length. (At runtime without it every page of a Vercel deployment answers 503: the gate fails closed.) |
| 8 | `CRON_SECRET` | Vercel Cron sends it to `/api/cron` as a bearer token. At least 16 characters. | You generate it (`openssl rand -hex 16`). | runtime | Build refused. (At runtime without it the daily cron call answers 401 and nothing is swept.) |
| 9 | `STRIPE_SECRET_KEY` | Creates the PaymentIntent on Pay and the refunds. Must start with `sk_test_` (or `rk_test_`). | Stripe dashboard, **test mode**, API keys. | runtime | Build refused, also for a live key. (At runtime without it, since PRD-3 item 11: Pay answers on the form that payment could not be started and the hold stays held; a box-office refund is recorded and waits as unconfirmed; nothing is marked PAYING. Before that change Pay recorded a hold as PAYING that no real payment could complete.) |
| 10 | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe Elements in the browser. Public by design; inlined into the bundle **at build time**. Must start with `pk_test_`. | Stripe dashboard, **test mode**, API keys. | build | Build refused. (Set after a build, it has no effect until the next build.) |
| 11 | `STRIPE_WEBHOOK_SECRET` | Verifies Stripe's signed webhook. Tickets are issued only when it verifies. Must start with `whsec_`. | Stripe dashboard, **test mode**, the webhook endpoint created in step 5. | runtime | Build refused, also for the fixture secret published in `fixtures/stripe/`. (At runtime without it the webhook answers 503 and no ticket is ever issued.) |

Read by the app but **not** set for this deploy, and why: `DIRECT_URL` (migrations use `MIGRATE_URL`), `DATABASE_URL_SYSTEM`
and `RLS_MODE` (RLS stays off, D-6), `RESEND_API_KEY` / `EMAIL_FROM` / `EMAIL_SANDBOX_TO` (email off), `TWILIO_*` / `SMS_*`
(unused), `STRIPE_PRICE_ID` (the template's billing key; billing is removed), `SSO_*` (no provider), `AI_ENABLED` (no model
client), `WEBHOOK_ALLOW_PRIVATE` (refused in production), `ALLOW_CLOUD_DB` (only for reaching a cloud database from a laptop).

**Webhook endpoint path:** `POST https://turnstile.labintelligence.co/api/checkout/webhook`, events `payment_intent.succeeded` and
`payment_intent.payment_failed`. It is not behind the demo password (Stripe cannot answer a Basic challenge); its guard is
the signature.

## Steps, in order

Every step is yours: this run could not and did not do any of them. Each is done in a browser unless it says otherwise.

1. **You:** read the pull request "Turnstile: deploy prep for Vercel (not deployed)", check CI is green on its head
   commit, and merge it. With no Vercel project linked, merging starts CI and nothing else.
2. **You: create the database (Neon).** New project `turnstile`, Postgres 17, the default database and the default
   (owner) role. Set the compute's suspend timeout to the minimum (D-36). Copy two connection strings for the owner
   role: **pooled** (for `DATABASE_URL`) and **direct** (for `MIGRATE_URL`).
   - **Roles:** none to create. RLS is off for Turnstile (D-6), so the app connects as the owner. The `app_rw` SQL in
     the README ("Row-level security on Neon") is only for a clone that sets `RLS_MODE=enforce`; Turnstile's enforce
     leg has never been run, so do not turn it on as part of this deploy.
   - **Check once, in Neon's SQL editor:** `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user;` must answer
     `t`. The template's RLS policies are always on, and with RLS off the app relies on the owner bypassing them. If it
     answers `f`, stop: the app would see no org rows (the README says Neon's owner role bypasses; this run could not check).
3. **You: Stripe, test mode.** In the Stripe dashboard, with the test-mode switch on, copy the publishable key
   (`pk_test_…`) and the secret key (`sk_test_…`). Never the live pair: the build refuses them.
4. **You: create the Vercel project.** Import `shanelabountyai/turnstile`; framework preset Next.js; leave the build
   command empty (Vercel picks up `vercel-build`); production branch `main`. Decide the address (a `*.vercel.app` name
   or your own subdomain, as Earmark has) and add the domain. **Done:** the address is `https://turnstile.labintelligence.co`.
   The import starts a first build. **It is meant to fail**: with nothing set it stops at step 1 of the build and lists
   the missing names. Nothing is migrated, seeded or served.
5. **You: create the Stripe webhook endpoint (test mode).** URL `https://turnstile.labintelligence.co/api/checkout/webhook`; events
   `payment_intent.succeeded` and `payment_intent.payment_failed`. Copy its signing secret (`whsec_…`).
6. **You: set the 11 variables** in Vercel → Project → Settings → Environment Variables, **Production** only, from the
   table above.
7. **You: first deploy.** Vercel → Deployments → the failed one → Redeploy. In the build log, in this order:
   `deploy-env: OK`, Prisma applying the migrations (25 on a new database), `seed-hosted: demo accounts and the fixture
   event are in place` with six accounts and `acme` and `globex` each `loaded 216 seats and 700 customers`, then the
   Next.js build. If Vercel reports the build as skipped by the Ignored Build Step, push any commit that changes a
   non-doc file to `main` instead (the diff check skips a build with nothing new in it; this run could not test
   Vercel's behaviour on a redeploy).
8. **You: smoke check.** In a private window:
   1. `https://turnstile.labintelligence.co/` asks for a password (any username, the `DEMO_ACCESS_PASSWORD` value). Without it: 401.
   2. `https://turnstile.labintelligence.co/api/health` shows `{"ok":true}`.
   3. `https://turnstile.labintelligence.co/demo` lists six accounts.
   4. Walk the README's "Try the live demo" steps once, top to bottom. Step 3 is the first real Stripe test payment
      this app has ever taken (EVAL O-8): if the tickets do not appear within a minute of paying, open the webhook
      endpoint's delivery log in Stripe and read the response code (200 = verified and applied; 400 = signature:
      the secret is wrong; 503 = `STRIPE_WEBHOOK_SECRET` not set in that deployment; 404 = the event id in the
      PaymentIntent's metadata is not in this database).
   5. Record the PaymentIntent id and the Refund id in `docs/EVAL.md` (O-8). Until that is done, say "Stripe boundary
      tested against recorded payloads and a fixture signing secret", not "works with Stripe".
9. **Done 2026-11-21 (closeout run):** the address is in `README.md` ("Try the live demo") and in this file, and the
   README says the site is live behind a shared password the owner gives out. **You:** decide how a hiring manager gets
   the password; it must not be written in the repository.
10. **Recorded 2026-11-21 as D-52** (supersedes D-36): Vercel usage read from Vercel's billing API, read-only; Neon could
    not be read from a cloud session. **You:** read Neon's usage page for project `turnstile` once and add the figure to
    D-52's row (or a new row).

## The daily cron

`vercel.json` schedules `GET /api/cron` once a day at 06:00 UTC. With `CRON_SECRET` set, one call does the template's
housekeeping: it deletes expired rate-limit rows, builds and sweeps any requested data exports, drains and sweeps the
outbox, sweeps SSO state rows and re-checks SSO domains, and delivers queued API webhooks. On a freshly seeded Turnstile
every one of those counts is 0 (checked on a production build, 2026-11-20): Turnstile's own notices are parked
undrainable (D-33), the demo accounts are refused exports, and there is no SSO provider or API key.

**Since PRD-3 (D-70, D-73) the same call also runs two Turnstile jobs**, after the template's, and their counts are
in the same JSON answer and the `cron.done` log line:

- `refunds`: refunds Stripe has not confirmed are sent again, but only those the job can show are under 23 hours old
  (Stripe replays an idempotency key for 24). The rest are counted as `needsOwner` and never retried automatically.
- `demoReset`: **only when `DEMO_MODE=1`, every night, the Turnstile tables are emptied and both demo orgs are loaded
  again**, with the event clock at sales open. It answers `{ "ran": false, "why": … }` and changes nothing while a
  refund is unconfirmed, while a PaymentIntent could not be cancelled, if the fixture files cannot be read, or if
  rows exist outside the two demo orgs. Demo accounts, sessions, the audit log and the outbox are not touched.

Neither job has run on Vercel: both are tested on a local production build with recorded Stripe. **You: after the
first night, read the cron's log line** (`cron.done`, fields `refunds` and `demoReset`).

- **Must it be on for the demo?** No step of the walk depends on it, but the nightly reset does: with the cron off, a
  spent demo org stays spent until the hand reset below.
- **Left on (the default here, D-48):** one function call a day, which also wakes the database once a day. The only
  thing it accumulates work for over time is the rate-limit table. Check the plan's own cron and compute limits when
  you create the project; this run did not look up prices.
- **Left on without `CRON_SECRET`:** cannot happen through a build (step 1 refuses), but a deployment that lost the
  variable would answer the daily call 401 and sweep nothing.
- **Turning it off:** delete the `crons` block from `vercel.json` (a code change, so it deploys). Nothing in the demo
  breaks; rate-limit rows are then never deleted.

## Resetting the demo

**Since PRD-3 the demo resets itself every night** (D-60, D-73: the `demoReset` job in the daily cron, 06:00 UTC,
demo mode only). The hand reset below still works and is the fallback when the nightly one refuses (its answer says
why) or the cron is off. If it refuses because a refund is unconfirmed, look at the Ledger's "Refunds not yet confirmed
by Stripe" line and the PaymentIntent's refunds at Stripe before wiping anything: the row is the record that money is
owed.

The demo database is shared and is not reset between visitors during the day. Two things wear it out:

- **The event clock only moves forward once commands exist (D-35).** The demo's last step moves it to show night so the
  door opens. Sales close one hour after doors, so about an hour later nobody can buy in that org again. The README
  points the next visitor at the second demo org (`globex`, its own copy of the event and its own clock); when both are
  spent, the demo needs a reset. This is the open decision D-49.
- Seats and tickets sell. 800 floor tickets and 216 balcony seats per org are plenty for a demo, but they do not come back.

**You: to reset (about two minutes).** In Neon's SQL editor, run exactly:

```sql
TRUNCATE "Event", "Pool", "Tier", "Section", "Seat", "Hold", "Payment", "Order", "Ticket", "WaitlistEntry", "Refund", "CommandLog", "Customer";
```

then start a new Production build (step 7). The seed finds no event and loads both again. **Before 2026-12-01 10:00
(Chicago)** it puts the clock back at the moment sales open. **From then on it leaves the clock on the wall clock** (offset 0), so the demo
then runs on the real 2027 dates below; until the D-60 seed change lands, set the clock by hand on the Event page after a reset.
The demo accounts and the audit log are not touched. This deletes every synthetic order and ledger line; that is the
point of it, and it is why no button or script in the app does it.

**The demo's calendar end (review item 18, CODE-9, UX-18).** The event clock is the wall clock plus the event's stored
`clockOffsetSeconds`, and it keeps ticking with nobody touching it. On the event clock, EARLY goes off sale at
2027-01-16 00:00, ADV at 2027-03-20 17:00, and sales close at 2027-03-20 20:00 (`fixtures/event.json`). The real date
each one arrives is that time minus the offset, which differs per org and depends on when the event was first loaded
(read it from the `Event` row). The README walk's refund figures assume the event clock is more than 30 days before
the show (2027-02-18 20:00 on the event clock). D-60's nightly reset is decided but not built; until it lands, these
dates stand. `e2e/hosted-demo.spec.ts` does not depend on them: it puts its freshly seeded events at sales open itself.

## Rolling back

- **A bad deploy:** Vercel → Deployments → the last good one → promote it (Instant Rollback). Environment variables are
  bound to each deployment, so the old deployment runs with the values it was built with.
- **Migrations are not rolled back** by promoting an older deployment. This pull request adds none, so the first
  deploy has nothing to undo; for a later migration, write a forward fix.
- **Taking the demo down without deleting anything:** pause the Vercel project, or remove the production domain.
  Removing `DEMO_ACCESS_PASSWORD` and redeploying does not work as an off switch: the build refuses it.
- **Undoing this pull request:** revert its merge commit. No schema or data change to undo.
- **Removing everything:** delete the Vercel project, the Neon project and the Stripe test webhook endpoint. Then
  D-36's baseline (nothing bills) is true again.

## What was and was not checked (2026-11-20, cloud sandbox)

Checked here, on a production build against local Postgres 16:

- The build's step 1 with nothing set: exit 1 and the eight lines of names; with a complete made-up set: `deploy-env: OK`.
- Step 3 on a freshly migrated empty database, twice: first run loads both orgs, second run changes nothing.
- A production-mode server (`VERCEL_ENV=production`, made-up values): `/demo` 401 without the password and 200 with
  it, six accounts listed, `/api/cron` 401 without and 200 with its secret, the webhook reachable without the password;
  with `VERCEL` set and no password, 503.
- The demo walk end to end (`e2e/hosted-demo.spec.ts`), and the whole e2e suite (36 tests), with and without the gate.

Not checked, because this run had no Vercel, Neon or Stripe access and must not have:

- **Step 2 of the build here.** `prisma migrate deploy` cannot run in the sandbox (the Prisma schema engine download is
  refused); CI runs it against a new Postgres 17 on every push, and the databases here were migrated with `psql`.
- Anything on Vercel: that `vercel-build` is picked up, the Ignored Build Step on a redeploy, the cron actually firing.
- Anything on Neon: the pooler with the cast path's advisory locks, the owner role's `BYPASSRLS`, cold-start latency.
- Anything against Stripe: Elements, a real test PaymentIntent, a real signed webhook, a real refund. The e2e uses the
  repo's recorded Stripe double and a webhook signed with the published fixture secret.

## What the closeout run read on 2026-11-21 (read-only, Vercel API)

- Project `turnstile` (`prj_R8tHcbt7cieNW03VfYsks4rQawUW`): framework Next.js, Node 26.x; domains
  `turnstile.labintelligence.co`, `turnstile-eta.vercel.app` and two Vercel-generated aliases. Vercel Authentication is on
  for every deployment URL except custom domains (`all_except_custom_domains`), so the `*.vercel.app` addresses ask for a
  Vercel login before the app's own password; the custom domain answers with the app's password gate.
- Deployments: three Production builds of `9d8b434` on 2026-11-21 (12:23 ERROR, 12:31 ERROR, 12:35 READY, Central time).
- Runtime errors since the deploy: none reported (`get_runtime_errors`, 2-day window).
- Runtime logs since the deploy: five function requests in all; four to paths the app does not have, which look like
  internet scanners on the custom domain (`/robots.txt`, `/assets/js/qr_modal.js`, `/css/support_parent.css` at 22:56 UTC)
  plus `/` and `/favicon.png` on the deployment URL at 18:36 UTC. **No request to `/demo`, `/api/health`, any `/o/…` page or
  `/api/checkout/webhook` appears**, which matches step 8 not being reported done. (A request the password gate refuses may
  not reach a function log; this is not proof of who visited.)
- Not read: the live pages themselves (the cloud session's egress cannot reach the site, and share links stop at the
  password gate), environment variable values (never), Neon, Stripe.

**Merging a docs-only pull request:** `vercel.json`'s `ignoreCommand` skips a Production build when only `docs/` or `*.md`
changed, so merging the closeout PR should start no build. Not verified on Vercel by this run.
