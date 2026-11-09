# CLAUDE.md — Turnstile

Learning project: event venue ticketing for an invented 1,016-seat hall. General-admission tiers over a shared pool whose allotments add up to more than the pool, reserved balcony seats with an orphan rule, timed cart holds, Stripe test-mode checkout, the hold-versus-webhook race as a named outcome, a FIFO waitlist whose head is never skipped, refund windows as data with integer rounding, cancellation, and door check-in. **Synthetic data only. Stripe test mode only; keys live on the owner's machine and in Vercel, never in this repo, a cloud session or CI. No claim about any venue's policy, any ticketing law or any fire code.** Keep the scope-honesty banner verbatim in README.md.

Read first: `prd-turnstile.md` (what), `docs/decisions.md` (authoritative; outranks the PRD), `docs/domain-brief.md` (vocabulary, rule codes H/P/W/R/X/C, golden cases GT/GQ, measurements, fixture hashes), `docs/portfolio-overlap.md` (what to port, what not to build). Current work: `docs/phase-1-tasks.md`. Session state: `NEXT.md`.

## Non-negotiables
1. **The engine is pure and order-independent.** `src/inventory/` imports no database, clock, randomness, network, Stripe or model client (`inventory:lint`). Commands are evaluated in `(at, cmd_id)` order whatever order they arrive in; same commands, same tables, same commitment.
2. **The pool is the truth; available is derived.** `available = min(allotment − sold − held, pool_capacity − pool_sold − pool_held)`, computed on every read, never stored. `SOLD_OUT_POOL` before `SOLD_OUT_TIER`. A refunded ticket goes back to its tier and pool even if the tier is off sale.
3. **Expiry runs before the command.** `advance(at)` expires holds and offers with `expires_at <= at`, times out `PAYING` holds with `pay_timeout_at <= at`, closes off-sale GA waitlists, and fills waitlists — then the command at `at` is evaluated. The expiry second is inclusive.
4. **A PAYING hold is not expired by the cart TTL.** It runs on `payment_timeout_minutes`. A success webhook after the timeout is `PAID_AFTER_TIMEOUT`: full refund, no tickets. Webhooks are idempotent (`PAYMENT_DUPLICATE`). Late money is refunded, never seated.
5. **Every command gets one code from a closed set with a stated precedence** (brief §4–§8), and a rejected command is still recorded in the results and the `CommandLog`.
6. **The waitlist head is never skipped.** FIFO by `(joined_at, entry_id)`; `HEAD_BLOCKS`; an offer is a timed hold the wrong customer cannot pay; an ignored offer is dropped and the next head is offered in the same tick. `SKIP_TO_FIT` is `RULES_INVALID`.
7. **Reserved seats have a shape.** An `OPEN` seat between two taken seats is an orphan; a hold that creates one is `ORPHAN_SEAT`; a section waitlist is served only when a contiguous block passes the rule.
8. **Integers only, on one axis.** Money is integer cents; proportions are basis points; `price × bps // 10000`, the remainder stays with the venue. Timestamps are `YYYY-MM-DDTHH:MM:SS` strings compared lexically; TTL and days-before are integer seconds on the same axis (no `new Date(string)`, no `@db.Date`, no zone conversion). Windows are half-open.
9. **Fixtures are frozen.** `fixtures/` is generated once by `tools/build_fixtures.py --seed 20261109` and `tools/reference_alloc.py --write-expected`; `tools/verify_fixtures.py` must print OK in CI. Product code never reads `answer_key.csv` or `expected_*`; only `inventory:eval` does.
10. **Never edit an expected value to pass a test.** GT/GQ values and `expected_*` come from the oracle in `tools/`. If TypeScript disagrees, stop and show the owner both derivations.
11. **Stripe keys never enter the repo, the cloud or CI.** `.env.example` has empty values. CI verifies webhooks with the fixture signing secret in `fixtures/stripe/` and recorded payloads. The live test-mode round trip is Shane's, by hand, recorded in `docs/EVAL.md`.
12. **Say what the numbers mean.** The fixture proves agreement with the spec on 2,662 commands, 152 rejects over 35 codes and 79 named traps, by the same author. Never "never oversells" or "correct" without the number and the D-24 limits. Nothing is sent: notices stop in the outbox.

## Working rules
- **TDD order:** canonical JSON + SHA-256 + axis arithmetic (GT-01, GT-02, GT-06) → event schema (GT-13) → counts and seats (GT-03a, GT-05, GT-18b) → tick + hold/payment commands (GT-04, GT-08, GT-12, GT-14, GT-15, GT-17) → waitlist (GT-09, GT-10, GT-18) → refunds/cancel/check-in (GT-06, GT-07, GT-11, GT-16) → reports + commitment (GQ-10) → `inventory:eval` against `expected_*` → shuffle test → `inventory:lint` → (Phase 2) schema, guards, cast path, Stripe boundary, recount → (Phase 3) UI. Write the failing test against a committed fixture first.
- **Fixtures:** tests read `fixtures/`; code never generates them. To change a fixture, change `docs/decisions.md` first, regenerate with `tools/build_fixtures.py` and `tools/reference_alloc.py --write-expected`, confirm `verify_fixtures.py --write-manifest` and `golden_answers.py` print OK, update the hashes in `docs/domain-brief.md` §12, review the diff.
- `tools/*.py` are test oracles, not product code. Don't port `inventorylib.py` line for line; the TypeScript engine is written from `docs/domain-brief.md` §4–§8 and must agree with it on every command.
- **Port before you write.** Donors are listed in `docs/portfolio-overlap.md`. Read the donor, port it, record the lineage in `docs/decisions.md`.
- Phase gate: don't start the next phase until the current phase's exit criteria pass. Phases: 1 engine + eval (no writes) → 2 schema, cast path, Stripe boundary, recount → 3 UI. Write the next phase's task list at the gate and stop for review.
- Small commits, one concern each, naming specific files (never `git add -A`). Branch + PR; **never merge.** Note seams for non-goals but don't build them.
- **Ask before adding dependencies.** Ask-before-add list: any CSV parser, any date library, any state-machine library, any charting library, any Stripe wrapper other than the official `stripe` package (Phase 2). Own the small things.
- **Cloud session:** the sandbox may not download Prisma engines or Playwright browsers and cannot reach Stripe. Record what could not run in `NEXT.md`; **CI decides**, not the local run.
- **Model is pinned to Claude Fable 5.1 (`claude-fable-5-1`)** in `.claude/settings.json` (D-3).
- End each session by updating `NEXT.md`: what was built, decided, left open, and the gate output.

## Session 0 — reuse check
The house reuse scan (`~/Projects/reuse-scan.py`) is not reachable from the cloud session. Record in `docs/decisions.md`: "Reuse scan skipped (cloud session); overlap taken from `docs/portfolio-overlap.md`; donors read before each port in task 1.3." Re-run it when the repo is next opened on the Mac.

## Stack
TypeScript on a clone of saas-foundation v1.6.1: Next.js 16, Prisma 7, PostgreSQL 17, vitest, Playwright. **Port 7700 proposed** (D-4; confirm against `CLONES.md` and the port table). Foundation modules: keep orgs, roles, invites, audit, notifications/outbox; billing removed; share links, SSO, API keys unwired; RLS off (D-6). Append-only tables and state guards via triggers as hand-written SQL in clone migrations (Phase 2). Stripe via the official `stripe` package behind `src/checkout/`, replaced at the HTTP boundary by recorded fixtures in tests (Phase 2). Python only in `tools/` (stdlib only, run with `python3 -I`). Template-owned paths (`src/core/**`, `tests/invariants/**`, core migrations, security routes) are never edited here; `npm run foundation:drift` enforces it. Local `DATABASE_URL`s carry `?connection_limit=10&pool_timeout=20`. `vercel.json` carries the house `ignoreCommand`. CI runs with `TZ=America/Chicago`.

## Commands (create in Phase 1, task 1.1)
- `npm test` — vitest (engine tests need no database)
- `npm run inventory:eval` — runs the engine over `fixtures/`; prints the brief §11 table; exits non-zero if anything differs from the seven `fixtures/expected_*` files. Prints `0 commands` and exits 0 until task 1.10
- `npm run fixtures:check` — `python3 -I tools/verify_fixtures.py && python3 -I tools/golden_answers.py && git diff --exit-code fixtures/ && test -z "$(git status --porcelain fixtures/)"`
- `npm run inventory:lint` — greps `src/inventory/` for `Date.now`, `Math.random`, `new Date(`, `prisma`, `fetch`, `stripe`, `anthropic`, `@/core`; greps `src/` for float money; validates `fixtures/event.json`
- `npm run inventory:eval:db` — Phase 2: the 2,662 commands through the cast path with Stripe recorded, then a recount from stored rows; same diff; empties the test database first
- `npm run turnstile:load -- --org <slug>` — Phase 2: fixture event and customers into an org, write-once

## Definition of done (any task)
Tests green (or recorded as CI-only with the reason), `inventory:eval` matching the reference exactly, `fixtures:check` OK, `inventory:lint` OK, no float money and no forbidden import under `src/inventory/`, decisions doc updated if a rule changed, `NEXT.md` updated, numbers (not adjectives) in the commit message when a measurement changed.
