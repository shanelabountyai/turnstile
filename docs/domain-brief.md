# Turnstile — Domain Brief

Vocabulary, rules, golden cases and the reference measurements for the inventory engine. `tools/inventorylib.py` is the oracle this brief describes; the TypeScript engine under `src/inventory/` is written from this document and must agree with the oracle on every command, every count and the commitment. `docs/decisions.md` records why each rule is what it is.

## 1. Product scope

One venue (an org), one event in Phase 1–3, one on-sale window. Inventory is sold as general-admission tiers over shared pools and as reserved seats in sections. Customers hold, pay (Stripe test mode), release, join waitlists, accept offers, request refunds and check in at the door. The venue can cancel the event. Everything the engine does is a function of the event definition and an ordered stream of commands.

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Pool** | A capacity the fire code cares about. `kind` is `GA` (a count) or `RESERVED` (a set of seats). |
| **Tier** | A price with an allotment, an on-sale window and a pool. GA tiers may over-allot their pool. A reserved pool has exactly one tier. |
| **Section / row / seat** | Reserved seating. Seat id `<section>-<row>-<nn>`; seat state `OPEN`, `HELD`, `SOLD`. |
| **Hold** | Inventory taken out of sale for one customer for a limited time. `kind` is `HOLD` (a cart) or `OFFER` (a waitlist offer). States: `HELD → PAYING → CONFIRMED`, or `HELD → EXPIRED / RELEASED / CANCELLED`, or `PAYING → PAY_FAILED / PAY_TIMEOUT / CANCELLED`. |
| **Payment** | One Stripe PaymentIntent per `PAY_START`. States `PENDING → SUCCEEDED / FAILED / SUCCEEDED_LATE`. |
| **Order / ticket** | Created on `CONFIRMED`. Ticket states `ISSUED → CHECKED_IN`, either → `REFUNDED`. |
| **Waitlist entry** | A customer waiting for a target (GA tier or reserved section) with a quantity. States `WAITING → OFFERED → FULFILLED`, or `WAITING → LEFT / CLOSED / CLOSED_OFF_SALE`, or `OFFERED → OFFER_EXPIRED / OFFER_DECLINED / OFFER_PAY_FAILED / LEFT / CLOSED`. |
| **sold / held / remaining / available** | `sold` = tickets `ISSUED` or `CHECKED_IN`; `held` = holds and offers in `HELD` or `PAYING`; `tier_remaining = allotment − sold − held`; `pool_remaining = capacity − Σ(sold + held)`; **`available = min(tier_remaining, pool_remaining)`**. Derived, never stored. |
| **The axis** | All timestamps are `YYYY-MM-DDTHH:MM:SS` strings on the calendar named by `timezone_label`; arithmetic is integer seconds on that axis; windows are half-open `[open, close)`. |
| **Tick** | Evaluating one command: `advance(at)` first (expire, time out, close off-sale entries, fill waitlists), then the command. |

## 3. Synthetic venue and defect catalog

**The Foundry Hall (invented), "Synthetic Night (fixture)"**, starts 2027-03-20 20:00, doors 19:00, on sale 2026-12-01 10:00 to the start.

| Pool | Kind | Capacity | Tiers (allotment · price · window) |
|---|---|---|---|
| FLOOR | GA | 800 | EARLY 200 · $25.00 · 2026-12-01 10:00 → 2027-01-16 00:00 · ADV 400 · **$34.99** · 2026-12-01 10:00 → 2027-03-20 17:00 · DOOR 300 · $45.00 · 2027-03-20 17:00 → 20:00. **Allotments total 900 over 800.** |
| BALCONY | RESERVED | 216 | BALC 216 · $60.00 · whole window. Sections A, B, C × rows A–F × 12 seats. |

Rules: hold TTL 10 min · offer TTL 1,440 min · payment timeout 30 min · max 8 per order · orphan rule on · `HEAD_BLOCKS` · `DROP` · service fee $3.50 per ticket · refund policy 30+ days 100 % + fee, 7–29 days 50 % fee kept, under 7 days 0 % · cancellation 100 % + fee.

700 customers (`C-0001..C-0700`; `C-0001..C-0022` are trap actors). Background demand is 150 EARLY, 290 ADV, 190 BALC and 110 DOOR buying sessions (hold → 80 % pay within 1–8 min, 8 % release, 12 % abandon; 7 % of payments fail), 32 refund attempts spread over the three windows, 85 % of live tickets scanned from 19:00. Waitlist joins happen when a session is refused for capacity; offers are accepted 70 %, declined 15 %, ignored 15 %.

**Traps (`fixtures/answer_key.csv`, 76 commands + 3 state assertions):**

| Group | Traps | What they pin |
|---|---|---|
| Windows | T01 `SALES_NOT_OPEN` the day before · T02 the opening second is on sale · T63/T64 `TIER_NOT_ON_SALE` for DOOR early and EARLY late · T78/T79 `SALES_CLOSED` at 20:40 | D-9 half-open windows |
| Holds & payments | T03 `HOLD_ID_DUPLICATE` · T04 `HOLD_NOT_YOURS` · T05–T08 pay, confirm, replayed webhook `PAYMENT_DUPLICATE`, `PAYMENT_UNKNOWN` · T14–T19 qty 9, qty 0, exactly 8, release, release twice, pay a released hold · T31–T37 **`PAID_AFTER_TIMEOUT`** at +32 min, then a failed payment and `HOLD_NOT_HELD` · T38–T40 release after expiry, unknown hold | D-12, D-13 |
| Seats | T09 seats on GA · T10 reserved without seats · T11 `SEAT_UNKNOWN` · T12 `SEAT_DUPLICATE` · T13 `TIER_UNKNOWN` · T20–T23 pair at the aisle, **`ORPHAN_SEAT`** for 04–05 next to 01–02, adjacent pair fine, `SEAT_TAKEN` · T26/T27 **one second before expiry still taken; at the expiry second free** · T28 pay an expired hold | D-12, D-14 |
| Refunds | T41 full refund incl. fee at 75 days = 6,350 ¢ · T42 twice · T43 `ORDER_NOT_YOURS` · T44 `TICKET_NOT_IN_ORDER` · T45 `ORDER_UNKNOWN` · T50 **half refund floors 3,499 → 1,749** at 19 days · T54 50 % at 8 days · T62 `REFUND_WINDOW_CLOSED` at 5 days · T77 `TICKET_CHECKED_IN` | D-16 |
| Waitlist | T46 `WAITLIST_NOT_NEEDED` · T47 off-sale tier · T48 unknown target · T49 unknown entry · T51–T53 head joins for 4, second for 2, duplicate · **T54/T55 2 seats free → nobody offered (head wants 4)** · **T56/T57 4 seats free → head offered the 4, second offered the 2** · T58 `HOLD_NOT_YOURS` on an offer · T59/T60 accept and confirm · **T61 the ignored offer expired at 24 h and was dropped** | D-15 |
| Pool | **T66–T72** the box office fills the floor to one seat; last ticket held; **`SOLD_OUT_POOL` while DOOR shows 87 of allotment**; DOOR waitlist join; at the hold's expiry second the freed ticket goes to the waitlist head, not to the walk-up (`SOLD_OUT_POOL` again); head accepts; state: `FLOOR pool_remaining=0 DOOR tier_remaining=87` | D-11, D-15 |
| Door | T65 `DOORS_NOT_OPEN` at 18:30 · T73 scan · T74 `ALREADY_CHECKED_IN` · T75 `TICKET_REFUNDED` · T76 `TICKET_UNKNOWN` | D-18 |

Not in the fixture (covered by goldens only): event cancellation (GT-11), `SKIP_TO_FIT` refusal (GT-13), orphan rule off (GT-05e), concurrent last-seat casts (Phase 2 test).

## 4. HOLD rules (closed set, precedence order)

A `HOLD` carries `customer`, `ref` (client hold id), `tier_id`, and either `qty` (GA) or `seats` (reserved).

| # | Check | Code |
|---|---|---|
| H-1 | event cancelled | `EVENT_CANCELLED` |
| H-2 | `at < sales_open_at` | `SALES_NOT_OPEN` |
| H-3 | `at >= sales_close_at` | `SALES_CLOSED` |
| H-4 | tier id not in event | `TIER_UNKNOWN` |
| H-5 | `not (on_sale_at <= at < off_sale_at)` | `TIER_NOT_ON_SALE` |
| H-6 | hold id already used | `HOLD_ID_DUPLICATE` |
| H-7 | reserved tier with no seats / GA tier with seats | `SEATS_REQUIRED` / `SEATS_NOT_ALLOWED` |
| H-8 | `qty < 1` (reserved: `qty = len(seats)`) | `QTY_INVALID` |
| H-9 | `qty > max_tickets_per_order` | `QTY_OVER_LIMIT` |
| H-10 (reserved) | same seat twice → unknown seat → seat on another tier → any seat not `OPEN` → orphan created | `SEAT_DUPLICATE` → `SEAT_UNKNOWN` → `SEAT_TIER_MISMATCH` → `SEAT_TAKEN` → `ORPHAN_SEAT` |
| H-11 (GA) | `pool_remaining < qty` | `SOLD_OUT_POOL` (detail: pool and tier remaining) |
| H-12 (GA) | `tier_remaining < qty` | `SOLD_OUT_TIER` |
| H-13 | otherwise: hold created, `expires_at = at + hold_ttl`, price and fee frozen | `HELD` |
| H-14 | `RELEASE`: unknown → not yours → expired → released → not `HELD` → released, inventory back, fill | `HOLD_UNKNOWN` → `HOLD_NOT_YOURS` → `HOLD_EXPIRED` → `HOLD_RELEASED` → `HOLD_NOT_HELD` → `RELEASED` |

Orphan (D-14): an `OPEN` seat with both neighbours present and not `OPEN`. The hold is refused if the row's orphan count after is greater than before.

## 5. Payment rules

| # | Rule | Code |
|---|---|---|
| P-1 | `PAY_START`: hold unknown / not yours / expired / released / not `HELD` | `HOLD_UNKNOWN` → `HOLD_NOT_YOURS` → `HOLD_EXPIRED` → `HOLD_RELEASED` → `HOLD_NOT_HELD` |
| P-2 | payment id already used | `PAYMENT_ID_DUPLICATE` |
| P-3 | otherwise `HELD → PAYING`, `pay_timeout_at = at + payment_timeout`, amount `qty × (price + fee)`; the cart TTL no longer applies | `PAYING` (detail: payment id, amount) |
| P-4 | `advance`: `PAYING` with `pay_timeout_at <= at` → `PAY_TIMEOUT`, inventory back, fill | — |
| P-5 | `PAY_SUCCEEDED` / `PAY_FAILED` with unknown payment id | `PAYMENT_UNKNOWN` |
| P-6 | webhook for a payment not `PENDING` | `PAYMENT_DUPLICATE` (no-op) |
| P-7 | `PAY_SUCCEEDED` on `PAYING` → order, tickets `T-nnnnn` with codes, seats `SOLD`, entry `FULFILLED` if an offer · on `PAY_TIMEOUT` → full refund `PAID_AFTER_TIMEOUT`, no tickets · on `CANCELLED` → full refund `PAID_AFTER_CANCEL` | `CONFIRMED` / `PAID_AFTER_TIMEOUT` / `PAID_AFTER_CANCEL` |
| P-8 | `PAY_FAILED` on `PAYING` → `PAY_FAILED`, inventory back, offer entry `OFFER_PAY_FAILED`, fill | `PAYMENT_FAILED_RELEASED` |

## 6. Waitlist rules

| # | Rule | Code |
|---|---|---|
| W-1 | `WAITLIST_JOIN` inside the sales window (H-1..H-3 apply); target is a GA tier on sale or a reserved section; `qty` in `[1, max]` | `TIER_NOT_ON_SALE` / `WAITLIST_TARGET_UNKNOWN` / `QTY_INVALID` / `QTY_OVER_LIMIT` |
| W-2 | the target can serve you now — GA `available >= qty`; reserved: a contiguous block of `qty` passes the orphan rule | `WAITLIST_NOT_NEEDED` |
| W-3 | an active (`WAITING`/`OFFERED`) entry for the same customer and target | `WAITLIST_DUPLICATE`; otherwise `WAITLISTED` (`W-nnnn`) |
| W-4 | fill, per target, FIFO by `(joined_at, entry_id)`: if the head fits (GA `available >= qty`, tier on sale; reserved: lowest row, lowest start block passing the orphan rule) create offer `O-nnnn` (kind `OFFER`, `expires_at = at + offer_ttl`, head → `OFFERED`) and test the next head; **if the head does not fit, stop for that target** | — |
| W-5 | `advance`: a `WAITING` entry whose GA tier has `off_sale_at <= at` → `CLOSED_OFF_SALE` | — |
| W-6 | an offer that expires → entry `OFFER_EXPIRED` (dropped), fill again in the same tick; offer `RELEASE` → `OFFER_DECLINED`; offer payment failed → `OFFER_PAY_FAILED`; offer confirmed → `FULFILLED` with `order_id` | — |
| W-7 | `WAITLIST_LEAVE`: unknown or not active → `WAITLIST_UNKNOWN`; not yours → `WAITLIST_NOT_YOURS`; an `OFFERED` entry whose offer is `PAYING` cannot be left (`HOLD_NOT_HELD`); otherwise the offer (if `HELD`) is released and the entry is `LEFT`, fill | `WAITLIST_LEFT` |

## 7. Refunds, cancellation, check-in

| # | Rule | Code |
|---|---|---|
| R-1 | `REFUND_REQUEST(order, tickets[])`: order unknown → not yours → a ticket not in the order (or none given) | `ORDER_UNKNOWN` → `ORDER_NOT_YOURS` → `TICKET_NOT_IN_ORDER` |
| R-2 | any listed ticket already refunded / checked in | `TICKET_ALREADY_REFUNDED` → `TICKET_CHECKED_IN` |
| R-3 | `days_before = floor((starts_at − at) / 86400)`; first policy row with `min_days_before <= days_before` | — |
| R-4 | that row has `refund_bps = 0` | `REFUND_WINDOW_CLOSED` (detail: days) |
| R-5 | per ticket: `price × bps // 10000` (+ fee if `fee_refunded`); ticket `REFUNDED`; seat `OPEN`; refund row `R-nnnnn` reason `CUSTOMER_<days>_DAYS`; fill | `REFUNDED` (detail: refund ids, total, bps, days) |
| R-6 | money: `captured = Σ amounts of SUCCEEDED and SUCCEEDED_LATE payments`; `refunded = Σ refunds`; `net = captured − refunded` | — |
| X-1 | `CANCEL_EVENT`: every `ISSUED`/`CHECKED_IN` ticket refunded at `cancellation_refund_bps` plus fee, reason `EVENT_CANCELLED` | `EVENT_CANCELLED_OK` (detail: tickets, cents) |
| X-2 | every `HELD`/`PAYING` hold → `CANCELLED`, seats `OPEN`; every `WAITING`/`OFFERED` entry → `CLOSED` | — |
| X-3 | later commands → `EVENT_CANCELLED`, except `PAY_SUCCEEDED` (P-7) and `CANCEL_EVENT` | `ALREADY_CANCELLED` |
| X-4 | the fill never runs after cancellation | — |
| C-1 | `CHECK_IN(ticket)`: unknown | `TICKET_UNKNOWN` |
| C-2 | refunded | `TICKET_REFUNDED` |
| C-3 | `at < doors_at` | `DOORS_NOT_OPEN` (detail: doors time) |
| C-4 | already checked in → detail is the first scan time; otherwise checked in | `ALREADY_CHECKED_IN` / `CHECKED_IN` |

Ticket code: `sha256(event_id | ticket_id | ticket_salt)` hex, first 20 characters.

## 8. Derived numbers and the commitment

Inventory rows per tier and per pool: `capacity, sold, held, refunded, remaining, available` (§2). Summary: commands / ok / rejected, by code, orders, tickets issued / live / refunded / checked in, captured / refunded / net cents, holds by kind and state, waitlist by state, offers made, and the **commitment** = `sha256(canonical({event_id, tickets:[{ticket_id, order_id, tier, seat, state, refunded_cents, code}] sorted by ticket_id, captured_cents, refunded_cents}))` with canonical JSON = sorted keys, no whitespace, ASCII. The commitment is the one number the shuffle proof and the Phase 2 recount compare.

## 9. Golden cases (GT-01..GT-18)

Exact values; `tools/golden_answers.py` prints each and ends with OK. Base event for the goldens: FLOOR 10 with EARLY 4 · ADV 6 ($34.99) · DOOR 5; BALCONY 12 = section A, row A, 12 seats; same rules as the fixture except offer TTL 60 min.

| # | Case | Value |
|---|---|---|
| GT-01 | canonical JSON `{"b":[2,1],"a":"x"}`; `sha256("")` | `{"a":"x","b":[2,1]}`; `e3b0c442…b855` |
| GT-02 | ticket code for `EV-SYNTH-001`, `T-00001`, fixture salt | `0624bed1c5bafa86566d` |
| GT-03 | pool truth: EARLY 4 + ADV 6 sold → DOOR `tier_remaining 5, pool_remaining 0, available 0`; DOOR hold → `SOLD_OUT_POOL`; refund one EARLY at 75 days → 2,850 ¢; then DOOR hold `HELD` while EARLY (off sale) shows `remaining 1, available 0` | as stated |
| GT-04 | hold TTL: hold 6 ADV at 10:00:00; hold at 10:09:59 → `SOLD_OUT_TIER`; at 10:10:00 → `HELD` and the first is `EXPIRED` | boundary inclusive |
| GT-05 | orphan: 01–02 held; 04–05 → `ORPHAN_SEAT`; 03–04 → `HELD`; 05–11 → `HELD` leaving 12 open; 12 alone → `HELD`; with the rule off 04–05 → `HELD` | as stated |
| GT-06 | days before 2027-03-20 20:00: 02-18 19:00 → 30 (100 %); 02-18 21:00 → 29 (50 %); 03-13 20:00:00 → 7 (50 %); 03-13 20:00:01 → 6 (0 %) | floor on the axis |
| GT-07 | half refund of one $34.99 ticket → 1,749 ¢; second ticket at 5 days → `REFUND_WINDOW_CLOSED`; full refund of one $34.99 ticket → 3,849 ¢ | fee kept / fee back |
| GT-08 | pay start 10:01; webhook 10:31:00 → `PAID_AFTER_TIMEOUT`, refund 7,698 ¢, 0 tickets, pool 10; webhook 10:30:59 → `CONFIRMED`, 2 tickets; pay start 10:09 on a 10:00 hold then webhook 10:25 → `CONFIRMED` (cart TTL off while paying) | as stated |
| GT-09 | HEAD_BLOCKS: ADV sold out; w1 wants 4, w2 wants 2; refund 2 → both `WAITING`; refund 2 more → w1 `OFFERED O-0001` (4), w2 `OFFERED O-0002` (2), ADV available 0; w2 paying O-0001 → `HOLD_NOT_YOURS`; w1 pays → `CONFIRMED`, `FULFILLED`, `via_offer` | as stated |
| GT-10 | DROP: w1 offered O-0001 at 10:00, w2 waiting; w1 pays at 11:00 → `HOLD_EXPIRED`, w1 `OFFER_EXPIRED`, w2 `OFFERED O-0002` expiring 12:00 | same tick |
| GT-11 | cancel: 2 balcony tickets (one checked in) + a paying hold → `tickets=2 refunded_cents=12700`; hold `CANCELLED`, seat `OPEN`; late webhook → `PAID_AFTER_CANCEL` 3,849 ¢; hold after → `EVENT_CANCELLED`; cancel again → `ALREADY_CANCELLED`; net 0 | as stated |
| GT-12 | replayed success and a later failure on a settled payment → `PAYMENT_DUPLICATE`, `PAYMENT_DUPLICATE`; 1 ticket `ISSUED` | idempotent |
| GT-13 | `waitlist_rule: SKIP_TO_FIT`, `offer_expired_rule: REQUEUE`, a policy not ending at 0, a policy out of order, reserved capacity ≠ seats | `RULES_INVALID` each |
| GT-14 | 5 commands forward and reversed → same codes `HELD, SOLD_OUT_TIER, PAYING, CONFIRMED, HELD` and the same commitment; same-second tie decided by `cmd_id` | order independence |
| GT-15 | precedence: the day before with unknown tier and qty 99 → `SALES_NOT_OPEN`; in window → `TIER_UNKNOWN`; DOOR early → `TIER_NOT_ON_SALE`; ADV qty 99 → `QTY_OVER_LIMIT`; BALC same seat twice → `SEAT_DUPLICATE` | one code |
| GT-16 | scan at 18:59:59 → `DOORS_NOT_OPEN`; 19:00:00 → `CHECKED_IN`; 19:00:01 → `ALREADY_CHECKED_IN` detail `2027-03-20T19:00:00`; refund → `TICKET_CHECKED_IN` | as stated |
| GT-17 | hold at 19:59:59 → `HELD`; at 20:00:00 → `SALES_CLOSED` | half-open |
| GT-18 | waitlist join with 6 available → `WAITLIST_NOT_NEEDED available=6`; a checkerboard row (rule off) leaves 5 singles: `remaining 5`, can serve 1 but not 2; join for 2 → `WAITLISTED`; join for 1 → `WAITLIST_NOT_NEEDED` | shape-aware |

## 10. Fixture facts the engine must reproduce (GQ)

| # | Fact | Value |
|---|---|---|
| GQ-01 | commands / ok / rejected | 2,662 / 2,510 / 152 |
| GQ-02 | reject codes exercised | 35 of 41 (unexercised: `KIND_UNKNOWN`, `SEAT_TIER_MISMATCH`, `PAYMENT_ID_DUPLICATE`, `WAITLIST_NOT_YOURS`, `ALREADY_CANCELLED`, `EVENT_CANCELLED`) |
| GQ-03 | EARLY first `SOLD_OUT_TIER`; ADV first `SOLD_OUT_TIER` | 2027-01-06T13:39:47; 2027-02-24T09:34:58 |
| GQ-04 | end inventory | EARLY 200 · sold 187 · refunded 14 · remaining 13 · **available 0** / ADV 400 · 400 · 16 · 0 · 0 / DOOR 300 · 213 · 0 · **remaining 87 · available 0** / BALC 216 · 204 · 17 · 12 · 12 / FLOOR 800 · **800** · 30 · 0 · 0 / BALCONY 216 · 204 · 17 · 12 · 12 |
| GQ-05 | orders; tickets issued / live / refunded / checked in | 451; 1,051 / 1,004 / 47 / 802 |
| GQ-06 | money (¢): captured / refunded / net; refunds | 4,618,132 / 137,682 / 4,480,450; 48 (47 customer = 129,984; 1 paid-after-timeout = 7,698) |
| GQ-07 | gross by tier (¢) and total fees | ADV 1,455,584 · BALC 1,326,000 · DOOR 958,500 · EARLY 502,500; fees 367,850 |
| GQ-08 | holds | 447 `HOLD_CONFIRMED` · 77 `HOLD_EXPIRED` · 40 `HOLD_RELEASED` · 31 `HOLD_PAY_FAILED` · 1 `HOLD_PAY_TIMEOUT` · 4 `OFFER_CONFIRMED` · 1 `OFFER_EXPIRED` |
| GQ-09 | waitlist | 75 entries: 46 `CLOSED_OFF_SALE` · 24 `WAITING` · 4 `FULFILLED` · 1 `OFFER_EXPIRED`; 5 offers; by target ADV 32 · EARLY 16 · B 15 · A 9 · C 2 · DOOR 1 |
| GQ-10 | commitment | `d4d64203ae84f69cbc2b4e42e4297ac7dc01c151465dd147b7ce4638fef61d43` |
| GQ-11 | answer key | 76 command traps agree; 3 state assertions (T55, T57, T72) hold |

## 11. Reference measurements (kickoff, seed 20261109)

`python3 -I tools/reference_alloc.py --shuffle 5` prints, in this order: header; commands/ok/rejected; by-code table (count desc, name asc); inventory table (tiers then pools); orders and ticket counts; money line; refunds by reason; holds by kind+state; waitlist line and states; commitment; shuffle line. The full output is `fixtures/reference_output.txt`; `npm run inventory:eval` must print the same fields in the same order.

By-code table (45 codes seen): CHECKED_IN 802 · HELD 596 · PAYING 483 · CONFIRMED 451 · SOLD_OUT_TIER 99 · WAITLISTED 75 · RELEASED 40 · PAYMENT_FAILED_RELEASED 31 · REFUNDED 30 · REFUND_WINDOW_CLOSED 7 · HOLD_EXPIRED 4 · WAITLIST_DUPLICATE 4 · TIER_NOT_ON_SALE 3 · HOLD_NOT_YOURS 2 · HOLD_RELEASED 2 · SALES_CLOSED 2 · SEAT_TAKEN 2 · SOLD_OUT_POOL 2 · and 27 codes seen once.

Command kinds: HOLD 712 · PAY_START 490 · PAY_SUCCEEDED 454 · PAY_FAILED 31 · RELEASE 43 · WAITLIST_JOIN 83 · WAITLIST_LEAVE 1 · REFUND_REQUEST 42 · CHECK_IN 806 · CANCEL_EVENT 0.

## 12. Frozen fixtures

Generated once: `python3 -I tools/build_fixtures.py --seed 20261109` then `python3 -I tools/reference_alloc.py --write-expected --shuffle 5 > fixtures/reference_output.txt` then `python3 -I tools/verify_fixtures.py --write-manifest`. Product code never reads `answer_key.csv` or `expected_*`; only `inventory:eval` does.

| File | sha256 |
|---|---|
| `event.json` | `291f4fced7f7428293cbca0adacf9318532d3bbb1dcf7e70098410aa2f937de9` |
| `customers.csv` | `459d372195f1524364e7dea74ba6c2d660bfd317eecb6cb22cbe5c689a553e40` |
| `commands.csv` | `4718068e32b2bf07a35aacae6b6ef8482822d420156f239e8ea93bae3367b4c0` |
| `answer_key.csv` | `2ec6190b194defce1de03135f35dd20fee4a2352a53ee7bc1fbab151071137c8` |
| `expected_commands.csv` | `6fa76dd45bf33719efad5f2ed80e0b70a6d2880d5a0548ef40d631a6df7b41c4` |
| `expected_inventory.csv` | `6935bf0c2670c7fbdda95ddce72a18fc073e0b71e92cafca3212439ee0bad964` |
| `expected_orders.csv` | `d0501ae774fc1e15e49007388c885884d6eed5232cf55c636836b3407ae21c52` |
| `expected_tickets.csv` | `884d32745dd686ebc7658b21e985d4672439c03653166c96fb16bb5cee7d328e` |
| `expected_waitlist.csv` | `4f9ac54daec14b6003f164b93b49f113db923c0406f72a2fd66881032eb0fdea` |
| `expected_refunds.csv` | `d7c0e215efb8a97ae857a244f0f58ab5beb8379a997254155dc513a27fd30c60` |
| `expected_summary.json` | `44f1727709cab54741027e9777f3e82068a867dced6466523abde93d208222af` |

`fixtures/MANIFEST.json` carries the same table. Tool hashes at kickoff: `inventorylib.py bae6bcae…e284`, `build_fixtures.py 34eddda1…a2bf`, `reference_alloc.py fc7d8b90…b735`, `golden_answers.py 505f0bdf…ac05`, `verify_fixtures.py ccf7d787…0183`.
