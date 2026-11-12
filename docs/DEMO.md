# DEMO — Turnstile

A 10-minute walk through an invented 1,016-seat hall's ticketing engine. **Synthetic data only, Stripe test mode only, no claim about any venue's policy, ticketing law or fire code.** Every command below was run once on 2026-11-12 (local Mac, Postgres 17, port 7700) before this file was committed.

## Before you start (once)

```bash
cd ~/Projects/turnstile
git checkout phase-2                 # PR #2 is unmerged; this is the branch
npm run seed:demo                    # six demo accounts; prints the TOTP secret
npm run turnstile:load -- --org acme    # fresh event, nothing sold  (refuses a second run: write-once)
npm run turnstile:load -- --org globex  # then fill this one to the end of the night:
npm run turnstile:cast -- --org globex  # 2,662 commands, ~34 s, Stripe recorded; refuses a second run
npm run dev                          # http://localhost:7700 — stop other dev servers first (swapcheck warns under 30% free)
```

**Accounts.** Open `/demo`, click an email, no password (needs `DEMO_MODE=1`, which `.env.local` already sets; `/demo` is a 404 without it). Use **owner@acme.demo.test** (fresh event) and **owner@globex.demo.test** (end of night). Owners and admins are TOTP-enrolled for the real sign-in path; the secret is printed by `seed:demo` and is a public demo value. No Stripe key is needed for any step here.

## Screen by screen

**0. The numbers first (terminal, 1 min).**
```bash
npm run inventory:eval     # ends: "eval: 7 expected files and expected_summary.json match (2662 commands)"
npm run fixtures:check     # ends: OK (hashes, golden answers, no fixture drift)
npm run inventory:lint     # ends: "inventory:lint OK (12 files under src/inventory; ... 6 Turnstile screen files, no arithmetic)"
```
Say: *the engine agrees with a separate Python oracle on 2,662 commands, 152 rejects over 35 codes and 79 named traps, by the same author. That is agreement with the spec, not proof the spec is right.* The commitment hash `d4d64203…61d43` is the same in the eval, in a 20-shuffle test and after the database round trip.

**1. End of night — signed in as owner@globex → Events → Synthetic Night (fixture).**
Open `/o/globex/events/EV-SYNTH-001`. Say: *the pool is the truth, available is derived.*
- **DOOR** tier: `87 remaining · 0 available — pool sold out`. The tier still has 87 left on paper, but the shared FLOOR pool (800) is gone. Hover it, or open "How is N worked out?": `min(tier remaining 87, pool remaining 0) = 0`. That is pool-before-tier.
- **BALC**: `12 remaining · 12 available`. Reserved balcony, 204 of 216 sold; the 12 left are what the orphan rule allows.
- The tier allotments add up to more than the pool (that is the point of a shared pool).

**2. Ledger — `…/ledger`, then "Download CSV" (`…/ledger/csv`).**
Totals: captured **$46,181.32**, refunded **$1,376.82**, net **$44,804.50** (4,618,132 / 137,682 / 4,480,450 ¢). One line per captured payment, 452 lines: late money has no order, so a per-order ledger would miss one refund. Check it live:
```bash
python3 -c "import csv,sys;r=list(csv.DictReader(open(sys.argv[1])));print(len(r),[sum(int(x[k]) for x in r) for k in('captured_cents','refunded_cents','net_cents')])" ~/Downloads/ledger.csv
# 452 [4618132, 137682, 4480450]
```
Say: *money is integer cents; refunds are `price × bps // 10000` and the remainder stays with the venue.* One refund (7,698 ¢) is `PAID_AFTER_TIMEOUT`: the customer paid after the hold timed out, so they were refunded in full and seated nowhere.

**3. Box office — `…/box` (globex).** Pick an order, tick tickets, **Preview refund**: days-before, window %, fee kept and refunded, a line per ticket and a total. The preview is the real command run in memory with nothing written; "Refund $X" casts it and the Refund row equals the preview to the cent. Waitlists show FIFO order, the head pilled, **no skip control** (`SKIP_TO_FIT` is a rules error).

**4. Door — `…/door` (globex).** Scan a ticket code from the Buy screen's tickets list: first scan checks in; a second says `ALREADY_CHECKED_IN` with the first scan time; a refunded ticket says refused; a made-up code says no ticket for this event matches it. Counts: checked in / live / still to arrive come from the read model, not the page.

**5. Live sale — sign in as owner@acme (nothing sold yet).**
1. Event screen (`/o/acme/events/EV-SYNTH-001`): the sales window opens 2026-12-01, so the server clock has to move. Enter `2026-12-01T10:00:00` in **Set the event clock to**, click **Set clock** (D-35; staff-only, audited, can only move forward past the log).
2. **Buy** (`…/buy?as=C-0001`, heading "Buy · acting as C-0001"; the picker is staff-only, D-32). Choose a tier, quantity 2, **Hold tickets** → result `OK HELD H-xxxxxxxx` and a ticking countdown (display only; the server decides, D-34).
3. **Pay** → the hold becomes PAYING: "PaymentIntent pi_… Recorded Stripe (no publishable key here): the tickets are issued when the signed webhook arrives." That sentence is true: with no key the hold waits for a signed success webhook. The **hold-versus-webhook race** has a named outcome: a success after the payment timeout is `PAID_AFTER_TIMEOUT` (full refund, no tickets); a duplicate is `PAYMENT_DUPLICATE`.
4. Set the clock 11 minutes later, refresh Buy: the unpaid hold has expired; the seats are back in the pool.
5. Reserved seats (Balcony section A): tick seats leaving one open seat between two taken ones → `ORPHAN_SEAT`, refused with a reason.

To see a payment complete without a Stripe key, the e2e specs post the signed webhook the way Stripe would: `npx playwright test e2e/buy.spec.ts` (empties the **test** database, builds and serves the production app, ~2 min; do not run it while vitest runs, they share `turnstile_test`).

**6. Proof through the database (terminal, 1 min).**
```bash
npm run inventory:eval:db   # empties turnstile_test; ~34 s
# ends: "eval:db: readEvent = recount from rows = log replay = 7 expected files ... commitment d4d64203…61d43"
#       "outbox (D-33): 451 order confirmations · 5 offer notices · 0 sent or drainable"
```
Say: *the same 2,662 commands through the real cast path, rows in Postgres, and three independent derivations agree. Nothing is sent: notices stop in the outbox.*

## Live Stripe round trip (yours, by hand — not yet run, EVAL O-8)

Needs your test keys in `.env.local` (never in the repo, a cloud session or CI): `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`. Then:
```bash
stripe listen --forward-to localhost:7700/api/checkout/webhook   # prints the whsec_ to paste as STRIPE_WEBHOOK_SECRET
```
Buy with card 4242 4242 4242 4242, then refund one ticket in the box office; record the PaymentIntent and Refund ids in `docs/EVAL.md`. Until you do, say "Stripe boundary tested against recorded payloads and a fixture signing secret", not "works with Stripe".

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/demo` is a 404 | `DEMO_MODE` unset | `grep -c '^DEMO_MODE=1' .env.local` should be 1; restart the server |
| `/demo` says "No demo users yet" | not seeded | `npm run seed:demo` |
| `turnstile:load` says "refused … already loaded" | write-once | expected; use the org that has the event, or empty the Turnstile tables |
| `turnstile:cast` says "refused: commands already cast" | same | expected |
| Hold button answers a rejection code (e.g. `NOT_ON_SALE`) | event clock before 2026-12-01 | set the clock (step 5.1) |
| Sign-in via curl returns 403 | origin check | add `-H 'Origin: http://localhost:7700'` (a browser does this itself) |
| Port 7700 busy | another run | `lsof -ti :7700` and stop it; never two servers on the port |
| Wall of ~1 s failures in e2e | memory pressure | `sysctl -n kern.memorystatus_level` (above 30) before reading a stack trace |
| `too many clients` in a DB test | other projects' sweeps | wait for them to finish, retry once |

## Concede before you are asked

- **The fixture and the oracle share an author.** Agreement is an upper bound on correctness, not a measurement of it (D-24).
- **No venue's policy, no ticketing law, no fire code.** The orphan rule and refund windows are invented, held as data.
- **Stripe is unproven live.** Recorded payloads and a published fixture signing secret; the 4242 round trip is Shane's step and has not been run.
- **Not looked at in a browser by eye**; layout is checked by axe (14 scans, 0 violations) not by taste.
- **Nothing is sent.** Order confirmations and offer notices are queued and made undrainable.
- **Not deployed**, no real buyer accounts (staff act as a fixture customer), one event, one hall, no load test.
- **CI is green on `phase-2`** (run 43063558361) and PR #2 is deliberately unmerged.
