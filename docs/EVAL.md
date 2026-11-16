# EVAL — Turnstile Phase 1 (pure engine), Phase 2 (database path) and Phase 3 (screens)

Every number here is produced by the command named next to it. Measured on the frozen fixtures (`fixtures/`, seed 20261109) by the TypeScript engine under `src/inventory/`, 2026-11-09, cloud session.

## What this proves and does not prove (D-24)

The TypeScript engine agrees with the Python oracle (`tools/inventorylib.py`) on **2,662 commands** (2,510 OK, 152 rejected over 35 reject codes), on every row of the seven `expected_*` files, on `expected_summary.json`, and on the commitment — in the fixture's order and in 20 shuffled orders. The fixture and the oracle were written by the same author, so this is an upper bound on agreement with the spec in `docs/domain-brief.md`; it is not a claim that the spec matches any venue's policy, that the orphan rule is the right one, that the system holds under load, or anything about Stripe beyond what Phase 2 will test against its documented contracts. Nothing has been sold to anyone.

## Reference table — `npm run inventory:eval`

```
== Turnstile reference run — Synthetic Night (fixture)
commands 2662 · ok 2510 · rejected 152
-- by code
  CHECKED_IN                     802
  HELD                           596
  PAYING                         483
  CONFIRMED                      451
  SOLD_OUT_TIER                   99
  WAITLISTED                      75
  RELEASED                        40
  PAYMENT_FAILED_RELEASED         31
  REFUNDED                        30
  REFUND_WINDOW_CLOSED             7
  HOLD_EXPIRED                     4
  WAITLIST_DUPLICATE               4
  TIER_NOT_ON_SALE                 3
  HOLD_NOT_YOURS                   2
  HOLD_RELEASED                    2
  SALES_CLOSED                     2
  SEAT_TAKEN                       2
  SOLD_OUT_POOL                    2
  ALREADY_CHECKED_IN               1
  DOORS_NOT_OPEN                   1
  HOLD_ID_DUPLICATE                1
  HOLD_NOT_HELD                    1
  HOLD_UNKNOWN                     1
  ORDER_NOT_YOURS                  1
  ORDER_UNKNOWN                    1
  ORPHAN_SEAT                      1
  PAID_AFTER_TIMEOUT               1
  PAYMENT_DUPLICATE                1
  PAYMENT_UNKNOWN                  1
  QTY_INVALID                      1
  QTY_OVER_LIMIT                   1
  SALES_NOT_OPEN                   1
  SEATS_NOT_ALLOWED                1
  SEATS_REQUIRED                   1
  SEAT_DUPLICATE                   1
  SEAT_UNKNOWN                     1
  TICKET_ALREADY_REFUNDED          1
  TICKET_CHECKED_IN                1
  TICKET_NOT_IN_ORDER              1
  TICKET_REFUNDED                  1
  TICKET_UNKNOWN                   1
  TIER_UNKNOWN                     1
  WAITLIST_NOT_NEEDED              1
  WAITLIST_TARGET_UNKNOWN          1
  WAITLIST_UNKNOWN                 1
-- inventory (end state)
  scope id       capacity  sold  held refunded remaining available
  tier  EARLY         200   187     0       14        13         0
  tier  ADV           400   400     0       16         0         0
  tier  DOOR          300   213     0        0        87         0
  tier  BALC          216   204     0       17        12        12
  pool  FLOOR         800   800     0       30         0         0
  pool  BALCONY       216   204     0       17        12        12
-- orders 451 · tickets issued 1051 · live 1004 · refunded 47 · checked in 802
-- money (cents): captured 4618132 · refunded 137682 · net 4480450 · refunds 48
  refunds CUSTOMER               47     129984
  refunds PAID_AFTER_TIMEOUT      1       7698
-- holds
  HOLD_CONFIRMED           447
  HOLD_EXPIRED              77
  HOLD_PAY_FAILED           31
  HOLD_PAY_TIMEOUT           1
  HOLD_RELEASED             40
  OFFER_CONFIRMED            4
  OFFER_EXPIRED              1
-- waitlist: entries 75 · offers made 5
  CLOSED_OFF_SALE           46
  FULFILLED                  4
  OFFER_EXPIRED              1
  WAITING                   24
-- commitment d4d64203ae84f69cbc2b4e42e4297ac7dc01c151465dd147b7ce4638fef61d43
eval: 7 expected files and expected_summary.json match (2662 commands)
```

The same fields in the same order as `fixtures/reference_output.txt` (the oracle's run, modulo its `shuffle`/`wrote` lines): `diff` of the two is empty.

## Goldens and agreement — `npx vitest run tests/inventory`

- `tests/inventory/golden.test.ts`: GT-01..GT-18, 18 tests, all pass.
- `tests/inventory/fixture.test.ts`: GQ-01, the seven tables row for row, `expected_summary.json`, commitment `d4d64203ae84f69cbc2b4e42e4297ac7dc01c151465dd147b7ce4638fef61d43`, GQ-04 end state (DOOR remaining 87 / available 0; FLOOR sold 800 / remaining 0): 9 tests, all pass.
- `tests/inventory/shuffle.test.ts`: 20 seeded shuffles (LCG, seeds 1–20) → identical tables and commitment; out-of-order `apply` is refused: 2 tests, all pass.

## Negative proofs (run once, 2026-11-09, on throwaway copies)

- `inventory:eval` on a copy of `fixtures/` with K-00066's qty changed 8 → 9: exit 1, `DIFFERS: expected_commands row 67 (K-00066) column status: got "REJECT", expected "OK"`.
- `inventory:lint` on a copy of `src/inventory/` with `export const x = Math.random();` appended to `cents.ts`: `cents.ts: Math.random (randomness)`, exit 1.

## Fixture hashes — `python3 -I tools/verify_fixtures.py`

| File | sha256 |
|---|---|
| `answer_key.csv` | `2ec6190b194defce1de03135f35dd20fee4a2352a53ee7bc1fbab151071137c8` |
| `commands.csv` | `4718068e32b2bf07a35aacae6b6ef8482822d420156f239e8ea93bae3367b4c0` |
| `customers.csv` | `459d372195f1524364e7dea74ba6c2d660bfd317eecb6cb22cbe5c689a553e40` |
| `event.json` | `291f4fced7f7428293cbca0adacf9318532d3bbb1dcf7e70098410aa2f937de9` |
| `expected_commands.csv` | `6fa76dd45bf33719efad5f2ed80e0b70a6d2880d5a0548ef40d631a6df7b41c4` |
| `expected_inventory.csv` | `6935bf0c2670c7fbdda95ddce72a18fc073e0b71e92cafca3212439ee0bad964` |
| `expected_orders.csv` | `d0501ae774fc1e15e49007388c885884d6eed5232cf55c636836b3407ae21c52` |
| `expected_refunds.csv` | `d7c0e215efb8a97ae857a244f0f58ab5beb8379a997254155dc513a27fd30c60` |
| `expected_summary.json` | `44f1727709cab54741027e9777f3e82068a867dced6466523abde93d208222af` |
| `expected_tickets.csv` | `884d32745dd686ebc7658b21e985d4672439c03653166c96fb16bb5cee7d328e` |
| `expected_waitlist.csv` | `4f9ac54daec14b6003f164b93b49f113db923c0406f72a2fd66881032eb0fdea` |

`fixtures:check` = `verify_fixtures.py` OK (11 files, 0 mismatches; recount 7/7 equal; 76 traps agree) · `golden_answers.py` OK · `fixtures/` unchanged in git.

## Phase 2 — the database path (local Postgres 17, 2026-11-10; CI run below)

Same limits as above (D-24), plus: this proves the stored rows agree with the pure engine on the fixture stream, with Stripe **recorded** (`fixtures/stripe/`, D-30). It does not prove anything about Stripe's live behaviour (that is the by-hand round trip below), about throughput, or about more than two concurrent writers.

### `inventory:eval:db` — `npx tsx scripts/inventory-eval-db.ts` (CI) / `npm run inventory:eval:db` (local)

- **2,662 commands through the cast path** (`src/checkout/cast.ts`: per-pool advisory lock, hydrate, `advance` + command, delta + `CommandLog`) in 32.6 s; 2,662 `CommandLog` rows.
- Two recounts, both equal to each other, to the seven `expected_*` files and to `expected_summary.json`: (a) the engine hydrated from stored rows, (b) a fresh pure engine replaying the `CommandLog`.
- Commitment `d4d64203ae84f69cbc2b4e42e4297ac7dc01c151465dd147b7ce4638fef61d43` — Phase 1's, unchanged.
- Stripe recorded: 484 PaymentIntents, 48 refund calls, 48 `Refund` rows, 0 `PENDING_PROVIDER`.
- Negative proof (2026-11-10, scratchpad copy of `fixtures/`, K-00066 qty 8 → 9): exit 1 at row 67, K-00066 `REJECT` vs `OK`. `fixtures/` untouched.

### Concurrency — `tests/checkout/cast.test.ts` (7 tests)

Two concurrent `HOLD`s for the last floor ticket (pool 10, 9 held): results `['HELD','SOLD_OUT_POOL']`, log statuses `['OK','REJECT']`, held 10 of 10. Two writers only; no load test. Also: replay on `cmd_id` writes nothing; a command earlier than the log is refused; expiry runs before the command at the inclusive second; orphan reject recorded; pay → confirm → refund writes order, tickets, seat `SOLD` then `OPEN`, refund row.

### Webhook signature and the Stripe boundary — `tests/checkout/webhook.test.ts` (11 tests)

Stripe's documented scheme (`t=…,v1=…`, HMAC-SHA256 over `t.payload`, 300 s tolerance) against the published fixture secret. Accepted: valid header with several `v1` values. Refused: tampered body, wrong secret, `t` stale by 301 s either way, missing or malformed header (route: 400, nothing cast). Replayed `event.id` returns the stored result and casts nothing; a new event for a settled payment is `PAYMENT_DUPLICATE`; success after the payment timeout is `PAID_AFTER_TIMEOUT`, no tickets, refund call issued automatically; a provider failure on refund leaves `PENDING_PROVIDER` and the retry settles it; route 503 without a secret, 404 for an unknown event.

### Schema and guards

- `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema --exit-code`: "No difference detected" (CI and local).
- `tests/checkout/guards.test.ts` (9): D-21 triggers: `CommandLog` and `Order` refuse UPDATE/DELETE; `Refund` admits only `stripeRefundId` NULL → value, once; Hold/Payment/Ticket/Seat/WaitlistEntry refuse DELETE, refuse a move that is not a listed transition (e.g. Seat `OPEN → SOLD`, Ticket `REFUNDED → ISSUED`), and refuse a listed one without a `CommandLog` row of the same command in the same transaction; the axis CHECK refuses an off-axis timestamp (D-9).

### CI

Green on `0880d65`: https://github.com/shanelabountyai/turnstile/actions/runs/42848895625 — `ci (off)`: vitest 47 files, 326 passed, 33 skipped (the RLS-enforce leg), 0 failed; `migrate diff` "No difference detected"; `inventory:eval:db` 2,662 commands in 52.3 s on the runner, same recount and commitment, same Stripe counts. `modules-removed`: success. No Stripe secret configured.

## Notices — the outbox (Phase 3 task 3.8, D-33; local, 2026-11-10)

Written in the cast transaction, never sent. `inventory:eval:db` after the 2,662 commands: **451 order confirmations (= 451 orders) · 5 offer notices (= offers_made 5) · 0 rows sent or drainable** (every row has `attempts = MAX_ATTEMPTS` and `sentAt` null; the script exits 1 if any count differs). `tests/checkout/notices.test.ts` (2): one confirmation + one offer notice with the right address, amount ($38.49 = 3499 + 350 ¢) and offer expiry; `drainOutbox()` returns `{ sent: 0, failed: 0 }` and `sendEmail` is never called; a replayed cmd_id queues nothing. Mutation check: rows queued with `attempts: 0` turn the test red.

## Phase 3 — the screens (local Mac, production build, 2026-11-10; CI green: https://github.com/shanelabountyai/turnstile/actions/runs/43063558361)

Same limits as above (D-24). Phase 3 adds no rule: the engine and the cast path are unchanged since Phase 2, so `inventory:eval` and `inventory:eval:db` still print the same commitment `d4d64203…61d43`. What this section proves is that **every number on a screen comes from the read model** (`src/checkout/read.ts`), and that the screens can be used without a mouse-only path or a contrast failure. It does not prove the layout is good: nobody has looked at these pages in a browser by eye, and axe does not judge layout.

### Screen numbers traced to the read model
- `tests/checkout/read.test.ts` (8): on the fixture end state, FLOOR 800/800 sold, DOOR 87 remaining / 0 available (`SOLD_OUT_POOL`), BALCONY 204 sold / 12 available; per-order refunds equal `expected_orders.csv`; the ledger CSV's columns sum to **4,618,132 / 137,682 / 4,480,450 ¢** (captured / refunded / net), 451 order lines plus one late-money line (`PAID_AFTER_TIMEOUT`, refunded in full) = 452 captured payments. Reading at the expiry second frees holds and offers the waitlist head in the view with 0 rows written.
- `inventory:eval:db` also checks `readEvent` = recount = replay = `expected_*`.
- Refund preview = cast = rows: e2e `box.spec`, $34.98 shown = cast detail 3498 ¢ = `Refund` rows 3498 ¢.
- `npm run inventory:lint` scans the 6 screen files under `src/app/o/**/events/` for float, `reduce` and binary arithmetic. It found one (door "still to arrive"), moved to the read model as `ledger.toArrive`; mutation (subtraction put back) turns the lint red.

### End-to-end and accessibility
- Full e2e on the production build: **25 passed, 0 failed, 0 flaky** (local). Door covers all four refusals (`DOORS_NOT_OPEN`, `TICKET_REFUNDED`, `ALREADY_CHECKED_IN` with the first scan time, `TICKET_UNKNOWN`) and a success (count 0 → 1).
- axe-core (from the lockfile, no dependency added) on **7 pages × light and dark = 14 scans, 0 violations** (`e2e/a11y.spec.ts`: design, events list, event, buy, box, door, ledger over the cast end state). `npm run design:contrast`: OK, 0 pairs under the floor, both schemes.
- Local gate: lint 0 · typecheck clean · `foundation:drift` clean · `npm test` 50 files, 341 passed, 33 skipped (RLS-enforce leg), 0 failed.
- vitest and e2e share `turnstile_test`; run one at a time (a concurrent run once failed INV-01 on a changed-rows count).

### Not run here
CI for Phase 3: green on 3e22f32 (ci (off) and modules-removed both success), https://github.com/shanelabountyai/turnstile/actions/runs/43063558361. Live Stripe Elements and the O-8 round trip (below) are the owner's, by hand.

## Live Stripe round trip (Phase 2, by hand)

Not yet run. Owner's step (O-8): one order through Stripe Elements with test card 4242, one refund; PaymentIntent and Refund ids recorded here. No key is ever in this repo or CI.
