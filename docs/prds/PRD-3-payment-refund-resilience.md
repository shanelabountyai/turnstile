# PRD-3 — Live payment and refund resilience

**Status:** Built (draft PR), 2026-11-24: items 11, 10, 12 and 9 and the nightly demo reset (D-60) on branch `prd-3/payment-refund-resilience`, stacked on `prd-2/demo-safe-to-share` (D-69 to D-74). Not merged, not deployed. **Left out:** item 18 (covered by #13); for item 12, the automatic retry of a refund older than 23 hours (it is counted as needing the owner; the product call is in D-70). **Not verified live:** item 10 is inferred from code, and O-8 has not been run. **Where this file and `docs/decisions.md` disagree, the decisions win:** "Out of scope" below says the reset mechanism is not built; D-60 decided it and D-73 records it as built. The wording of item 9 and of the new messages is proposed and waits for Shane.
**Source:** `docs/audits/FIVE-LENS-2026-11-21.md` §3 PRD-3; review items 9, 10, 11, 12, 18.
**Evidence:** file:line at `9d8b434`, as the review cites it. #9 changed `src/checkout/stripe.ts` and `checkout.ts`, so their lines have moved. Current lines are given where they matter.
**Rules that apply:** Stripe test mode only. No test here calls Stripe: tests use the recorded gateway (D-30). The live behaviour in item 10 is inferred from code until O-8 shows it.

## Problem

The money steps can still end on the error page, and a spent or expiring demo does not tell the visitor what to do next:
- **Pay step.** A Stripe error on Pay, or a failed `clientSecret` call while the Buy page renders, shows the error page.
- **After paying.** The live card form probably comes back after a successful payment.
- **Pending refunds.** A refund left `PENDING_PROVIDER` is retried only by the next refund in the same event.
- **Spent demo.** A spent org says only "Sales closed", and the one-way clock has no warning.
- **Test date.** The hosted e2e stops testing hold/release once the wall clock passes 2026-12-01 10:00.

## Evidence

| Item | Findings | Evidence |
|---|---|---|
| 9 | UX-3, UX-4, UX-15: no pointer to `globex` or the reset when sales are closed; Set clock has no one-way warning; "Back to the wall clock" either fails or moves the clock before sales open | `buy/page.tsx:131-135`; `src/checkout/format.ts:86-91`; `[event]/page.tsx:114-130`; `[event]/actions.ts:27-30` (at `9d8b434`) |
| 10 | UX-6 (**suspected**, live form never rendered): `clientSecret` returns the secret whatever the PaymentIntent's status, so after Stripe's redirect a `PAYING` hold shows the card form again; no "waiting for confirmation", no read of `redirect_status`, no loading text | `src/checkout/stripe.ts:40-42` at `9d8b434` (now `clientSecret` at `stripe.ts:68`); `buy/page.tsx:66`, `:186-188`; `src/components/stripe-pay.tsx:16`, `:41-47` |
| 11 | CODE-4 cases 1, 3, 5; CODE-11; CODE-7: `createPaymentIntent` errors and `PaymentAmountMismatch` throw to the error page; `payStart` checks stored `HELD` without advancing, so it can create an orphan PaymentIntent; `stripeGateway()` falls back silently to the recorded double when the key is missing at runtime | `src/checkout/checkout.ts:17-25` at `9d8b434` (now `:15-27`); `buy/page.tsx:69`; `src/checkout/stripe.ts:21` at `9d8b434` (now `:31`) |
| 12 | CODE-3 (retry part), CODE-12: no Turnstile cron job, and no screen reads `stripeRefundId` | `src/app/cron-jobs.ts`; `tests/checkout/webhook.test.ts:116`; D-56 (3) "Still open" |
| 18 | CODE-9, UX-18: the hold/release branch of `hosted-demo.spec` depends on the wall clock being before sales open; the demo's end date is not recorded | `e2e/hosted-demo.spec.ts:50`; `scripts/seed-hosted.ts:30-32` |

**Overlap with open draft PR #10 (not merged).** #10 also sets `StripeLive.clientSecret` to return null after a refused card (`cf88134`). #10's S5 says `createPaymentIntent` and `clientSecret` still throw to the error page, which is item 11 here. Its product calls 3 (retry job) and 5 (Pay errors inline) are items 12 and 11. Decide those once: the decisions file points to #10 rather than repeating them.

## Scope

1. **Spent-org and clock warnings (item 9), after Decision 3.**
   - In demo mode, when `saleState` is "Sales closed", the Events card and the Buy screen show one line above the customer picker: this org is used up; use `globex` or ask for a reset.
   - Setting the clock past `sales_close_at` asks for confirmation and states the one-way effect.
   - "Back to the wall clock" is hidden or disabled in demo mode when it can only fail or break the walk, with a sentence saying why.
   - The wording is Shane's.
2. **Payment received (item 10).** For a `PAYING` hold whose PaymentIntent is `processing` or `succeeded`, or on a return with `redirect_status=succeeded`, show no card form. Show "Payment received by Stripe; tickets appear when Stripe confirms it". The button says it is loading while Stripe.js loads. Observe the live behaviour during O-8 first.
3. **Pay fails soft (item 11).**
   - A `createPaymentIntent` error leaves the hold `HELD` and shows an inline message.
   - A `clientSecret` failure affects only that hold's form.
   - `payStart` previews the command in memory (as `previewRefund` does) before calling Stripe, and compares the amount before the cast.
   - On `VERCEL_ENV=production` with no `STRIPE_SECRET_KEY`, `stripeGateway()` throws instead of falling back.
4. **Refund retry (item 12).**
   - A clone job in `src/app/cron-jobs.ts` settles every Refund row with NULL `stripeRefundId`.
   - The Ledger shows a count of unsettled refunds.
   - The 24-hour idempotency window applies: a retry after it is a new request to Stripe (#10 S3). Whether to check Stripe for an existing refund first is #10's product call 3.
5. **Calendar-proof e2e (item 18).**
   - `hosted-demo.spec` sets the event clock itself on the fresh database, which is allowed on an empty log.
   - D-49 and `docs/DEPLOY.md` record the demo's calendar end.

## Out of scope

- The reset mechanism itself (Decision 3 options b and c). It needs an exception to D-21 and an owner call before anything is built.
- Any engine rule change (Decision 6).
- Rendering the live Stripe Elements form in CI. It is never rendered without a key, and no key enters CI (non-negotiable 11).
- Seed atomicity and DST (items 21 and 22). They are in PRD-5.

## Acceptance tests

- A `PAYING` hold whose PaymentIntent is `processing` or `succeeded`, or a return with `redirect_status=succeeded`, shows "Payment received by Stripe…" and no card form. This is tested with the recorded gateway reporting that status.
- `createPaymentIntent` throwing leaves the hold `HELD` and shows an inline message. A `clientSecret` failure on Buy affects only that hold's pay form.
- `payStart` on a stored-`HELD` hold that has expired by the event clock calls no Stripe method.
- On `VERCEL_ENV=production` with no `STRIPE_SECRET_KEY`, `stripeGateway()` throws.
- The clone cron settles every Refund row with NULL `stripeRefundId`, and the Ledger shows a count of unsettled refunds.
- With the clock past `sales_close_at` in demo mode, the Events card and the Buy screen show the "used up; use globex or ask for a reset" line above the customer picker.
- In demo mode, setting the clock to a time past `sales_close_at` asks for confirmation and shows the one-way warning.
- `hosted-demo.spec` sets the event clock itself and runs the hold/release branch whatever the wall date.
- `inventory:eval` matches 2,662 commands; `fixtures:check` and `inventory:lint` are OK; no fixture changes.

## Review items covered

9, 10, 11, 12, 18. None is covered by #9. #9 closed the refund-error crash (item 4), but not the retry (item 12).
