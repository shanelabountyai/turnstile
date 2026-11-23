# PRD-1 — Money boundary before O-8

**Status:** covered by #9 (merged 2026-11-23, merge commit `c957f7a`), except the last acceptance test (O-8, Shane's by hand). Recorded as D-54 and D-56.
**Source:** `docs/audits/FIVE-LENS-2026-11-21.md` §3 PRD-1; review items 1, 2, 4, 7.
**Evidence:** file:line at `9d8b434`, as the review cites it. Lines have moved since #9.
**Rules that apply:** synthetic data only; Stripe test mode only; no key in the repo, a cloud session or CI (CLAUDE.md non-negotiable 11). Nothing here claims live Stripe works. Only O-8 can show that.

## Problem

Before #9, Stripe and the ledger could disagree on the README walk in four ways:
1. Both demo orgs sent the same idempotency keys to the one Stripe test account.
2. A declined card followed by a good card kept the money with no tickets.
3. A Stripe failure on a refund showed the error page after the refund was committed.
4. The webhook read the database before it checked the signature.

## Evidence

| Item | Finding | Evidence (at `9d8b434`) |
|---|---|---|
| 1 | CODE-1 (Blocker): engine ids `R-00001` and `O-0001` repeat per event; Stripe keys are account-wide for 24 h | `src/checkout/stripe.ts:32`, `:37`; `src/inventory/engine.ts:203`, `:469`, `:76-77`; `scripts/seed-hosted.ts:18-25` |
| 2 | CODE-2 (Major): after a decline the form re-enables on the same `clientSecret`; a later success is `PAYMENT_DUPLICATE` | `src/components/stripe-pay.tsx:27-34`; `src/inventory/engine.ts:360`, `:402-415`; `src/checkout/checkout.ts:40` |
| 4 | CODE-3 (mapping part), CODE-4 (case 2), CODE-13: only the double's error class is caught, so live refund errors throw after commit | `src/checkout/checkout.ts:52-65`; `src/checkout/stripe.ts:36-39`, `:59` |
| 7 | CODE-6, SEC-3: lookup by `metadata.event_id` before the signature check; 404 for foreign events; a non-UUID id suspected to give 500 | `src/app/api/checkout/webhook/route.ts:13-23`; `src/checkout/checkout.ts:36` |
| — | CODE-12: no test for the three gaps above | `tests/checkout/webhook.test.ts:116` |

## Scope

- Make every Stripe idempotency key `<event UUID>:<id>` (PaymentIntents, refunds, cancels). **Covered by #9.**
- Cancel the PaymentIntent when `PAY_FAILED` answers `PAYMENT_FAILED_RELEASED`, and keep the pay form shut after a refused card. **Covered by #9.** See the note below.
- Map every `StripeLive` error to `StripeProviderError`. The refund stays `PENDING_PROVIDER`, the loop carries on, and the screen says "Refund recorded; Stripe will be told". **Covered by #9.**
- Check the webhook signature before any parse or read. Unsigned gets 400. Signed with a missing, malformed or unknown `event_id` gets 200 "ignored". **Covered by #9.**
- Run O-8 with the longer script in `docs/EVAL.md` and record the ids (D-54). **Not covered. Shane's step.**

**Note on item 2.** Draft PR #10 (open, not merged) is a post-merge review of #9. Its must-fix M1 says a refresh or a failed cancel could still let a paying card follow a declined one. Its fix adds D-58 and a boundary refund. This PRD does not repeat that work. Read #10 before O-8.

## Out of scope

- A retry job for pending refunds in production. That is review item 12, in PRD-3.
- Any engine rule change for a success on a `FAILED` payment. That is Decision 6 in `DECISIONS-NEEDED-2026-11-22.md`.
- A demo-settings lockdown. SEC-1 and SEC-2 were refuted (D-55).

## Acceptance tests (from the review, with status)

| # | Test | Status |
|---|---|---|
| 1 | Casting the first refund in two events (two orgs) sends two different idempotency keys. A retry in the same event sends the same key. | covered by #9 (`tests/checkout/stripe-live.test.ts`, D-56) |
| 2 | Same as test 1, for the first waitlist offer's PaymentIntent (`O-0001`). | covered by #9. #10 says #9's version compared the key with itself and fixes the test (`b555e25`, unmerged). |
| 3 | A recorded `PAY_FAILED` returning `PAYMENT_FAILED_RELEASED` calls `paymentIntents.cancel`. A later `payment_intent.succeeded` for it creates no order. | covered by #9. #10 M1 adds the refund for that late success (unmerged). |
| 4 | After a card error, the pay form does not submit again on the same client secret. | covered by #9 for the same page view. #10 M1: a refresh re-offered the form (fix `cf88134`, unmerged). |
| 5 | A gateway that throws a Stripe connection or API error on refund: the action returns a result and does not throw. `stripeRefundId` stays NULL. The next row is still tried. The screen says "Refund recorded; Stripe will be told". An idempotency error is logged as a bug. | covered by #9 |
| 6 | Webhook: an unsigned POST gets the same 400 whether or not its `event_id` exists, with no database read. A signed event with no `metadata.event_id` gets 200 "ignored". A non-UUID `event_id` never returns 500. | covered by #9 |
| 7 | `inventory:eval` still matches 2,662 commands. `fixtures:check` and `inventory:lint` are OK. No fixture changes. | covered by #9 (gate in its PR body) |
| 8 | O-8 is recorded in `docs/EVAL.md`: one 4242 order and one refund in `acme`, the same in `globex`, and a decline then 4242 on one hold, with ids. | **open.** `docs/EVAL.md:174` says "Not yet run". |

## Review items covered

1 (CODE-1), 2 (CODE-2), 4 (CODE-3 mapping, CODE-4 case 2, CODE-13), 7 (CODE-6, SEC-3). All covered by #9. Test 8 is still open.
