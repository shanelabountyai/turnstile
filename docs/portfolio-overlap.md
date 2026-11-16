# Turnstile — Portfolio Overlap Check

Checked 2026-11-09 against the build-log card list, `saas-foundation/CLONES.md` (v1.6.1) and the Quorum kit in full (its PRD, decisions, brief, overlap, tasks, tools, CLAUDE.md, KICKOFF.md, NEXT.md read from the public repo). **The other donors' source trees were not readable from the kickoff workspace** (`~/Projects` was not reachable); the "Where" column names what to look for and the first session must read each donor before porting (CLAUDE.md working rule "port before you write"). Purpose: keep Turnstile from re-teaching what a sibling built — above all Gavel's contention lesson — and keep the UI half from eating the engine.

## Verdict

| Card chip | Already in the portfolio? | What Turnstile does instead |
|---|---|---|
| capacity | **Partly.** Bookable has slot capacity; Callboard has shift headcounts; Gavel has one lot per auction. Nothing has a shared pool under over-allotted tiers, or seats with a shape rule | `available = min(tier, pool)` derived on every read; `SOLD_OUT_POOL` vs `SOLD_OUT_TIER`; orphan rule; shape-aware section availability |
| waitlist | **No.** Bookable has no waitlist; Callboard fills shifts by invitation, not a queue | FIFO with `HEAD_BLOCKS`, offers as timed holds, `DROP`, off-sale closes the queue |
| refunds | **Partly.** BoxLoop (shelved) had proration; LoanBook has reversing entries; Adjuster pays claims | Refund policy as data in whole days on one axis, bps floored, fee flag per window, per-ticket, seat returns to inventory, cancellation refunds all |
| (new) hold-vs-webhook race | **No.** Bookable's W- track verifies inbound signatures but has no money in flight | `PAYING` on its own clock; `PAID_AFTER_TIMEOUT`; idempotent webhooks; Stripe signature verification with fixture secret in CI |

Suggested card chips once it ships: `pool is the truth (available derived)` · `holds to the second + the webhook race` · `orphan-seat rule` · `waitlist: head never skipped` · `refund policy as data, floored` · `Stripe test mode, keys never in the repo`.

## Reuse — port, do not rebuild

| Capability | Donor | Where to read first | Turnstile use |
|---|---|---|---|
| Auth, orgs, roles, invites, audit log, outbox, cron, CI, invariants | saas-foundation v1.6.1 | template | As cloned; one org = one venue; billing removed, share links/SSO/API keys unwired (D-6) |
| Canonical JSON + SHA-256 | Quorum (`src/tally/canonical.ts`, used by `commit.ts`; written fresh there because Adjuster's `JSON.stringify` broke on non-ASCII vs Python `ensure_ascii`) | Quorum D-18 and its NEXT.md 2026-10-26 note | `canonical`, ticket codes, the commitment (§8) |
| Pure engine with a lint for forbidden imports; `(at, id)` ordering; shuffle proof | Quorum `src/tally/`, Bracketry `src/lib/league/`, Gavel `tools/` | Quorum `tally:lint`, its 20-shuffle vitest | `src/inventory/` purity, `inventory:lint`, 20-shuffle test |
| Money as integer cents, one money module, no floats | LoanBook `src/ledger/money.ts` (D11) | LoanBook | prices, fees, refunds, captured/net |
| Calendar-string timestamps, no `new Date(string)`, CI under `TZ=America/Chicago`; half-open windows | Bookable CLAUDE.md date rules; Quorum D-8 | Bookable | D-9; the TTL arithmetic is the one addition (integer seconds on the axis) |
| Append-only tables and guarded state columns as hand-written SQL triggers | Quorum migration `quorum_init` (6 append-only triggers, guard trigger), Housefile D-6, Gavel | Quorum `prisma/migrations/` | `CommandLog`, `Refund`, `Order` immutable; state-transition guard on `Hold`/`Payment`/`Ticket`/`Seat`/`WaitlistEntry` (D-21) |
| `SECURITY DEFINER` write path + `SET LOCAL ROLE` app role | Quorum `src/meetings/db.ts`, `quorum_cast_ballot` | Quorum Phase 2 | the cast path function + `pg_advisory_xact_lock` (D-22) |
| Verifying someone else's webhook signature | Bookable W- track (`apptbasedservice/docs/prds/api/`), Gavel? (no) | Bookable's inbound SMS verification | Stripe `t`/`v1` HMAC verification; tolerance window; fixture secret in CI (D-5, D-23) |
| Idempotency keys on outbound calls; dead-letter/retry | Bookable W- track outbound webhooks | Bookable | `PaymentIntent` key = hold id, refund key = refund id, `PENDING_PROVIDER` retry (D-23) |
| Closed vocabularies as data; `RULES_INVALID` with the field | Adjuster, Quorum `rules.ts` | Quorum zod schema | `event.json` schema (P0-1) |
| State machine with an event per transition, illegal transitions refused | BoxLoop subscription states, Adjuster claim states, Quorum `Violation` | Quorum D-22 | hold / payment / ticket / entry state tables |
| Frozen fixtures + stdlib Python oracle + goldens + manifest + `fixtures:check` | Quorum, Housefile, Gavel | Quorum `tools/`, `fixtures/` | same workflow (`build_fixtures.py`, `reference_alloc.py`, `golden_answers.py`, `verify_fixtures.py`) |
| Event-queue fixture generator driven against the oracle | **new here** (Quorum's generator is declarative) | — | `build_fixtures.py` `Sim` (D-19); worth porting back to a future kit |
| Outbox notices queued, never sent; runtime-registered templates | Callboard / Showcall | Callboard notifications | order confirmations, offer notices (Phase 3) |
| Design system, contrast tool, axe in e2e | Quorum D-57 (`docs/DESIGN_SYSTEM.md`, `src/components/ui.tsx`, `tools/contrast.py`) | Quorum | Phase 3 pages |

## New — each with the fixture that proves it

| # | Lesson | Not in any sibling because | Proven by |
|---|---|---|---|
| 1 | Shared pool under over-allotted tiers; availability derived as a min | Bookable's capacity is per slot, one number | GT-03; T66–T72; end state DOOR 87 remaining / 0 available |
| 2 | Timed holds with an inclusive expiry second, expiry evaluated before the command | Gavel's soft close extends; nothing expires a reservation | GT-04; T26/T27; 77 expired holds in the fixture |
| 3 | The hold-vs-webhook race as a named outcome with a refund | No sibling has money in flight during a reservation | GT-08; T31–T33; `PAID_AFTER_TIMEOUT` 7,698 ¢ |
| 4 | Idempotent webhooks over a closed payment state machine | Bookable's W- track is outbound; inbound SMS has no state | GT-12; T07 |
| 5 | Orphan-seat rule and shape-aware availability for reserved seating | No sibling has adjacency | GT-05, GT-18; T20–T23; BALC 12 remaining with 24 still waiting |
| 6 | FIFO waitlist with `HEAD_BLOCKS`, offers as timed holds, `DROP` | Callboard invites by choice; no queue anywhere | GT-09, GT-10; T51–T61; T68–T71 |
| 7 | Refund policy as data in whole days, bps floored, fee flag | LoanBook reverses entries; nothing has windows | GT-06, GT-07; T41, T50, T54, T62 |
| 8 | Cancellation as a total refund including checked-in tickets | — | GT-11 |
| 9 | Door check-in with four refusals | Callboard checks staff in, not tickets; no duplicate-scan rule | GT-16; T65, T73–T77 |
| 10 | Stripe test mode with the key boundary drawn around the agent | BoxLoop used mock payments; nothing in the portfolio touches a real PSP | D-5, D-23; Phase 2 signature tests; owner's live round trip in EVAL |

## Guardrails — lessons Turnstile must not take

| Lesson | Owner | Rule here |
|---|---|---|
| N-writer row-lock contention, proxy bidding, soft close, settlement | Gavel | One advisory lock per pool and one two-writer test (D-22); no load test; no bidding |
| Slot search, recurring availability, calendar logic | Bookable | One event; windows are constants; no scheduling |
| Double-entry ledger, accrual, interest | LoanBook | `captured − refunded = net`, three integers; no journal |
| Rules engine with authoring UI | Adjuster | `event.json` edited as a file; no editor |
| Messy import, entity resolution | Housefile | Customers come from clean fixtures |
| Ballots, receipts, Merkle commitments | Quorum | One commitment hash over the final state for the recount; no per-customer receipt |
| Subscription billing, proration, dunning | BoxLoop / foundation billing | Removed; Stripe here is checkout only |
| Staff scheduling, shift fill | Callboard | Door staff are users with a role; no rota |
| Learned models or LLM anywhere in the engine | — | None; closed arithmetic over closed vocabularies |
| Live payments, Connect, payouts, disputes | — | Test mode only; dispute is a P1 seam |

## How this was checked

- Read in full: the Quorum repo (`prd-quorum.md`, `docs/decisions.md`, `docs/domain-brief.md`, `docs/portfolio-overlap.md`, `docs/phase-1-tasks.md`, `CLAUDE.md`, `KICKOFF.md`, `NEXT.md`, `CLONES.md`); the build-log page (every card's `why` and chips) and the closeout grid (2026-11-09).
- Not readable from the kickoff workspace: `~/Projects` (folder access denied), the source trees of bookable, gavel, loanbook, adjuster, bracketry, housefile, callboard, showcall. The "Where" column for those comes from their CLONES notes and the Quorum overlap doc; confirm by reading the code before each port (task 1.3).
- `reuse-scan.py` is not reachable from the cloud; KICKOFF step 6 records it as skipped.
