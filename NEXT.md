# NEXT

## ▶ 2026-11-10 (Phase 3 task 3.9, Sonnet 5.5): Accessibility and e2e gate built. Next: 3.10 EVAL.md Phase 3 section + closure deliverables.

Built: `e2e/axe.ts` (Quorum's `expectAccessible`, light and dark, premise text checked first; axe-core from the lockfile, no dependency added) and `e2e/a11y.spec.ts` (design, events list, event, buy, box, door, ledger over the cast end state; `bypassCSP`). Phase 3 exit grep: `inventory:lint` now also scans `.tsx` under `src/app/o/**/events/` for float, `reduce` and binary arithmetic; it found one (door "still to arrive" = live − checked in), moved to the read model as `ledger.toArrive` (asserted in read.test.ts). Mutation (put the subtraction back) → lint red.
Gate (local): lint 0 · typecheck clean · inventory:lint OK (12 engine files, 6 screen files) · foundation:drift clean · `npm test` 50 files, 341 passed, 33 skipped, 0 failed · full e2e on the production build 25 passed, 0 failed, 0 flaky · axe 0 violations on 7 pages × 2 schemes. Engine and cast untouched (`read.ts` gained one derived field), so inventory:eval / eval:db not rerun. CI decides.
Not looked at in a browser by eye (axe does not judge layout).
Next session: 3.10 `docs/EVAL.md` Phase 3 section, then the closure deliverables (DEMO.md run command by command, exec brief, LinkedIn posts, cost review). Sonnet is enough for the EVAL section; the closure items are writing.

---
## ▶ 2026-11-10 (Phase 3 task 3.8, Opus 5.5): Outbox notices built. Next: 3.9 Accessibility and e2e gate.

Built: `src/checkout/notices.ts` (`queueNotices`; templates `turnstile.order_confirmed`, `turnstile.offer` registered at runtime into the foundation's record), called in `castCommand` after the delta, so notices commit with the command. Rows go in with `attempts = MAX_ATTEMPTS` (D-33) and `lastError` saying why; no template-owned file edited. `inventory:eval:db` now counts and checks the outbox.
Gate (local): lint 0 · typecheck clean · inventory:lint OK · foundation:drift clean · inventory:eval match · `npm test` 50 files, 341 passed, 33 skipped, 0 failed · `notices.test.ts` 2 passed (drain sends 0, `sendEmail` never called; mutation `attempts: 0` → red) · `inventory:eval:db` 2,662 commands in 33.2 s, readEvent = recount = replay = expected, commitment `d4d64203…61d43` unchanged; outbox 451 confirmations = orders, 5 offer notices = offers_made, 0 sent or drainable (in EVAL.md). No e2e touched.
Next session: 3.9 Accessibility and e2e gate (axe on every Turnstile page, Quorum pattern; production build; then the `inventory:lint` grep for arithmetic in `src/app/o/**` from the exit criteria). Sonnet is enough: test wiring, no rule.

---
## ▶ 2026-11-10 (Phase 3 task 3.7, Opus 5.5): Ledger built. Next: 3.8 Outbox notices.

Built: `/o/[org]/events/[event]/ledger` + `…/ledger/csv` (linked from the event page). One line per captured payment (late money has no order, so per-order lines would miss one refund); `EventView.payments` + `ledgerCsv` in `src/checkout/read.ts`, writer is core's `toCsv`.
Gate (local): lint 0 · typecheck clean · inventory:lint OK · foundation:drift clean · `npm test` 49 files, 338 passed, 33 skipped, 1 failed: INV-01 on `buy/actions.ts#releaseHold` ("rows changed"), because the e2e run was writing to `turnstile_test` at the same time (my mistake); alone it passed 14/14 · `read.test.ts` 8 passed: CSV sums 4,618,132 / 137,682 / 4,480,450 ¢ · e2e `ledger.spec`, `event.spec` 2 passed (production build). No engine or cast change, so inventory:eval / eval:db were not rerun. Full e2e: CI.
Lesson: vitest and e2e share `turnstile_test`; never run them at once.
Next session: 3.8 Outbox notices (D-33): order confirmation + offer notice written in the cast transaction, worker skips them, drain test, outbox counts after eval:db in EVAL.md. Opus: it touches the cast transaction.

---
## ▶ 2026-11-10 (Phase 3 task 3.6, Opus 5.5): Door built. Next: 3.7 Ledger.

Built: `/o/[org]/events/[event]/door` (linked from the event page): scan by code or ticket id → one CHECK_IN cast; unknown codes are cast as typed so the engine answers TICKET_UNKNOWN; each code spelled out as a sentence (ALREADY_CHECKED_IN gives the first scan time); checked in / live / still to arrive from the read model. `castAs` moved into `e2e/turnstile.ts` (box.spec uses it).
Gate (local): lint 0 · typecheck clean · inventory:lint OK · foundation:drift clean · `npm test` 49 files, 338 passed, 33 skipped, 0 failed · e2e door, box, buy, event 4 passed (production build). No engine, cast or read change, so inventory:eval / eval:db not rerun (3.5's numbers stand). Full e2e: CI.
Next session: 3.7 Ledger (captured/refunded/net, per order, CSV export with own writer; CSV totals = 4,618,132 / 137,682 / 4,480,450 ¢). Sonnet is enough: display plus a small writer over `readEvent`; Opus if you want the money path reviewed.

---
## ▶ 2026-11-10 (Phase 3 task 3.5, Opus 5.5): Box office built. Next: 3.6 Door.

Built: `/o/[org]/events/[event]/box` (linked from the event page). Window sale hands off to the Buy screen as the chosen customer (same cast path). Waitlists per target in FIFO order, head pilled, no skip control. Refund: pick order → tick tickets → preview (`previewRefund`: the command run on the hydrated engine in memory, nothing written; shows days-before, window %, fee kept/refunded, per-ticket lines, total) → "Refund $X" casts `requestRefund` as the order's customer. Read model orders gain `states`. e2e helpers shared in `e2e/turnstile.ts` (buy.spec now uses them).
Gate (local): lint 0 · typecheck clean · inventory:lint OK · inventory:eval match · fixtures:check OK · foundation:drift clean · `npm test` 49 files, 338 passed, 33 skipped, 0 failed · `inventory:eval:db` 2,662 commands in 30.3 s, readEvent = recount = replay = expected, commitment `d4d64203…61d43` unchanged · e2e `box.spec`, `buy.spec`, `event.spec` 3 passed (production build). box.spec: preview $34.98 = cast 3498 ¢ = Refund rows 3498 ¢; waitlist head offered and paid to PAYING. Full e2e: CI.
Not looked at in a browser by eye.
Next session: 3.6 Door (check-in by code; TICKET_UNKNOWN, TICKET_REFUNDED, DOORS_NOT_OPEN, ALREADY_CHECKED_IN + a success in e2e). Sonnet is enough: one command kind, codes already exist.

---
## ▶ 2026-11-10 (Phase 3 task 3.4, Opus 5.5): Buy screen built. Next: 3.5 Box office.

Built: `/o/[org]/events/[event]/buy` (act-as picker per D-32; holds and offers with a display-only countdown; Pay / Release / Decline; PAYING shows Elements where `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is set, else "Recorded Stripe"; tickets with codes; GA quantity form; reserved seats as row lists of checkboxes; waitlist join/leave with positions). Every button casts one command and the page reads its result from the CommandLog by `cmd_id`. Stripe.js loads from js.stripe.com via `next/script` (no npm dependency added). `stripeGateway()` = live with a secret key, recorded without; `clientSecret()` on the gateway.
Decided **D-35** (Shane, this session): per-event clock, `Event.clockOffsetSeconds` (migration `…000003_event_clock`), set on the event screen (`setEventClock`, `org.update`, audited). UI and webhook casts are stamped inside the pool lock by `stampAfter`, which keeps the log in (at, cmd_id) order. The webhook route now uses the event clock too.
Found and fixed: the 3.3 event page failed FR-06 (`await params` before `requireOrg`); it would have gone red in CI.
Gate (local): lint 0 · typecheck clean · inventory:lint OK · foundation:drift clean · fixtures:check OK · migrate diff "No difference detected" · `inventory:eval` match · `inventory:eval:db` 2,662 commands in 34.8 s, readEvent = recount = replay = expected, commitment `d4d64203…61d43` unchanged · `npm test` 49 files, 338 passed, 33 skipped, 0 failed · e2e `buy.spec` 1 passed, `event.spec` 1 passed (production build). Full e2e: CI.
Not looked at in a browser by eye; live Elements is your O-8 (needs `stripe listen --forward-to localhost:7700/api/checkout/webhook`).
Next session: 3.5 Box office (Opus: refund preview must equal the cast to the cent). Add the waitlist-offer e2e there.

---
## ▶ 2026-11-10 (Phase 3 task 3.3, Opus 5.5; Sonnet was picked but no /model switch ran): Event screen built. Next: 3.4 Buy screen.

Built: `/o/[org]/events` (list) and `/o/[org]/events/[eventKey]` (pool cards, tier cards with the `available` inputs as a hover `title` plus a keyboard-reachable "How is N worked out?" disclosure, on-sale windows, rules and refund windows read-only, `SOLD_OUT_POOL` worded "pool sold out" vs `SOLD_OUT_TIER` "tier sold out", each with a one-line reason). "Events" link in the org nav. The read model gains `timezoneLabel`, the sales window and `rules` on `event`, plus `dollars()`/`percent()` (string slicing, no float path; tested). The eval:db cast loop moved to `scripts/cast-fixture.ts` (`castFixture`), shared by eval:db and the new `e2e/event.spec.ts`.
Gate (local): lint 0 · typecheck clean · inventory:lint OK · foundation:drift clean · `tests/checkout/read.test.ts` 7 passed · `inventory:eval:db` 2,662 commands in 36.1 s, readEvent = recount = replay = expected, commitment `d4d64203…61d43` (unchanged after the extraction) · `e2e/event.spec.ts` 1 passed against the production build: DOOR "87 remaining · 0 available — pool sold out", BALC "12 remaining · 12 available". Full vitest and full e2e: CI.
Not looked at in a browser by eye (layout in light/dark is Shane's).
Next session: 3.4 Buy screen (Opus recommended: hold/pay/webhook path, countdown vs server clock D-34, ORPHAN_SEAT preview).

---
## ▶ 2026-11-10 (Phase 3 task 3.2, Opus 5.5): read model built. Next: 3.3 Event screen.

Built: `src/checkout/read.ts`, with `eventView(engine, asOf)` (pure: pools, tiers with the formula inputs and `soldOut` pool-before-tier, seats per section and row, waitlists with FIFO positions and live offers, orders, ledger) and `readEvent(orgId, eventId, at)` (shared pool locks, hydrate, `advance(at)` in memory, writes nothing). `tests/checkout/read.test.ts` (6 tests): fixture end state gives FLOOR 800/800, DOOR 87 remaining / 0 available / SOLD_OUT_POOL, BALCONY 204 sold / 12 available, ledger 4,618,132 / 137,682 / 4,480,450 ¢; per-order refunds = expected_orders.csv; DB: expiry second frees holds and offers the head in the view with 0 rows written. `inventory:eval:db` now also checks readEvent = recount. Decision D-31 "as built" is recorded.
Gate (local): lint 0 · typecheck clean · inventory:lint OK · inventory:eval match · fixtures:check OK · foundation:drift clean · `npm test` 48 files, 332 passed, 33 skipped, 0 failed · `inventory:eval:db` 2,662 commands in 34.7 s, readEvent = recount = replay = expected, commitment `d4d64203…61d43`.
Next session: 3.3 Event screen (Sonnet is enough: UI wiring over `readEvent`, no new rule).

---
## ▶ 2026-11-10 (Phase 3 task 3.1, Sonnet 5.5): design system ported. Next: 3.2 read model.

Built: `src/app/turnstile.css`, `src/components/{ui,pill}.tsx`, `docs/DESIGN_SYSTEM.md`, `tools/contrast.py` (`npm run design:contrast`: OK, 0 pairs under floor, both schemes), `/o/[org]/design` reference page, root layout imports the stylesheet. Gate: lint, tsc, inventory:lint, foundation:drift clean; `next build` rc 0 and lists the design route. Not looked at in a browser (light/dark by eye is Shane's).
Next session: 3.2 `src/checkout/read.ts` (Opus: it carries the `available` formula).

---
## ▶ 2026-11-10 (Phase 2 tasks 2.7–2.8 + exit, local Mac, Opus 5.5): Phase 2 green in CI. Stopped at the Phase 3 gate for Shane's review.

Branch `phase-2` → PR #2 (base `kickoff`, unmerged).

### CI (the Phase 2 exit number)
https://github.com/shanelabountyai/turnstile/actions/runs/42848895625 — `ci (off)` and `modules-removed` green. vitest 47 files, 326 passed, 33 skipped, 0 failed; `prisma migrate diff` "No difference detected"; `inventory:eval:db` 2662 commands in 52.3 s, recount = log replay = expected, commitment `d4d64203…61d43`; Stripe recorded 484 PI / 48 refunds / 0 pending. No Stripe secret in CI.

### Built
- 2.7: `.github/workflows/ci.yml` — off leg only: `migrate diff` against a `turnstile_shadow` db, then `npx tsx scripts/inventory-eval-db.ts` (plain `tsx`, not the npm script: CI has no `.env.test`; the env comes from the job).
- 2.8: `docs/EVAL.md` Phase 2 section (eval:db, concurrency, signature, guards, CI link).
- Exit: `docs/phase-3-tasks.md` drafted — four proposed decisions D-31..D-34 (read model, act-as-customer, notices skipped by type, server clock decides) and tasks 3.0–3.10.

### Open for Shane (the Phase 3 gate)
1. Review PR #2 (and #1 underneath it).
2. Review `docs/phase-3-tasks.md`; say go (defaults D-31..D-34 take effect) or change any.
3. By hand, any time: O-8 live round trip (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` in `.env.local`), recorded in EVAL.md.

### Next session
Phase 3 task 3.0 (donor read + record D-31..D-34), then 3.1 design-system port.

---

## ▶ 2026-11-10 (Phase 2 tasks 2.5–2.6, local Mac, Fable then Opus 5.5): Stripe boundary and inventory:eval:db green. Stopped at the 2.6 gate for Shane's review.

Branch `phase-2` → PR #2 (base `kickoff`, unmerged). Pushed.

### The 2.6 gate number
`npm run inventory:eval:db` (local Postgres 17, `turnstile_test`): **2662 commands through the cast path in 33.7 s; recount from stored rows = replay of the CommandLog = the seven expected files + expected_summary.json; commitment `d4d64203ae84f69cbc2b4e42e4297ac7dc01c151465dd147b7ce4638fef61d43`** (Phase 1's). Stripe recorded: 484 PaymentIntents, 48 refund calls, 48 Refund rows, 0 pending provider. Negative proof: a scratchpad copy with K-00066 qty 8→9 exits 1 at row 67 (K-00066 REJECT vs OK); `fixtures/` untouched.

### Built
- 2.5: `src/checkout/{stripe,webhook,checkout,clock,env}.ts`, `src/app/api/checkout/webhook/route.ts` (in `cross-org.ts` with `// app`, `// public` for INV-01), `fixtures/stripe/webhook.json`, `tests/checkout/webhook.test.ts` (11: valid / tampered / wrong secret / stale ±301 s / malformed / replayed event.id / PAYMENT_DUPLICATE / PAID_AFTER_TIMEOUT issues the refund call / PENDING_PROVIDER retry / route 503-404-400 / axisNow). `stripe` 23.1.0 added.
- 2.6: `scripts/inventory-eval-db.ts`, `scripts/inventory-report.ts` (shared with `inventory:eval`, output identical).
- Found by eval:db and fixed: Seat one-tick composites in the guard; `ord` on Pool/Tier/Section; the recorded-Stripe answer per command. All recorded in decisions (D-21/D-26/D-30 as built).

### Gate output (local)
lint 0 · typecheck clean · inventory:lint OK · inventory:eval match · fixtures:check OK · foundation:drift clean · `npm test` 47 files, 326 passed, 33 skipped, 0 failed · `prisma migrate diff --exit-code` "No difference detected".

### Open for Shane (the 2.6 gate)
1. Review the 2.5/2.6 commits; note the two in-place migration edits (no deployed DB; CI's DB is ephemeral).
2. Say go for 2.7 (CI: `migrate diff`, `inventory:eval:db` on the off leg; no Stripe secret) and 2.8 (`docs/EVAL.md` Phase 2 section).
3. By hand when you want the live check: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.env.local` (O-8 round trip is yours, recorded in EVAL.md).

### Next session
2.7 then 2.8, then the Phase 2 exit: CI green linked here, `docs/phase-3-tasks.md` drafted, stop.

---

## ▶ 2026-11-10 (Phase 2 task 2.4, local Mac, Fable): cast path + two-writer test green. Stopped at the 2.4 gate for Shane's review.

Branch `phase-2` → PR #2 (base `kickoff`, unmerged). Commits: engine `hydrate` (D-28), schema trim (`Payment.paymentIntentId` dropped: `payment_id` is the `pi_…` id), `src/checkout/cast.ts` + `tests/checkout/cast.test.ts`, decisions D-22/D-28 "as built".

### Gate output (local, 2026-11-10)
- `npx vitest run tests/checkout`: 3 files, 18 tests passed (guards 9, load 2, cast 7 — the race: `['HELD','SOLD_OUT_POOL']`, log statuses `['OK','REJECT']`, held qty 10 of pool 10).
- `npm test`: 46 files, 315 passed, 33 skipped (RLS-enforce leg), 0 failed.
- `inventory:eval`: 7 files match, 2662 commands, commitment unchanged after adding `hydrate`. `inventory:lint` OK (12 files). `fixtures:check` OK. `lint` 0 problems. `typecheck` clean. `foundation:drift` clean. `prisma migrate diff --exit-code` rc 0 (shadow `turnstile_shadow`).
- Both local databases were dropped and re-created (`dropdb`/`createdb` + `migrate deploy`) after the schema trim; `prisma migrate reset` refuses to run from Claude Code.

### Open for Shane (the 2.4 gate)
1. Review `src/checkout/cast.ts` (lock-all-pools, D-22 as built) and `Engine.hydrate`.
2. Say go for 2.5 (Stripe boundary). **Before 2.5 runs live, add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to `.env.local` yourself** — the build never asks for them and never reads them in tests.

### Next session
2.5: `src/checkout/stripe.ts` (interface; `StripeRecorded` from `fixtures/stripe/*.json`; `StripeLive` on the official `stripe` package — ask-before-add is satisfied by D-5/D-30), `verifyStripeSignature(rawBody, header, secret, nowSeconds)`, `src/app/api/checkout/webhook/route.ts` (listed in `cross-org.ts`), `src/checkout/env.ts` for the publishable key (D-26, INV-20 check), `fixtures/stripe/` recorded payloads + the fixture secret. Then 2.6 `inventory:eval:db`.

---

## ▶ 2026-11-10 (Phase 2 tasks 2.0–2.3, local Mac, Fable): schema, guards and load green locally. Stopped at the 2.2 gate for Shane's review.

Branch `phase-2` (off `kickoff`) → PR #2. Commits this session: D-28..D-30 recorded (`2dd4f75`), 2.1 schema (`4d3add2`), INV-34 export hooks (`60a2c43`), 2.3 load (`ea3b77e`), 2.2 guards (`9b7b78b`). Not pushed yet unless this entry says so below.

### Built
- `prisma/schema/turnstile.prisma`: 13 models (Event, Pool, Tier, Section, Seat, Hold, Payment, Order, Ticket, WaitlistEntry, Refund, CommandLog, Customer), 8 Postgres enums, natural ids as composite keys per event; `core.prisma` gained one `// app` back-relation line (drift allows it).
- `prisma/migrations/20261110000000_turnstile_init` (Prisma DDL + 42 hand-written CHECKs: every `*At` matches the D-9 axis regex, cents/counts ≥ 0, windows half-open), `…000001_rls_policies_turnstile` (regenerated, 31 tables), `…000002_turnstile_guards` (D-21 triggers: append-only CommandLog/Order; Refund admits only `stripeRefundId` NULL→value once; one transition-guard function on Hold/Payment/Ticket/Seat/WaitlistEntry with the brief's transitions as trigger args, each transition requiring a CommandLog row of the same command in the same transaction via transaction-local `turnstile.cmd_id`).
- `src/checkout/load.ts` + `scripts/turnstile-load.ts` (`npm run turnstile:load -- --org <slug>`, `:test` variant), write-once.
- `src/app/export-hooks.ts`: the 13 tables exported (INV-34 failed without it).
- Tests: `tests/checkout/guards.test.ts` (9), `tests/checkout/load.test.ts` (2).

### Gate output (local, 2026-11-10)
- `npm run db:setup`: wrote `.env.local` and `.env.test` (both gitignored, checked), created `turnstile` and `turnstile_test`, 18 template migrations applied to each, EXIT=0. The three new migrations applied to both afterwards.
- `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --exit-code` (shadow db `turnstile_shadow`): rc=0, "No difference detected".
- `npm test`: 45 files, 308 passed, 33 skipped (the RLS-enforce leg), 0 failed. Baseline before the export-hooks fix was 1 failed (INV-34).
- `npm run turnstile:load:test -- --org guards` second run: "refused: EV-SYNTH-001 is already loaded in this org (write-once)". Counts in `turnstile_test`: Seat 216, Tier 4, Pool 2, Customer 700 (capacity 800 + 216 = 1,016).
- `inventory:eval`: 7 files match, 2662 commands. `fixtures:check`: OK. `inventory:lint`: OK. `lint`: 0 problems. `typecheck`: clean. `foundation:drift`: clean against v1.6.1 (modules removed: billing) — needed `git remote add template "~/Projects/saas foundation"` + `git fetch template --tags` on this Mac first.

### Decisions this session
D-28, D-29, D-30 resolved as recommended (`docs/decisions.md`, "Phase 2 shape"). Refinement of D-21 recorded in the guards migration header: Refund is append-only except `stripeRefundId` NULL→value once (the provider's id, D-23; NULL = `PENDING_PROVIDER`).

### Open for Shane (the 2.2 gate)
1. Review the schema and the triggers (`prisma/schema/turnstile.prisma`, `prisma/migrations/20261110000002_turnstile_guards/migration.sql`).
2. Say go for 2.4 (cast path; `Engine.hydrate` entry point per D-28, no rule change) → stop again after 2.4.

### Next session
Task 2.4 on `phase-2`: `src/checkout/cast.ts` (advisory lock per pool, hydrate, advance + command, delta + CommandLog), two-writer last-seat test.

---

## ▶ 2026-11-10 06:58 CT (Phase 2 task 2.0, cloud, Fable): plan written, stopped for review. No Phase 2 code.

Branch `phase-2` (off `kickoff`) → PR #2 based on `kickoff`. PR #1 (kickoff + Phase 1) still open and unmerged — merge #1 first, then #2's base can be retargeted to `main`.

Plan and three proposed shape decisions (D-28 hydrate-and-delta cast path with `CommandLog` as truth; D-29 triggers only, no app role; D-30 Stripe interface with a recorded implementation for tests/CI) are in `docs/phase-2-tasks.md` §2.0. Defaults take effect on "go".

Preflight for this session: both repos reachable; Stripe connector present in the session but unused (D-5).

**Next session:** task 2.1 (schema) on `phase-2` after Shane's go.

---

## ▶ 2026-11-09 (Phase 1 build, cloud, Fable): engine done, all 14 Phase 1 tasks green locally. Stopped at the Phase 2 gate for Shane's review.

Branch `kickoff` → PR #1 (not merged). **CI green on the Phase 1 head:** https://github.com/shanelabountyai/turnstile/actions/runs/42691038583 (`ci (off)` and `modules-removed` both success; the Phase 1 gate steps `inventory:lint`, `inventory:eval`, `fixtures:check` ran on the runner).

### Built
`src/inventory/` (12 files; engine as one class, see decisions "Layout"), `src/inventory/tables.ts`, `tests/inventory/{golden,fixture,shuffle}.test.ts` (29 tests), `scripts/inventory-eval.ts`, `scripts/inventory-lint.ts`, package scripts `inventory:eval`, `inventory:lint`, `fixtures:check`, CI Phase 1 gate (lint → eval → fixtures:check after vitest; runner `TZ=America/Chicago`), `docs/EVAL.md`, `docs/phase-2-tasks.md` (draft).

### Gate output (local, 2026-11-09 ~14:30 CT)
- `npx vitest run tests/inventory`: 3 files, 29 tests passed (GT-01..GT-18; seven tables + summary + commitment; 20 shuffles + out-of-order refusal).
- `npm run inventory:eval`: table identical to `fixtures/reference_output.txt`; "7 expected files and expected_summary.json match (2662 commands)"; commitment `d4d64203…61d43`.
- `npm run inventory:lint`: OK (12 files; event.json valid). `npm run fixtures:check`: OK. `npm run lint`: 0 problems. `npm run typecheck`: clean. `npm run foundation:drift`: clean against v1.6.1 (modules removed: billing).
- Negative proofs: tampered copy (K-00066 qty 8→9) → eval exit 1 naming row 67 K-00066; planted `Math.random()` → lint exit 1; orphan rule flipped in a copy of `event.json` → eval exit 1 at K-00103 (T21 `ORPHAN_SEAT` → `HELD`), no code change.
- **First-run agreement** with the oracle on every table and the commitment; no expected value edited; no oracle change.
- CI-only here: database vitest files, e2e (D-7). Template vitest files still fail locally for lack of `.env.test`/Postgres — CI decides.

### Decisions this session
D-26 (publishable key clone-owned, Phase 2 gate; Shane 2026-11-09), D-27 (ports and lineage), and the "Layout" record — `docs/decisions.md`.

### Open for Shane
1. Review PR #1 (kickoff + Phase 1 on one branch) and merge, or ask for a split.
2. Phase 2 gate: approve `docs/phase-2-tasks.md`; decide D-26's shape and O-8 (live round trip count) when 2.5 comes up.
3. By hand: port-table row (turnstile → 7700), build-log card #13, CLONES.md PR #14 on saas-foundation.

### Next session
Phase 2 task 2.0 (plan, stop for review) once PR #1 is merged or Shane says to continue on `kickoff`.

---

## ▶ 2026-11-09 (kickoff session, cloud, Fable): scaffold done, stopped before any product code. Awaiting Shane's review of the Phase 1 plan.

Branch `kickoff` → PR against `main` (not merged). CLONES.md row → PR on saas-foundation (not merged). Links in the PR descriptions and in the chat.

### What exists
Clone of saas-foundation **v1.6.1** (`329baf5`) with shared history (remote `template`), `new-project -- turnstile 7700`, billing removed per D-6, kit copied in (CLAUDE.md, KICKOFF.md, prd-turnstile.md, docs/, tools/, fixtures/, `.claude/settings.json` model pin), README scope banner verbatim, `.env.example` D-5 comment. `foundation:drift` clean. No `src/inventory/`, no Prisma models beyond the template's, no migrations, no UI, no Stripe code.

### Step 4 record (what could not run here)
- `npx prisma generate`: schema-engine download 403 from binaries.prisma.sh → `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npx prisma generate` works.
- No Postgres server (`ECONNREFUSED 127.0.0.1:5432`): `db:setup`, migrations and every database test are **CI-only**. Template vitest here: 2 files passed, 38 failed at env parsing (no `.env.test`, no database). Phase 1 engine tests need neither.
- Playwright browsers: not attempted (no UI in Phase 1).
- Stripe: not reachable and not needed (D-5).

### Step 5 record (oracle check)
`golden_answers.py` OK · `build_fixtures.py --seed 20261109 --out /tmp/fx` → 2,662 commands, 79 traps · `reference_alloc.py --fixtures /tmp/fx --write-expected --shuffle 5` → identical tables, commitment `d4d64203…61d43` · `verify_fixtures.py` OK · **all 11 `/tmp/fx` hashes equal `fixtures/MANIFEST.json` and brief §12; `reference_output.txt` identical.**

### Step 7: contradictions and things that can't be built as written (not resolved here)
1. **`STRIPE_PUBLISHABLE_KEY` in `.env.example` (kit task 1.1, KICKOFF step 2) is not possible as written.** INV-14 (`tests/invariants/inv-14-env.test.ts`, template-owned) requires `.env.example`'s keys to equal `src/core/env.ts`'s schema exactly, and `env.ts` is template-owned. The template already has `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`; it has no publishable key. **Proposed:** in Phase 2, read the publishable key as `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` from a clone-owned `src/checkout/env.ts` (not the core schema), and check INV-20 (public env) allows it. Decide at the Phase 2 gate. Task 1.1 wording needs the edit.
2. **`STRIPE_PRICE_ID`** stays in `.env.example` and `env.ts` although billing is removed (the `// billing` in `env.ts` is a comment, not a marked line). Harmless; unused; recorded in D-6.
3. **Donor path:** overlap doc said canonical JSON lives in Quorum `src/tally/commit.ts`; it is `src/tally/canonical.ts` (imported by `commit.ts`). Fixed in the overlap doc this session.
4. **"Share links unwired" (D-6, CLAUDE.md §Stack):** share links are core (`src/core`), not a removable module; nothing to unwire. The clone simply has no share-link routes of its own. Wording only.
5. **PRD P0-9 says `Hold` is append-only** while holds change state; D-21 already resolves it (guarded `state` column + `CommandLog` row per transition). PRD text should say "append-only or state-guarded per D-21". Wording only.
6. **CLAUDE.md §Commands lists `inventory:eval` printing `0 commands` until task 1.10** but task 1.1 creates it — consistent, just noting the stub is required at 1.1.
7. Nothing else contradicts itself; every GT value in brief §9 was checked against `golden_answers.py` output and every GQ value against `expected_summary.json`.

### Phase 1 plan (tasks 1.1–1.14, in the order I will do them)
1. **1.1 Scaffold commands** (`inventory:eval` stub printing `0 commands`, `fixtures:check`, `inventory:lint` as a small tsx script) — CI-only parts: none. Also edit task 1.1's `STRIPE_PUBLISHABLE_KEY` sentence per contradiction 1 and record D-26 for it.
2. **1.2 Fixtures** — already copied; the task is the regeneration proof (done this session, step 5) plus a CI job step that fails if `git status --porcelain fixtures/` is non-empty.
3. **1.3 Ports** — donors: Quorum `src/tally/canonical.ts` (canonical JSON + sha256; read this session), Quorum `src/tally/time.ts` (calendar strings; extend with `addMinutes`/`daysBefore` as integer seconds on the axis), LoanBook money module (**not reachable**: write a 20-line `cents.ts` from D-16 and record "written fresh; LoanBook unreadable from the cloud"), Quorum `tally:lint` script for the purity lint.
4. **1.4 Event schema + loaders** (zod, own CSV reader) → GT-13.
5. **1.5 Counts and seats** → GT-03a, GT-05, GT-18b.
6. **1.6 Tick + hold/payment commands** → GT-04, GT-08, GT-12, GT-14, GT-15, GT-17; then the `expected_commands.csv` match for those kinds.
7. **1.7 Waitlist** → GT-09, GT-10, GT-18; `expected_waitlist.csv`.
8. **1.8 Refunds, cancel, check-in** → GT-06, GT-07, GT-11, GT-16; `expected_refunds/tickets/orders.csv`.
9. **1.9 Reports + commitment** → `expected_inventory.csv`, `expected_summary.json`, GQ-10.
10. **1.10 `inventory:eval`** full table + 7-file diff; prove it fails on a one-command edit.
11. **1.11 20-shuffle vitest** (seed recorded).
12. **1.12 `inventory:lint`** incl. planted-`Math.random` proof on a throwaway branch.
13. **1.13 `docs/EVAL.md`.**
14. **1.14 CI gate** — CI-only by nature; red/green runs linked here.

Expected CI-only commands for the whole phase: `db:setup`, `prisma migrate *`, database vitest files, e2e. Expected local: all engine vitest files, `inventory:eval`, `fixtures:check`, `inventory:lint`, lint, typecheck.

**Stop point reached.** No product code written. Next session starts at 1.1 once Shane approves the plan and answers contradiction 1.

### By hand (Shane)
- Review and merge PR #1 (`kickoff`) and the saas-foundation CLONES.md PR.
- `~/.claude/CLAUDE.md`: port-table row turnstile → 7700.
- Build-log card #13: name Turnstile, PRD + repo links, status in progress.
- Stripe test-mode account/keys: Phase 2 gate, not before.
