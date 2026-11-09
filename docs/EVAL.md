# EVAL — Turnstile Phase 1 (pure engine)

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

## Live Stripe round trip (Phase 2, by hand)

Not yet run. Owner's step (O-8): one order through Stripe Elements with test card 4242, one refund; PaymentIntent and Refund ids recorded here. No key is ever in this repo or CI.
