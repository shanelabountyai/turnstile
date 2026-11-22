# Code lens — Turnstile live release (main 9d8b434)

Scope: correctness, edge cases, error handling, races, per-request cost, dead code, test coverage, and the repo's own rules, on the live surface (src/checkout/**, the event server actions, the webhook route, deploy scripts, vercel.json, src/proxy.ts). Read-only; nothing in the repo was changed.

## What ran

| Check | Result |
|---|---|
| `npm run typecheck` | clean (rc 0) |
| `npm run lint` | clean |
| `npm run inventory:eval` | "7 expected files and expected_summary.json match (2662 commands)", commitment `d4d64203…61d43` |
| `npx vitest run tests/inventory tests/checkout/{deploy-env,clock,format,gate}.test.ts` | with no env: 3 files fail at import ("Invalid environment: DATABASE_URL, AUTH_SECRET, APP_URL"). With dummy non-secret values for those three: **7 files, 52 tests passed** |
| Node `Intl` check of the America/Chicago label across DST | reproduced the jump used in CODE-10 |

Not run: DB-backed vitest files (cast, guards, read, load, notices, seed-hosted, webhook), e2e, anything on Vercel, Neon or Stripe. `.env.local` was not opened.

---

## Blocker

### CODE-1 — Stripe idempotency keys from engine-minted ids collide across the two demo orgs and after every reset
- **Severity:** Blocker
- **Where:** `src/checkout/stripe.ts:32` (`idempotencyKey: a.holdId`), `:37` (`idempotencyKey: a.refundId`); ids minted in `src/inventory/engine.ts:203` (`O-${pad(nOffer,4)}`) and `:469` (`R-${pad(nRefund,5)}`); counters start at 0 for each event (`engine.ts:76-77`); `scripts/seed-hosted.ts:18-25` loads the same fresh event into `acme` and `globex`; `docs/DEPLOY.md` "Resetting the demo" truncates and reseeds.
- **Observed:** Stripe idempotency keys are scoped to the Stripe account, not to the org or event, and last 24 hours. Both demo orgs use one Stripe test account (one `STRIPE_SECRET_KEY`), and each org's event mints the same sequence: the first refund in each org is `R-00001`, the first waitlist offer in each is `O-0001`. Cart holds are safe (`H-` + 8 random hex chars, `buy/actions.ts:39`). Refund and offer keys are not.
- **Why it matters:** The README walk has a refund at step 5 and sends the next visitor to `globex` once `acme` is spent (step 7). The first `globex` refund within 24 hours of the first `acme` refund sends `R-00001` with a different `payment_intent`. Stripe rejects a reused key with different parameters with an idempotency error. That error is not a `StripeProviderError`, so `settleRefunds` rethrows it (`checkout.ts:61`), after the REFUND_REQUEST cast has already committed. The visitor gets the error page, the ledger shows $38.49 refunded, and Stripe has no refund. The same happens to `R-00002`, `R-00003`, …, to the first offer payment in the second org (`O-0001` with different metadata, so the offer cannot be paid until the key expires, and the offer TTL is also 24 h), and to both orgs after every D-49 reset within 24 hours. Combined with CODE-3, nothing retries.
- **Recommended fix:** Make every key unique to the account. Build it at the boundary as `${eventId}:${holdId}` and `${eventId}:${refundId}` (the event's UUID). The engine and the fixtures stay as they are; only `StripeLive` changes. Add a test that two orgs' first refunds produce different keys. Record the change under D-23.
- **Verified** by reading the code path end to end. Stripe's account-wide 24-hour idempotency rule is Stripe's documented contract and was not exercised here (no network).

## Major

### CODE-2 — A declined card followed by a good card captures money with no tickets and no refund (breaks non-negotiable 4)
- **Severity:** Major. It could be argued as Blocker: it contradicts the project's headline rule, but only in test mode and only after a decline.
- **Where:** `src/components/stripe-pay.tsx:27-34`; `src/inventory/engine.ts:402-415` (PAY_FAILED is terminal) and `:360` (`p.state !== 'PENDING'` → `PAYMENT_DUPLICATE`); `src/checkout/checkout.ts:40` (refunds only on `PAID_AFTER_TIMEOUT`/`_CANCEL`).
- **Observed:** When Stripe declines a card, `confirmPayment` returns an error. The component shows it and re-enables the same form on the same `clientSecret`. Stripe sends `payment_intent.payment_failed`. The engine moves the payment to `FAILED`, the hold to `PAY_FAILED` (terminal) and returns the inventory. A Stripe PaymentIntent whose attempt failed returns to `requires_payment_method` and can still be confirmed. If the visitor tries again with 4242, Stripe captures the money and sends `payment_intent.succeeded`. The engine answers `PAYMENT_DUPLICATE` (a no-op), so no order is created and no refund is issued.
- **Why it matters:** Late money must be refunded and never seated (CLAUDE.md non-negotiable 4). Here it is kept silently. The ledger reads only `SUCCEEDED*` payments (`read.ts:93`), so it does not show the capture, and Stripe and the ledger disagree. "Try a decline card" is an ordinary reviewer move.
- **Recommended fix:** The smallest fix sits at the boundary. When a PAY_FAILED cast returns `PAYMENT_FAILED_RELEASED`, cancel the PaymentIntent (`paymentIntents.cancel`) so it cannot be confirmed again. Also make the form stop after an error and reload the page. Alternatively, treat a success on a `FAILED` payment as late money with a full refund. That is an engine rule change (new code, `docs/decisions.md` first, fixtures regenerated), so it is the owner's call. Add a recorded test for decline then success.
- **Verified** by reading. The Stripe-side retry behaviour is documented PaymentIntent lifecycle and was not exercised.

### CODE-3 — Production has no refund retry: PENDING_PROVIDER only exists with the test double
- **Severity:** Major
- **Where:** `src/checkout/checkout.ts:52-65`, `src/checkout/stripe.ts:36-39,45,59`; `src/app/o/[org]/events/[event]/box/actions.ts:28`; `src/app/cron-jobs.ts` (no Turnstile job).
- **Observed:** `settleRefunds` swallows only `StripeProviderError`. Only `StripeRecorded` throws that class (`stripe.ts:59`). `StripeLive` throws the `stripe` package's own errors, which are rethrown, and the loop stops at the first failure. In production a Stripe failure on a box-office refund therefore throws after the cast committed, and the user sees "Something went wrong". Pressing Refund again is rejected by the engine, because the ticket is already `REFUNDED`, and `settleRefunds` runs only on a `REFUNDED` result. Nothing else retries: there is no cron job, no button, and no screen reads `stripeRefundId`, so an unsettled refund is invisible while the ledger counts it as refunded. The only accidental retry is on the webhook path: a throw there returns 500, Stripe redelivers, the CommandLog dedupe returns the stored `PAID_AFTER_*`, and `settleRefunds` runs again. That sweep also picks up any box-office rows left NULL in the same event.
- **Why it matters:** D-23 promises "a Stripe failure leaves a Refund row in PENDING_PROVIDER for retry". The test (`webhook.test.ts:116`) proves that only for the double. With CODE-1, this is the path the second org's refunds take.
- **Recommended fix:** Map `StripeLive` failures. Treat connection, rate-limit and API errors as pending. Treat an idempotency error as a bug and log it loudly. Keep the loop going past one failure. Return pending counts to the action and show "refund recorded, Stripe pending" instead of throwing. Add a retry: a clone job in `cron-jobs.ts` that calls `settleRefunds` for every event with NULL `stripeRefundId` (the cron already runs daily), plus a Ledger badge for unsettled refunds. Note the 24-hour key window: a retry after 24 hours is a new request to Stripe.
- **Verified** by reading.

### CODE-4 — The error-page family: every throw except `Refused` replaces the screen with "Something went wrong"
- **Severity:** Major
- **Where:** `src/core/authz/action.ts:29-34` (only `Refused` becomes `{ error }`; `requireOrg` runs outside the try); `src/app/error.tsx`; clone call sites below.
- **Observed:** The known case is `AuthzError` on Set clock for a member. The same mechanism covers:
  1. `payHold` → `payStart` → `StripeLive.createPaymentIntent` errors (`checkout.ts:23`): Stripe outage, auth, rate limit, the CODE-1 key collision on an offer, and a double-click on Pay. Two concurrent requests with one idempotency key: Stripe answers the second with a "request in progress" conflict. The hold stays HELD, so a retry works, but the visitor sees the error page.
  2. `confirmRefund` → Stripe refund errors after commit (CODE-3).
  3. `PaymentAmountMismatch` (`checkout.ts:25`), thrown after the PAYING cast committed.
  4. Any Prisma failure. `db.$transaction(fn)` (`src/core/db/rls.ts:16`) uses Prisma's default interactive-transaction limits (maxWait 2 s, timeout 5 s; no options are passed). Every cast and every page read (`readEvent`) is such a transaction, so a slow Neon wake from suspend, or a cast waiting on another cast's advisory lock, ends as P2028 → error page. Suspected for Neon, which was not measured.
  5. The Buy page render itself: `stripe.clientSecret()` is called per PAYING hold of the acting customer (`buy/page.tsx:69`) with no catch, so a Stripe hiccup takes down the whole Buy page, not just the pay form.
- **Why it matters:** The walk's money steps (3, 4, 5) are exactly where these occur. The error page gives a digest and nothing actionable, and on refund it hides the fact that the refund was recorded.
- **Recommended fix:** In the clone (no template edit), wrap the Stripe and DB calls in the three action files. Convert known failures into a `Refused`, or return `{ error }`, with plain words: "Stripe did not answer; your hold is still yours, try Pay again"; "Refund recorded; Stripe will be told". Catch `clientSecret` failures per hold and render "payment form unavailable, refresh". Pass explicit `{ maxWait, timeout }` where the clone opens transactions (`castCommand`, `hydrated`) or retry P2028 once. The `requireOrg` refusal is the known AuthzError item, so hide the Set clock form for roles without `org.update`.
- **Verified** (1, 2, 3, 5) by reading. **Suspected** (4, Neon timing).

## Minor

### CODE-5 — Per-request cost: about 17 sequential DB round trips per page read, more than 20 per command, all on one pooled connection
- **Severity:** Minor
- **Where:** `src/checkout/read.ts:116-127`, `src/checkout/cast.ts:30-38,118-160`; `box/page.tsx:34,45`.
- **Observed (count by reading, not measured):** `readEvent` opens a transaction with BEGIN, `pool.findMany`, one `pg_advisory_xact_lock_shared` per pool (2 pools), `commandLog.findFirst` and `loadRows`, then COMMIT. `loadRows` is 8 queries, and `event` with `include` of pools, tiers and sections is 4 separate queries, because the schema does not enable `relationJoins`. That is about 17 statements. The `Promise.all` inside an interactive transaction does not parallelise: one connection runs them in turn. Add `requireOrg`, `eventByKey`, and on Buy `customer.findMany` (700 customers). A Box page with a picked order hydrates twice (`readEvent` + `previewRefund`). A command adds `castCommand`: BEGIN, pools, 2 locks, `seen`, `last`, `loadRows` (11), the CommandLog insert, `set_config`, one UPDATE per changed row (sequential `for … await`), the notice lookup, then COMMIT. That is 20+ statements, and the redirect then re-reads the page. Every read loads the whole event (all 216 seat rows, every hold, payment, order, ticket, entry and refund), so the payload grows as the demo is used.
- **Why it matters:** On Neon through the pooler, page latency ≈ RTT × statement count. It is cheap if the Vercel function region and the Neon region match, and a mismatch multiplies it by the RTT. Region placement was not checked (no access). Long transactions also widen the window for the 5-second default timeout in CODE-4.
- **Recommended fix:** Measure first: log the duration of `hydrated` and `castCommand` on the live site. Cheap wins: lock one key per event (`hashtext(eventId)`) instead of per-pool, which drops the `pool.findMany` and one lock (D-22 already says one lock per event in practice). Load the event, pools, tiers and sections in one query. Keep Vercel and Neon in the same region. Do not hydrate twice on Box.
- **Verified** (count). **Suspected** (latency impact).

### CODE-6 — The webhook route answers 404/500 to signed events it does not own, before checking the signature
- **Severity:** Minor
- **Where:** `src/app/api/checkout/webhook/route.ts:21-23`.
- **Observed:** The event lookup runs before `applyWebhook` verifies the signature. A `payment_intent.*` with no `metadata.event_id` (a PaymentIntent created by anything else on the same Stripe test account) gets 404. A non-UUID `event_id` makes Prisma throw on the `@db.Uuid` column, which is an unhandled 500.
- **Why it matters:** Stripe retries non-2xx deliveries for days and can disable an endpoint that keeps failing. If the test account is shared with another portfolio project, Turnstile's endpoint could be turned off and tickets would stop being issued. Whether the account is shared is unknown. Unauthenticated requests can also produce 500s in the logs.
- **Recommended fix:** Verify the signature first (the secret does not depend on the event). Then answer 200 `ignored: not a Turnstile PaymentIntent` for missing or unknown metadata, and validate `event_id` as a UUID before the query.
- **Verified** (code). **Suspected** (endpoint disablement, which depends on account sharing).

### CODE-7 — The gateway falls back silently to the recorded double at runtime, and the two paths choose differently
- **Severity:** Minor
- **Where:** `src/checkout/stripe.ts:21`; `buy/actions.ts:29`, `box/actions.ts:28` vs `webhook/route.ts:27` (always `StripeLive`).
- **Observed:** `stripeGateway()` returns `StripeRecorded` when `STRIPE_SECRET_KEY` is unset. The build checks the key (D-45), but a runtime environment can differ from the build's, for example after a variable is removed. In that case PAY_START records a fake `pi_rec_…` PAYING hold, no form appears (`clientSecret` → null), and the hold times out 30 minutes later. Refunds would get fake `re_rec_…` ids, and the ledger would show them as settled.
- **Recommended fix:** On Vercel (`VERCEL_ENV=production`), make `stripeGateway()` throw instead of falling back. Keep the fallback for local and e2e runs.
- **Verified** by reading.

### CODE-8 — seed-hosted is not atomic between loading the event and setting its clock
- **Severity:** Minor
- **Where:** `scripts/seed-hosted.ts:25-34`.
- **Observed:** `loadFixtureEvent` commits in its own transaction, and the offset is written in a second one. If the second fails (a timeout during the build), the build fails, but the event is already loaded with offset 0. Every later build sees `AlreadyLoaded` and never sets the clock. Before 2026-12-01 10:00 Chicago, that org's Buy screen then cannot sell.
- **Recommended fix:** Set `clockOffsetSeconds` inside `loadFixtureEvent`'s transaction, or have the seed set it whenever the event's CommandLog is empty and the offset is 0.
- **Verified** by reading.

### CODE-9 — The live demo and `hosted-demo.spec.ts` have a calendar end date
- **Severity:** Minor
- **Where:** `fixtures/event.json` (ADV off sale `2027-03-20T17:00:00`, EARLY off sale `2027-01-16T00:00:00`, sales close `2027-03-20T20:00:00`); `scripts/seed-hosted.ts:30-32`; `e2e/hosted-demo.spec.ts:50`.
- **Observed:** The event clock is the wall clock plus the offset seeded at the first build (sales open minus build time, about 10 days if built 2026-11-21). The clock keeps ticking, so the live demo stops selling ADV about that many days before 2027-03-20 17:00 in real time, with nobody touching it. A D-49 reset after 2026-12-01 seeds offset 0, which moves the end to the real 2027-03-20. In e2e, the hold/release branch silently stops running once the wall clock passes 2026-12-01 10:00, which is 9 days from today. The walk's ADV and BALC steps fail once the wall clock passes the off-sale times.
- **Recommended fix:** Record the end date in D-49 and DEPLOY.md. For e2e, set the clock explicitly on the fresh database (allowed on an empty log) instead of depending on the wall clock.
- **Verified** by reading.

### CODE-10 — The event clock jumps at DST changes
- **Severity:** Minor
- **Where:** `src/checkout/clock.ts:6-16`.
- **Observed:** `axisNow` labels the wall clock in America/Chicago. Reproduced: `2027-03-14T07:59:59Z` → `01:59:59`, one second later → `03:00:00` (+3601 s on the axis). `2027-11-07T07:00:00Z` → `01:00:00` again (−3599 s). On spring-forward, every HELD cart and PAYING timeout loses an hour at once. On fall-back, the clock runs behind the log for an hour, `stampAfter` stamps every command at the log's last second +1, and readEvent freezes. With the current seed offset, the spring jump lands after the show on the event axis. With offset 0 (after a reset) or a staff-set clock, it lands during sales.
- **Recommended fix:** Derive the axis "now" from a fixed UTC offset stored on the event, or from UTC plus a stored offset, instead of the zone's current offset. Otherwise, document it in D-34/D-35.
- **Verified** (label jump reproduced with Node `Intl`).

### CODE-11 — payStart checks the hold outside the lock against rows that have not been advanced
- **Severity:** Minor
- **Where:** `src/checkout/checkout.ts:17-25`.
- **Observed:** Expiry is persisted only by the next cast (D-31), so the stored `hold.state` can read `HELD` for a hold that has already expired. payStart creates a live PaymentIntent, and then the cast rejects `HOLD_EXPIRED`, leaving an orphan PaymentIntent. The code comment acknowledges this. The amount check throws `PaymentAmountMismatch` after the PAYING cast committed, so if it ever fires, the user sees the error page while their hold is PAYING.
- **Recommended fix:** Before calling Stripe, run the same in-memory check `previewRefund` uses (hydrate, advance, apply in memory). Cancel the PaymentIntent on a reject. Do the amount comparison before the cast, from that preview.
- **Verified** by reading.

### CODE-12 — Tests cover the double, not the live contract
- **Severity:** Minor
- **Where:** `tests/checkout/webhook.test.ts:116`; `docs/EVAL.md:174`.
- **Observed:** The PENDING_PROVIDER test passes only because `StripeRecorded` throws the clone's own error class (CODE-3). No test covers decline then success (CODE-2), idempotency-key uniqueness across orgs or events (CODE-1), or a throwing gateway in an action (CODE-4). Every e2e payment uses the recorded double. EVAL.md still says the O-8 live round trip is "Not yet run", though the site has been live since 2026-11-21.
- **Recommended fix:** Add recorded-boundary tests for the three gaps. Record the O-8 round trip, including one refund in each org, which would have surfaced CODE-1.
- **Verified** by reading.

### CODE-13 — Small dead or misleading code
- **Severity:** Minor (nit)
- **Where:** `webhook/route.ts:27` and `checkout.ts:32-38`: `at` is computed and passed, but ignored whenever `clock` is passed, which is always on that route. `checkout.ts:1-5` and the D-23 text describe a retry that does not exist live (CODE-3). In `actions.ts:27-28`, the "not before the log" check reads the log outside the cast lock. That is harmless, because `stampAfter` and `readEvent` clamp, but the refusal is only advisory.
- **Recommended fix:** Drop `at` from the route call or document it as the explicit-time path. Correct the comments when CODE-3 lands.
- **Verified** by reading.

---

## Checked and clean
- **Advisory locks:** `pg_advisory_xact_lock` / `_shared` are transaction-scoped, so they are compatible with a transaction-mode pooler. Locks are taken in sorted pool order. Readers take them shared, so no torn read and no reader-reader blocking.
- **Ordering:** `stampAfter` keeps the CommandLog in `(at, cmd_id)` order under concurrency, and is tested (`clock.test.ts`). `CommandOutOfOrder` cannot be reached from the UI or the webhook, which both pass `clock`.
- **Dedupe:** idempotent on `cmd_id` (`cast.ts:122-123`). A webhook replay returns the stored result, and `PAID_AFTER_*` re-settles on replay.
- **Engine rules:** expiry runs before the command (engine `apply` → `advance`, verified by the eval match). PAYING is on `pay_timeout_at`, not the cart TTL. `available` is derived in `eventView` from the engine and never stored (no count columns in `turnstile.prisma`). Integer cents throughout: `dollars`/`percent` slice strings. No `new Date(string)` in clone code; `new Date()` appears only as the wall-clock input to `eventNow`.
- **Builds:** `vercel-build.mjs` runs its steps in order, exits with each step's code, migrates with `MIGRATE_URL` only, and does nothing on Preview. `deploy-env.ts` prints names only and requires test-mode prefixes.
- **vercel.json:** the `ignoreCommand` logic is correct (exit 0 skips non-production and docs-only diffs; a missing previous SHA builds). The cron is daily and exempt from the gate, with `CRON_SECRET` required.
- **Gate:** the `src/proxy.ts` matcher excludes only static assets. The gate exemptions are exact or prefix matches, and tested.
- **Reset:** the D-49 `TRUNCATE` is not blocked by the Turnstile guards (row triggers; the migration comment confirms TRUNCATE is left alone).

## Not reviewed
- DB-backed tests, e2e, and `inventory:eval:db` (not run; they need Postgres).
- Live site, Vercel settings and region, Neon latency and cold start, Stripe dashboard and webhook endpoint state.
- Security and authorization questions, for the security lens. One pointer: the refund, hold and pay actions use `orgAction(null, …)`, so any member can refund.
- Template-owned code beyond how the clone uses `orgAction`, `withOrg` and the error page. UI copy, accessibility and design.
- README accuracy. Outside this lens, but note the README still opens with "The site is not live yet".
