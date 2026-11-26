# NEXT

## ▶ 2026-11-26, afternoon (scheduled independent pre-merge review of #14, #15, #16; D-87)

- **Reviews posted** on all three PRs (comment only). Verdicts: **#14 merge as is**, **#15 merge after must-fixes (fixed, see next line)**, **#16 merge as is** after the stack is updated.
- **One must-fix, on #15, fixed in tests only (`981a8f6`):** `pay-soft.test.ts` and `pay-amount.test.ts` called the Buy action on an event with clock offset 0 and holds cast on 2026-12-01, so 4 of their 19 tests would go red from 2026-12-01 (reproduced with `Date` faked to 2026-12-02). `tests/helpers/clock.ts` pins the event clock; 19 of 19 today and with `Date` faked to 2026-12-02 and 2027-06-01. No assertion and nothing under `src/` changed.
- **Not pushed anywhere else.** #14 and #16 unchanged; this fix is not merged up into `prd-4/first-impression-polish`. After #14 merges, the stack needs updating (#15 onto `main`, then #16 onto #15).
- **#15's conflict with its base** was already resolved by the morning run's merge `cfacf14` (it was `NEXT.md` only, per `git merge-tree` of `d772743` against `445f47a`). Not undone: that would need a force-push.
- **Gate on this branch** (cloud sandbox; Postgres 16 started by hand, migrations by `psql`; `npm ci` with `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true`): lint 0 · typecheck clean · vitest 65 files, 577 passed, 33 skipped, 4 failed (template `inv-34-export`: `_prisma_migrations` does not exist when migrated by `psql`; CI-only) · inventory:lint OK · inventory:eval match (2,662, commitment `d4d64203…61d43`) · fixtures:check OK · inventory:eval:db match (2,662; 483 PaymentIntents, 48 refund calls, 0 pending) · `build:test` rc 0 · Playwright 46 passed. Not run: `foundation:drift` (template tag not reachable; no template-owned path changed). CI decides.
- **Should-fixes left for you** (behaviour or wording) are in D-87 (5) and the three reviews.

---

## ▶ 2026-11-26 (Fable 5.2, scheduled follow-through run, Thanksgiving morning CT): the three stacked draft PRs are merged up to date and their review should-fix items are applied. **Documents and merges only. Nothing merged to `main`, nothing deployed, all three still drafts.**

**Where the three stand.** The "Gated" column is the commit the local gate ran on. Every commit after it on each branch changes documents only (the delta-review rows D-85 and D-86, the merges that carry them up, and this section), so the branch heads are later than these; the PR comments name them.

| PR | Branch, base | Gated | What this run did | Local gate |
|---|---|---|---|---|
| #14 PRD-2 | `prd-2/demo-safe-to-share` → `main` | `ed0d81c` | Confirmed the `445f47a` merge of `main` (#13) kept both sides in `e2e/hosted-demo.spec.ts` and `NEXT.md`. D-82 corrects D-68 (1); acceptance test 2 is partly met, by design. | vitest 500 passed, 33 skipped, 4 failed (sandbox only); Playwright 42 passed |
| #15 PRD-3 | `prd-3/payment-refund-resilience` → `prd-2/demo-safe-to-share` | `c915839` | Merged PRD-2 in (`cfacf14`): **the conflict with its base is resolved**, in three documents, both sides kept. D-83 states the refund retry's limits; the acceptance line on the retry is not fully met. | vitest 577 passed, 33 skipped, 4 failed (sandbox only); Playwright 45 passed and 1 failed, then 46 passed on a second full run |
| #16 PRD-4 | `prd-4/first-impression-polish` → `prd-3/payment-refund-resilience` | `660ce6c` | Merged PRD-3 in (`660ce6c`), conflicts in two documents, both sides kept. D-84: item 13's acceptance is every same-row pair. | vitest 589 passed, 33 skipped, 4 failed (sandbox only); Playwright 59 passed |

On all three: lint 0, typecheck clean, `inventory:lint` OK, `inventory:eval` match (2,662 commands, commitment `d4d64203…61d43`), `fixtures:check` OK, `design:contrast` 0 pairs under the floor, `inventory:eval:db` match (2,662), `next build` rc 0 (as `npm run build:test`). The 4 vitest failures are the template's `inv-34-export` tests, as in every sandbox run before (`_prisma_migrations` does not exist when migrations go in by `psql`); they pass in CI. Exact figures and the sandbox notes are in D-84. **CI decides:** the check results on the pushed heads are in each PR's "Merge checklist (2026-11-26 follow-through)" comment, not here, because they did not exist when this was written.

**One thing to know about the tests:** `e2e/event-clock.spec.ts:49` failed once in a full run on the PRD-3 tree (two alerts matched one locator) and passed 6 of 6 alone and in a second full run. It is intermittent and older than this run (D-84 (4)). If CI goes red on it, re-run the job first.

**No behaviour changed.** Nothing under `src/`, `tests/`, `fixtures/` or `prisma/` was edited by hand; in this run the only code-file change on any branch is `e2e/hosted-demo.spec.ts` arriving from `main` (#13) through the merges. No test was deleted, skipped or weakened. An independent agent given only the commits since each reviewed head found no behaviour change, no weakened test and no dropped side of a merge; its precision points on the record are D-85 and D-86.

**Not done, because it is yours or needs a behaviour change:**
- Closing the refund-retry gap (D-83, D-86) is a change in `src/checkout`: D-70's options (b) or (c).
- Wording: `README.md` ("not reset between visitors", "needs the owner's reset", the *Sales closed* sentence, step 4's "side by side"), `docs/DEPLOY.md` ("leaves the clock on the wall clock", "until the D-60 seed change lands", "decided but not built": all untrue once #15 merges; D-86), `src/checkout/prd3-wording.ts`, the Ledger's "1 refund, 0 of them late money", and the two wording tables in #15 and #16.
- The intermittent `event-clock.spec.ts:49` locator (D-84 (4)).
- The "same hour" assertion in `e2e/hosted-demo.spec.ts` that is now trivially true (D-82 (3)).

**You, in order (carried forward from the 2026-11-25 reviews; none of these was checked by this run):**
1. You: confirm `DEMO_ACCESS_PASSWORD` is 16 or more characters in Vercel. The Production build refuses a shorter one (D-66).
2. You: read #14's "README wording for Shane to approve"; keep it or revert `a7654ad`.
3. You: mark #14 ready and merge it. **That deploys.** Look at the live Event page as `member@acme.demo.test`.
4. You: retarget #15 to `main`. Confirm `STRIPE_SECRET_KEY` is set for Production in Vercel (D-69).
5. You: decide whether merging #15 should turn on the nightly 06:00 UTC reset of the live demo. It also wipes any O-8 test orders from the Ledger. If yes, reword `README.md:26` and the `docs/DEPLOY.md` sentences above; if no, leave #15 unmerged or revert `9eeb816` and the reset parts of `e06da89`.
6. You: read #15's wording table and the refund product call (D-70, D-83), including the Ledger sentence.
7. You: mark #15 ready and merge it. **That deploys.** The next morning read the cron's `cron.done` line: `demoReset` should say `"ran": true`.
8. You: D-76 is recorded as confirmed by you in the PRD-4 session (D-81); say so if that record is wrong. Read #16's wording table.
9. You: retarget #16 to `main`, let CI re-run, mark it ready and merge it. **That deploys.** Look at Buy on a phone and at `/o/acme`.
10. You: O-8, the live Stripe round trip, is still open (`docs/EVAL.md`).

The sections below are the three build runs' own notes. Each of the PRD-3 and PRD-2 sections carries a 2026-11-26 update block; the PRD-4 section's "You, in order" is replaced by the list above.

---

## ▶ 2026-11-24 (Opus 5.5, scheduled run, about 3:30 AM CT): PRD-4 items 13, 14, 15, 16, 17 and 19 built on branch `prd-4/first-impression-polish`. **Draft PR, not merged, nothing deployed. Merging it is a production deploy.**

**Base and merge order (case 1 of the brief).** Open draft PR #15 (`prd-3/payment-refund-resilience`) had "Gate results" in its body, so this branch was cut from it (`a2a361d`) and its PR is based on it. **Merge PRD-2 (#14), then PRD-3 (#15), then this.** `main` had not moved (`4262a62`). PRD-2's and PRD-3's changes are intact.

Built (D-75 to D-80):
- **Item 13, buttons.** `.cluster > button, .cluster > .button { align-self: auto }`; the six dead inline `alignItems` styles deleted; `fieldset.plain` is a flex column with `gap: var(--s-3)`. No new token.
- **Item 16, countdown.** The warning names the hold once ("Two minutes or less left on H-…"). One `<CountdownVoice>` region on the Buy page, outside the holds list, so the zero message survives the refresh (D-78).
- **Item 17.** An accepted hold or payment result whose hold has moved on is no longer echoed (the stale "Payment started" banner is gone once the order exists); the Ledger says "1 order", "1 line", "1 refund"; "Change customer" in the Buy header jumps to the picker (`#as`; D-38's placement kept).
- **Item 19.** An `ORPHAN_SEAT` refusal comes back with the pick ticked, in its section, and names the seat it would strand. Worked out for display from the refused command and the rows; a unit test checks it against `Engine.createsOrphan` on 80,000+ picks. Engine untouched. **This changed README step 4 by one sentence (D-80, its own commit, for you to approve).**
- **Item 15.** Rows stay on one line in a focusable scroll region per section (not 24 px seats: D-75). Seat names start with the visible number ("1, A-A-01 open").
- **Item 14 (D-63).** `/o/acme` shows the event card under a `PageHeader` and has `id="main"`. An org with no event keeps "Nothing here yet" (what `onboarding.spec` asserts for a new org). **That is a reading of D-63 (D-76): confirm it or ask for the heading on both.** The org bar is **not** trimmed (follow-up).

Not built, by the brief: the org bar trim; PRD-5 (items 26, 27, 28); any schema, migration, dependency, engine, fixture or `vercel.json` change.

Independent review (a separate agent, the diff against PRD-4's acceptance tests): 0 must-fix, 5 should-fix, 6 nits. Acted on: two specs that could pass vacuously were tightened, the design page's example seats follow the new naming, D-75 records the always-on tab stop. The rest are listed in the PR.

Gate (cloud sandbox, Postgres 16, migrations by `psql`, `.env.test` with CI's public values), **base `a2a361d` → branch**: tsc clean → clean · lint 0 → 0 · inventory:eval match (2,662, commitment `d4d64203…61d43`) → same · inventory:lint OK → OK · fixtures:check OK → OK · design:contrast 0 pairs under floor → same · vitest 65 files, 577 passed, 33 skipped, 4 failed → 68 files, **589 passed**, 33 skipped, 4 failed (the same 4 template `inv-34-export` tests on both; confirmed on the base in this run: `relation "_prisma_migrations" does not exist`) · inventory:eval:db match on the branch (2,662, 483 PaymentIntents, 48 refunds, 0 pending) · `next build` (`build:test`) rc 0 on the branch · e2e full run on the base with the 11 new PRD-4 tests copied in: 45 passed, 12 failed of 57 (the 11 new ones and the hosted-demo member test) → branch **58 passed, 1 failed** of 59 (the hosted-demo member test, red on the base too; D-68). **Update, 2026-11-24 afternoon:** Shane put the hosted-demo fix on #14 (`3e24bb2`) and it was merged into this branch (`815fbac`): CI on `815fbac` is all green (`ci (off)`, `modules-removed`). D-76 and D-80 confirmed (D-81). axe: 40 runs, 0 violations, including `/o/acme` at 1280 and 390, light and dark. Not run: `foundation:drift` (tag `v1.7.0` not reachable here; no changed path is in `OWNED`, checked by hand). CI per check is in the PR body. CI decides.

**Not verified:** the live site; anything on a real phone (390 px was Chromium's viewport only); anything with a screen reader (the countdown's words and the seat names were checked in the DOM, not heard); Stripe (nothing here touches it).

**You, in order:**
1. You: merge PRD-2 (#14), then PRD-3 (#15), with their own steps (the sections below).
2. You: read "Wording for Shane to approve" in this PR, including README step 4 (D-80). Revert `94432df` only together with item 19's commit `12be10c`.
3. You: confirm D-76 (no "Nothing here yet" above the event card) or ask for the heading on both.
4. You: mark ready, merge. That deploys. (Updated 2026-11-26: the hosted-demo member test has PRD-2's three lines since `815fbac`; nothing waits on it.)
5. You: on the live site, look at Buy on a phone (rows scroll sideways) and `/o/acme` once.

---

## ▶ 2026-11-24 (Fable 5.2, scheduled run, about 12:45 AM CT): PRD-3 items 11, 10, 12 and 9 and the nightly demo reset (D-60) built on branch `prd-3/payment-refund-resilience`. **Draft PR, not merged, nothing deployed. Merging it is a production deploy, and it turns on a nightly wipe and re-seed of the demo orgs.**

**Update 2026-11-26 (Fable 5.2, scheduled follow-through run; a merge and documents only on this branch; D-83).** This section was written for head `a2a361d`. What has changed since:
- **`prd-2/demo-safe-to-share` is merged in** (`cfacf14`; it carries `main`'s #13). Conflicts were in `NEXT.md`, `docs/decisions.md` and `docs/prds/README.md` only, each resolved keeping both sides; nothing under `src/` conflicted or changed. PR #15 no longer conflicts with its base.
- So "Item 18 is not built here: covered by #13 (open)", "`e2e/hosted-demo.spec.ts` untouched", "45 passed, 1 failed" and step 5's "the hosted-demo member test needs the three lines from #14" describe `a2a361d`, not this head: #13 is merged, the spec is PRD-2's, and that test is not red.
- **The refund retry's limits are now stated in the review's words (D-83):** one automatic retry at most; a refund created between 06:00 and 07:00 UTC gets none; a "needs the owner" refund holds the nightly reset back. **PRD-3's acceptance line on the retry is not fully met.** No behaviour changed.
- **D-86 makes that exact:** "one automatic retry" is the nightly job; a box-office refund or a late-payment webhook in the same event still re-sends in-window rows, as D-70 says. `docs/DEPLOY.md` has a third stale clause ("leaves the clock on the wall clock").
- **Wording left for you:** `docs/DEPLOY.md` ("until the D-60 seed change lands", "decided but not built") and `README.md` ("not reset between visitors", "needs the owner's reset") stop being true when this merges.
- The gate and CI on the follow-through head, and your steps in order, are in the PR's "Merge checklist (2026-11-26 follow-through)" comment.

**Read these two before anything else:**
1. **Merging this turns on a nightly wipe and re-seed of the demo orgs on production through the existing 06:00 UTC cron** (only while `DEMO_MODE=1`; D-60, D-73).
2. **You: confirm `STRIPE_SECRET_KEY` is set for Production in Vercel before merging.** With it missing, Pay now fails on the form instead of pretending to work (D-69). The live value was not read here and cannot be.

**Base and merge order.** Open draft PR #14 (`prd-2/demo-safe-to-share`) had "Gate results" in its body, so this branch was cut from it (`ccb15c0`) and its PR is based on it. **Merge PRD-2 (#14) first, then this.** `main` had not moved (`4262a62`). Item 18 is not built here: covered by #13 (open).

Built (D-69 to D-74):
- **Item 11, Pay fails soft.** `payStart` previews the command in memory before it calls Stripe: an expired stored-`HELD` hold calls no Stripe method (the database eval shows it: 484 → 483 recorded PaymentIntents over the 2,662 fixture commands, same commitment). A Stripe failure on Pay leaves the hold `HELD` and comes back as a sentence on the form. One failed card-form lookup costs one hold its form. `stripeGateway()` throws on Production with no key.
- **Item 12, refund retry.** A cron job retries an unconfirmed refund only while the code can show it is under 23 hours old (same idempotency key, inside Stripe's 24-hour window). Older ones are **not retried**, are counted as needing you, and show on the Ledger ("Refunds not yet confirmed by Stripe: N"). After the review the same rule guards the box office and the webhook, which used to re-send every pending refund of the event whatever its age. **Product call for you in D-70** (look the refund up at Stripe first: recommended after O-8).
- **Item 9, warnings.** In demo mode a spent org says so on the Events card and above the customer picker on Buy. A clock move that closes sales asks first and states the one-way effect (in every mode). "Back to the wall clock" is replaced by a sentence when it can only fail or would break the walk. PRD-2's member behaviour is intact. **Every new sentence is in `src/checkout/prd3-wording.ts` and listed in the PR for you to approve.**
- **The nightly reset (D-60).** Demo mode only: empties the 13 Turnstile tables and re-loads both demo orgs with the clock at sales open, in one transaction, after cancelling unsettled PaymentIntents. It refuses, with the reason in the cron's answer, while a refund is unconfirmed, a PaymentIntent could not be cancelled, the fixture files cannot be read, or rows exist outside the demo orgs. The build seed now also starts a fresh load at sales open whatever the date (one existing test expectation changed with that).
- **Item 10, "Payment received by Stripe".** Built from Stripe's documented statuses, **not observed live**. It is the last code commit (`8c35cb7`), so `git revert 8c35cb7` is clean if O-8 shows otherwise; the branch without it was type-checked and its checkout tests run (156 passed).

Not built, by the brief: item 18 (#13), anything from PRD-4 or PRD-5, any schema change, migration, dependency, engine or fixture change, any `vercel.json` change. `e2e/hosted-demo.spec.ts` untouched.

Independent review (a separate agent, the diff against PRD-3 and D-60): 1 must-fix, 5 should-fix, 6 nits. The must-fix (the reset cancelled PaymentIntents before it knew it could finish, and a repeat cancel would have blocked it for good) is fixed with tests. What was not acted on is listed in the PR.

Gate (cloud sandbox, Postgres 16, migrations by `psql`, `.env.test` with CI's public values), **base `ccb15c0` → branch**: tsc clean → clean · lint 0 → 0 · inventory:eval match (2,662, commitment `d4d64203…61d43`) → same · inventory:lint OK → OK · fixtures:check OK → OK · vitest 59 files, 500 passed, 33 skipped, 4 failed → 65 files, **577 passed**, 33 skipped, 4 failed (the same 4 template `inv-34-export` tests on both; confirmed on the base in this run: `relation "_prisma_migrations" does not exist`) · inventory:eval:db match, 2,662, 48 refund calls, 0 pending → same · `next build` (`build:test`) rc 0 → rc 0 · e2e full run 41 passed, 1 failed of 42 → **45 passed, 1 failed** of 46. The 1 failure on both is the hosted-demo member test PRD-2 left for you (D-68); the 4 new specs pass. Not run: `foundation:drift` (the template tag is not reachable here; no changed path is in its `OWNED` list, checked by hand), anything at Stripe. CI per check is in the PR body. CI decides.

**Not verified:** anything live (the site, Vercel's cron, Neon, that the two fixture files reach the cron function on Vercel); anything at Stripe (the replay of an idempotency key, cancelling an already cancelled PaymentIntent, the statuses item 10 relies on, the redirect parameters); the live card form and its loading label; the live value of any variable.

**Left for you, found on the way:**
- The README still says a spent demo "needs the owner's reset" and that the database "is not reset between visitors". After this merges that is no longer the whole story. The README's wording is yours.
- A refund that "needs the owner" also holds the nightly reset back (D-73). D-70 says how to settle one by hand.
- The webhook route still builds `StripeLive` directly (PR #10's call 6): unchanged.

**You, in order:**
1. You: merge PRD-2 (#14) first (its own two steps are in the section below).
2. You: confirm `STRIPE_SECRET_KEY` is set for Production in Vercel.
3. You: read "Wording for Shane to approve" and the refund-retry product call in the PR; change `src/checkout/prd3-wording.ts` if you want other words.
4. You: decide whether the nightly reset should go live now. If not, revert `9eeb816` (and the reset parts of `e06da89`) or leave this PR unmerged.
5. You: get CI green (the hosted-demo member test needs the three lines from #14), mark ready, merge. That deploys.
6. You: the next morning, read the cron's `cron.done` log line: `demoReset` should say `"ran": true`, `refunds` should be all zeros.
7. You: run O-8 with the `docs/EVAL.md` script and the new "watch these" list under its table. If the card form comes back after paying, `git revert 8c35cb7`.

---

## ▶ 2026-11-24 (Opus 5.5, live with Shane): PRD-3 item 18 built on branch `fix/hosted-demo-clock`. PR open, not merged.

- `e2e/hosted-demo.spec.ts` puts both freshly seeded demo events at the moment sales open itself (`clocksToSalesOpen`: the same stored offset `setEventClock` writes, on an empty log), so its hold/release branch runs whatever the wall date. The two `axisNow(new Date()) < '2026-12-01T10:00:00'` branches are gone.
- `docs/DEPLOY.md` records the demo's calendar end, and corrects the reset note: after 2026-12-01 10:00 a reset leaves the clock on the wall clock until D-60's seed change lands.
- No product code, engine, fixture or schema change.

Gate here: `tsc` clean · eslint on the spec clean · `inventory:lint` OK. The e2e was not run here (no Postgres or browser build in this session). CI runs the whole Playwright suite on the PR, but before 2026-12-01 that only shows the spec still passes; the after-the-date path is the same code with a different offset.

**Next:** PRD-2 items 5, 6 and 8 (the password gate, D-61), then the rest of PRD-3 including the D-60 reset.

---

## ▶ 2026-11-24 (Fable 5.2, scheduled run, started 2026-11-23 about 10:25 PM CT): PRD-2 items 5, 6 and 8 built on branch `prd-2/demo-safe-to-share`. **Draft PR, not merged, nothing deployed. Merging it is a production deploy. Two things must happen before the merge.**

**Update 2026-11-26 (Fable 5.2, scheduled follow-through run; documents only on this branch; D-82).** This section was written for head `ccb15c0`. What has changed since:
- **Item 2 below is done.** Shane put the three-line `hosted-demo.spec.ts` change on this branch (`3e24bb2`, 2026-11-24). PR #13 merged to `main` (`7d68ca5`) and `main` was merged in here (`445f47a`), keeping #13's `clocksToSalesOpen()` and unconditional hold/release and this branch's `clock-movers` / no-Set-clock assertions; both `NEXT.md` sections are kept. CI on `445f47a` was green (`ci (off)`, `modules-removed`).
- So "`e2e/hosted-demo.spec.ts` … untouched", "41 passed, 1 failed", "Likely conflict" and step 3 below describe `ccb15c0`, not this head. `docs/decisions.md` D-82 corrects D-68 (1).
- **PRD-2 acceptance test 2 is partly met, by design** (D-67, D-82), not "Met": two visitors on one database, but not two complete walks in one org.
- **One thing is left before the merge, and it is yours:** confirm `DEMO_ACCESS_PASSWORD` is 16+ characters in Vercel (item 1 below). Not checked by any run.
- The gate and CI on the follow-through head are in the PR's "Merge checklist (2026-11-26 follow-through)" comment.

**Before merging, in this order:**
1. **You: confirm `DEMO_ACCESS_PASSWORD` is 16+ characters in Vercel.** The build now refuses a shorter one (D-66). `deploy-env` runs first in the Vercel Production build, so a short live password fails the next Production build (the previous deployment keeps serving). The live value was not read here and cannot be.
2. **One existing e2e test is red on this branch and CI will show it:** `e2e/hosted-demo.spec.ts`, "a demo member can hold and release a ticket, and is refused the event clock". It asserts the error page item 5 removes. The brief forbade editing that file (PR #13 is changing it), so it was left (D-68). The three-line replacement is in the PR body; it goes on whichever of this PR and #13 merges second. Do not merge with it red.

Built (D-65 to D-68; cut from main `4262a62`, which had not moved):
- **Item 5, Set clock for members.** Without `org.update` the Event page shows no clock form and the sentence "Only the organisation’s owner or an admin can move the event clock." The action returns that sentence as `{ error }` instead of throwing; the guard is unchanged. New: `src/checkout/refusal.ts`, `tests/checkout/event-clock.test.ts` (6), `e2e/event-clock.spec.ts` (4).
- **Item 8, password length.** `turnstileProblems` refuses under 16 characters by name; value and length never printed. 2 tests added to `tests/checkout/deploy-env.test.ts`; `docs/DEPLOY.md` row 7.
- **Item 6, the walk for the second visitor.** `e2e/readme-walk.spec.ts` (2 tests): two visitors on one database, every "You should see" line for both. **The walk passed twice** with customers nobody had used. With the README's old `C-0001`/`C-0002` the second visitor fails at step 2 (reproduced). No product code changed for this item. The README edits PRD-2 lists are one commit of their own, **for you to approve** (old and new sentences are in the PR body; revert that commit alone if you do not want them).
- Docs: PRD-2 and the PRD index say "Built (draft PR)"; decisions D-65 to D-68.

Not built, by the brief: nothing from PRD-3, PRD-4 or PRD-5; `e2e/hosted-demo.spec.ts` and branch `fix/hosted-demo-clock` untouched; no schema change, no dependency, no template-owned path.

Found and left for you (README wording PRD-2 does not name; D-67):
- "once someone has done step 7 in an org, the Buy screen there says *Sales closed*" is true only once the event clock passes 20:00, up to an hour later. Straight away ADV reads "off sale" and a hold is refused. The spec asserts both.
- Step 4's "tick two open seats side by side": a second visitor's pair that leaves one open seat beside taken seats is itself refused `ORPHAN_SEAT`.

Gate (cloud sandbox, Postgres 16, migrations by `psql`, `.env.test` written locally with CI's public values), **main `4262a62` → branch**: tsc clean → clean · lint 0 → 0 · inventory:eval match (2,662, commitment `d4d64203…61d43`) → same · inventory:lint OK → OK · fixtures:check OK → OK · vitest 58 files, 492 passed, 33 skipped, 4 failed → 59 files, **500 passed**, 33 skipped, 4 failed (the same 4 template `inv-34-export` tests on both; confirmed on untouched main: `relation "_prisma_migrations" does not exist`) · `next build` (`build:test`) rc 0 → rc 0 · e2e full run 36 passed → **41 passed, 1 failed** of 42 (the hosted-demo member test above; the 6 new tests pass). Mutation checks: the old throwing action with the new page → the direct-post e2e test red; the README's old customers for the second visitor → walk test B red at step 2. Not run: `foundation:drift` (tag `v1.7.0` is not reachable here; the 14 changed paths were compared with its `OWNED` list by hand, none matches), `inventory:eval:db`, anything at Stripe. CI per check is in the PR body. CI decides.

**Not verified:** the live site (nothing was fetched or clicked); the length of the live password; a real Stripe test payment (step 3's card form; O-8 is still yours); how the datetime field displays on a phone or a non-US locale (the spec types the 12-hour form in en-US Chromium only).

**Likely conflict:** PR #13 also adds a section at the top of this file. Keep both.

**You, in order:**
1. You: confirm `DEMO_ACCESS_PASSWORD` is 16+ characters in Vercel (rotate it if not; that needs a deployment).
2. You: read the PR's "README wording for Shane to approve"; keep or revert that one commit.
3. You: decide where the three-line `hosted-demo.spec.ts` change goes (this PR after #13 merges, or #13), and get CI green.
4. You: merge (that deploys). Then check the live Event page as `member@acme.demo.test`.
5. Before the password goes out, D-61 still needs: #10 merged (done, `debe645`) and PRD-2 items 5, 6 and 8 **done**, meaning this PR merged and deployed with a 16+ character password. O-8 is still open and still yours.

---

## ▶ 2026-11-23 (Opus 5.5, live with Shane): PR #11 merged; the five review decisions are recorded as D-60 to D-64 on branch `decisions/review-2026-11-21`. PR open, not merged.

Shane chose "Merge PR #11 + take recs". PR #11 was merged as `8d11afc`. It was docs only, so the `ignoreCommand` should skip the production build.

Recorded in `docs/decisions.md`. These start at D-60 because open draft PR #10 uses D-57 to D-59.
- **D-60:** D-49 is decided. A nightly reset runs in demo mode only, with a D-21 exception for demo mode, and the seed always puts the clock at sales open.
- **D-61:** the review's detail stays in the repo. No password goes out until #10 is merged and PRD-2 items 5, 6 and 8 are done.
- **D-62:** every member is box-office staff.
- **D-63:** the org home gets the event card and `id="main"`.
- **D-64:** the paid-after-failed case is handled at the boundary for now, with the engine rule later (this also answers #10's call 1).

`docs/prds/DECISIONS-NEEDED-2026-11-22.md` and the index are marked decided.

**Update 2026-11-24:** #10 was merged (`debe645`). That was a code change, so it is a production deploy. This branch was then merged with main to resolve the conflicts in `NEXT.md` and `decisions.md`, keeping both sides.

**Nothing from D-60 to D-64 is built.** Next, in order:
1. Build PRD-3 item 18 (e2e sets its own clock) before 2026-12-01 10:00.
2. Build PRD-2 items 5, 6 and 8 (the password gate, D-61).
3. Build the rest of PRD-3, including the reset (D-60).
4. Then PRD-4, then PRD-5.

O-8 is still yours.

---

## ▶ 2026-11-23 (Fable 5.2, scheduled run): post-merge review of PR #9. **1 must-fix, fixed on branch `review/money-boundary-2026-11-23`. Draft PR, not merged. Nothing deployed. Merging it deploys to production.**

PR #9 was merged as `c957f7a` and is live. A separate agent reviewed it from the PR text and diff alone; each finding acted on was reproduced here first. **1 must-fix, 6 should-fix, 7 nits.** D-57 to D-59.

**Must-fix (M1), fixed:** PR #9 said a declined card "can no longer be followed by a paying one". It still could. A refresh or a second tab re-rendered the pay form while the hold was `PAYING`; if that card paid before the failure webhook was processed, the cancel was refused and only logged, and the success webhook answered `PAYMENT_DUPLICATE`: money taken, no order, **no refund**. Same end if the cancel failed. Now: a success on a `FAILED` payment is refunded in full at Stripe (503 and Stripe redelivers if the refund does not go through), and the form is not offered once Stripe has a refused card on the PaymentIntent (D-58).
- **Live exposure today:** the deployed code has the hole. It needs a Stripe test-mode payment by someone with the shared password; test mode means no real money. O-8 has not been run, so no PaymentIntent exists on production as far as `docs/EVAL.md` records (not verified at Stripe).
- **What you can do now without a code change:** hold off O-8 steps 4 and 5 (the decline and the refresh) and keep the password to yourself until this PR is merged.

**Should-fix, fixed (D-59):** every unconfirmed refund is logged (S1); the "Stripe will be told" notice counts this refund only (S2); ignored signed webhooks leave a log line with ids (S4); Stripe's message text no longer reaches logs (N3); the O-0001 key test asserts literal keys (S6); three stale comments.

**Checked and found to hold:** idempotency keys (unique per event, stable on retry, about 70 characters, no double charge or refund across the format change given O-8 never ran); signature before any parse or lookup, raw body, replay dedupe; no Stripe text on a page or in a response; the two changed expectations in `webhook.test.ts` are justified; **SEC-1/SEC-2 refutation is right** (`assertNotDemo` is where D-55 says; `revokeInvite` has none, which a demo session cannot reach usefully).

**Left for you (product calls, in the PR):** (1) engine rule for paid-after-failed so it shows in the ledger (review decision 6b); (2) permanent versus retryable refund refusals on screen, and a stored last error (schema change); (3) a production retry for pending refunds (review item 12), including Stripe's 24-hour idempotency window; (4) what a signed webhook for a deleted event should do beyond the log line, and cancelling open PaymentIntents in the reset procedure; (5) PR #9's "wraps every Stripe error" is true for refund and cancel only: `createPaymentIntent` and `clientSecret` still throw to the error page (digest only, no Stripe text); (6) the webhook route builds `StripeLive` directly, so a missing key at runtime would answer 500 on failed-payment events.

Gate (cloud sandbox, Postgres 16, migrations by `psql`, `.env.test` written locally with CI's public values; `npm ci` needs `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true`), **main `c957f7a` → branch**: tsc clean → clean · lint 0 → 0 · inventory:eval match (2,662, commitment `d4d64203…61d43`) → same · inventory:lint OK → OK · fixtures:check OK → OK · vitest 58 files, 484 passed, 33 skipped, 4 failed → 58 files, **492 passed**, 33 skipped, 4 failed (the same 4 template `inv-34-export` tests on both; confirmed here on untouched main: `relation "_prisma_migrations" does not exist`) · inventory:eval:db match, 2,662, 48 refund calls, 0 pending → same · `next build` rc 0 → rc 0 · e2e security-pages + buy + box + hosted-demo + ledger + door: not run on main → 8/8 on the branch. Not run: the other e2e specs, `foundation:drift` (no template-owned path changed), anything at Stripe. CI per check is in the PR body.

**Not verified:** anything against live Stripe (the cancel refusal, the refund, redelivery after a 503, `last_payment_error` on a real PaymentIntent, idempotency replay of a failed request); the live site; whether production holds any `PAYING` hold or pending Refund row.

**You:** read the draft PR · merge it if you agree (that deploys) · then run O-8 with the `docs/EVAL.md` script, including the new note under the table · make the six calls above one at a time.

---

## ▶ 2026-11-23 (Opus 5.5, scheduled run, branch `prds/review-2026-11-21`): PRDs written from the 2026-11-21 five-lens review. **Docs only.** Draft PR, not merged.

Since the entry below, **PR #9 was merged** (2026-11-23, `c957f7a`). Draft PR #10 (post-merge review of #9, with fixes and D-58) is open and not merged.

Built (`docs/prds/`, nothing else changed):
- PRD-1 to PRD-5, one per proposed PRD in review §3. Each has problem, evidence (file:line at `9d8b434`), scope, out of scope, acceptance tests and review items covered.
- PRD-1 is marked "covered by #9", except its O-8 test (still open, `docs/EVAL.md:174`). Item 3 (SEC-1/SEC-2) is marked refuted (D-55).
- `DECISIONS-NEEDED-2026-11-22.md`: the open decisions, each once, with options, trade-offs and a recommendation:
  - Decision 3 (D-49 wear-out) first;
  - then Decision 7 (public repo detail, from this file's 2026-11-21 entry);
  - then 4 (who may refund), 5 (org home) and 6 (engine rule; the same question as #10's product call 1).
  - Decisions 1 and 2 are listed as already settled (D-54, D-55).
- `docs/prds/README.md` is the index.

Not done, by the brief: no code, no `docs/decisions.md` row, no decision taken. `add_repo` was not available as a tool in this session. The repository was already in scope, cloned and pushable, so the run went on (as D-50 and D-51 record for earlier runs).

**Likely conflict:** #10 also edits this file. Whichever merges second needs this section kept.

Gate: see the PR's "Gate results" section.

**You:**
1. You: read `docs/prds/DECISIONS-NEEDED-2026-11-22.md` and answer Decision 3 first. PRD-3 item 18 (the e2e sets its own clock) is needed before 2026-12-01 10:00 whatever you choose.
2. You: say which PRDs to build, and in what order.
3. You: review this PR. Merge it or not (docs only; the `ignoreCommand` should skip the build).

---

## ▶ 2026-11-22 (Opus 5.5, live session with Shane): PR #8 merged; money-boundary fixes on branch `fix/money-boundary`, PR open, **not merged**.

Shane said "run all 5 in order" (the closeout recommendation). What happened to each:
1. **Password length (16+):** yours. Not checked here (env values are never read from a cloud session).
2. **PR #8 merged** (`82bf970`, on Shane's ask). Vercel's Production build for it was CANCELED by the docs-only Ignored Build Step, so production is still `dpl_8aMfYPVd5DxeyZ5bjHxXps2aYmub` (read from Vercel's API).
3. **Built (D-56):** idempotency keys per event (CODE-1); cancel the PaymentIntent after a failed payment and keep the pay form shut after a refused card (CODE-2); every Stripe refund error stays PENDING_PROVIDER with an on-screen note instead of the error page (CODE-3/4); webhook checks the signature first, foreign events 200 ignored (CODE-6/SEC-3). **Not built: the demo-settings lockdown.** SEC-1/SEC-2 were wrong: the template already refuses demo sessions there (`assertNotDemo`); D-55, corrections in the review.
4. **O-8:** yours, after the fix PR is merged and deployed; the five-step script is in `docs/EVAL.md` (D-54).
5. **Hand out the password:** yours, after 4.

Gate (cloud sandbox, Postgres 16, migrations by `psql`): tsc clean · lint 0 · inventory:eval match (2,662, commitment `d4d64203…61d43`) · inventory:lint OK · fixtures:check OK · vitest 58 files, 484 passed, 33 skipped, 4 failed (the same template `inv-34-export` failures as on untouched main in this sandbox: no `_prisma_migrations` table when migrated by `psql`) · inventory:eval:db match, 2,662 in 77.3 s, 0 pending provider · e2e full run 34/36 with the lockdown (both failures were the lockdown, reverted), then security-pages + buy + box + hosted-demo + ledger + door 8/8 · mutation checks: key without the event id → 2 tests red; cancel removed → 2 tests red. Not run: `foundation:drift` (no template tag here; no template-owned path changed), anything at Stripe.

**You:** check the password length · review and merge the fix PR (it deploys: code changes build) · run O-8 with the `docs/EVAL.md` script and fill the ids · then hand out the password. Still open: D-49 (wear-out), review decisions 3–6, a production retry for pending refunds (review item 12).

---

## ▶ 2026-11-21 (Opus 5.5, scheduled closeout run, branch `closeout/2026-11-21-live`): Turnstile is live; closeout pack and five-lens review written. **Docs only.** Draft PR "Turnstile: live closeout pack and five-lens review (docs only)", not merged.

**Done (2026-11-21):**
- DEPLOY.md step 9: `https://turnstile.labintelligence.co` in `README.md` and `docs/DEPLOY.md`; the README says it is live behind a shared password Shane gives out (no password written). Stripe wording unchanged: "Stripe boundary tested against recorded payloads and a fixture signing secret" until O-8. Scope-honesty banner untouched.
- DEPLOY.md step 10: D-52 supersedes D-36 (Vercel billing read; Neon not readable here). D-51 records the run's judgment calls; D-53 records the review (report only).
- `docs/RELEASE_NOTES.md` live-release section (stale "Cost review pending" row removed); `docs/DEMO.md` "Live demo" table, 11 stops mapped to e2e tests, all **not yet clicked through live**; `docs/LINKEDIN_DRAFTS.md`, two unposted drafts with a source for every figure.
- Exec brief **"Turnstile Live in Brief"** (Claude Docs, private until shared): https://claude.ai/artifact/Y7XpxZDNWba6okaP1As1R5
- Five-lens review: `docs/audits/FIVE-LENS-2026-11-21.md` + five lens files in `docs/audits/FIVE-LENS-2026-11-21-lenses/`. **57 findings: 2 Blocker, 13 Major, 42 Minor → 30 ranked work items, 5 proposed PRDs (titles, goals, tests only).** Verdict: ship after the top items. Nothing fixed, no PRD written.

**Verified, and how:**
- Vercel API, read-only: project `turnstile`; Production deployment `dpl_8aMfYPVd5DxeyZ5bjHxXps2aYmub` READY (commit `9d8b434`, 12:35 CT) after two ERROR builds (12:23, 12:31); domains include `turnstile.labintelligence.co`; Vercel Authentication on all deployment URLs except custom domains; runtime errors since deploy: none; runtime logs: five requests, scanner paths on the custom domain, **no request to `/demo`, `/api/health`, any `/o/…` page or the webhook**.
- Vercel billing (team-wide, billing day 2026-11-21 08:00 UTC → 11-22 08:00 UTC, read while open): $0.7402 billed (Pro $0.66667); Turnstile rows in the API's truncated sample: 16 build minutes $0.056, functions < $0.00001.
- Gate here: `npm run fixtures:check` OK · `npm run inventory:lint` OK (12 files, 6 screen files) · `npm run inventory:eval` match (2,662, commitment `d4d64203…61d43`) · `npm run design:contrast` OK 0 pairs · `git diff --stat main` = docs/README/NEXT only. (`npm ci` needed `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true`, as before.) CI results are in the PR body.
- Review rendering: local production build on Postgres 16 seeded with `seed-hosted.ts` (migrations by `psql`); axe 48 runs, 0 violations on the Turnstile event screens; typecheck and lint clean; 52 database-free vitest tests passed.

**Not verified:** the live pages (cloud egress cannot reach the site; share links stop at the password); Neon usage; anything at Stripe (never called); a real Stripe Elements form (never rendered by anyone); a Turnstile-only Vercel total (the API sample is truncated); that merging this PR skips the Vercel build (the `ignoreCommand` docs-only rule should skip it).

**Open decisions (one at a time, detail in the review §4):** (1) does O-8 wait for the money fixes (recommend: wait; CODE-1 refund ids repeat across `acme`/`globex` on one Stripe account; CODE-2 decline-then-success keeps money); (2) what the shared password exposes (SEC-1: demo owners reach delete-org / members / SSO / API keys); (3) D-49 demo wear-out; (4) who may refund (SEC-5); (5) the org home kept by D-38; (6) no engine rule change for CODE-2. Plus: decide how a reviewer gets the password. **(7) New, from the overnight review on PR #8:** the repo is public (D-1), so `docs/audits/FIVE-LENS-2026-11-21-lenses/security.md`, the report's §2 items 1 and 3 and §4 already publish open weaknesses of the live site on the pushed branch (SEC-1, SEC-2, SEC-4, CODE-1). Options: (a) move the lens detail out of the repo and keep a summary (the pushed branch history still holds it; no force-push by rule); (b) keep it and hand out no password until PRD-1 and PRD-2 land; (c) leave it. Reviewer's recommendation: (b) at minimum, (a) too if the repo stays public.

**You:**
1. You: run DEPLOY.md step 8 (password prompt, `/api/health`, `/demo`, the README walk) and the first Stripe test payment — after deciding decision 1 above (the review recommends merging the small money-fix PR first).
2. You: record the PaymentIntent id and the Refund id in `docs/EVAL.md` O-8; only then change "Stripe boundary tested against recorded payloads…" anywhere.
3. You: walk `docs/DEMO.md` "Live demo" stops on a laptop and on a phone; mark each one verified.
4. You: make the review decisions in `docs/audits/FIVE-LENS-2026-11-21.md` §4, one at a time; say which work items become PRDs.
5. You: read `docs/LINKEDIN_DRAFTS.md`; pick, edit or drop (nothing is posted or in the Ledger).
6. You: share the brief https://claude.ai/artifact/Y7XpxZDNWba6okaP1As1R5 when ready (private until you do).
7. You: read Neon's usage page for `turnstile` once and add the figure to D-52; check the demo password is 16+ characters (review item 8).
8. You: review this PR; merge or not (docs only).

---

## ▶ 2026-11-20 (Fable 5.2, scheduled deploy-prep run, branch `deploy/vercel`): ready to deploy, **not deployed**. Draft PR "Turnstile: deploy prep for Vercel (not deployed)", not merged.

**Nothing was deployed and no account was touched.** No Vercel project, database or Stripe object was created, read or changed; no variable was set anywhere; no Stripe network call was made. **Merging the PR starts CI and nothing else**, because no Vercel project is linked. Once one is, every push to `main` that changes a non-doc file is a Production build that migrates and seeds.

Built (D-44 to D-50 in `docs/decisions.md`):
- `scripts/vercel-build.mjs` + `npm run vercel-build` (Earmark's, plus two steps): on a Production build, environment check → `prisma migrate deploy` with `MIGRATE_URL` → demo seed → `next build`. Preview builds are skipped (`vercel.json`, Earmark D-56).
- `scripts/deploy-env.ts`: the build is refused with a list of names when one of the **11 variables** is missing or wrong, including a live Stripe key and the published fixture webhook secret. Values are never printed.
- `src/proxy.ts` + `src/checkout/gate.ts`: the shared demo password (core's gate) in front of everything except `/api/cron`, `/api/checkout/webhook` and `/api/v1/**`. **Found:** nothing called the gate before, so a public `DEMO_MODE=1` URL would have signed anyone in as an owner. `FOUNDATION_PATCHES.md` (new) excuses `src/proxy.ts`.
- `scripts/seed-hosted.ts`: demo accounts + the fixture event into `acme` and `globex`, write-once, clock at sales open on a fresh load.
- `e2e/hosted-demo.spec.ts`: the README walk in one session on a production build; `docs/DEPLOY.md`; README "Try the live demo" (says plainly it is not live; `<PRODUCTION_URL>` placeholder).

Gate (cloud sandbox; Postgres 16 started by hand; both databases migrated with `psql`, because the Prisma schema engine download is refused): `npm ci` **fails as written** at `postinstall` (`prisma generate`, 403 from binaries.prisma.sh), passes with `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` · lint 0 · typecheck clean · inventory:lint OK (12 engine files, 6 screen files) · inventory:eval match (2,662, commitment `d4d64203…61d43`) · fixtures:check OK · design:contrast OK, 0 pairs under floor · `npm test` 57 files, 476 passed, 33 skipped, **4 failed** (all in template-owned `inv-34-export.test.ts`; the same 4 failed on untouched `main` in this sandbox: 54 files, 460 passed, 33 skipped, 4 failed) · `npm run build` rc 0 · `npm run test:e2e` **36 passed, 0 failed**; again behind the gate (`E2E_DEMO_ACCESS_PASSWORD` set) 36 passed. `foundation:drift --base 4938406` clean. CI decides.

Not verified (no access, by rule): anything on Vercel, Neon or Stripe. `prisma migrate deploy` could not run here (CI runs it on Postgres 17). The Stripe card form and a real test payment have never been run by anyone (EVAL O-8): the walk's payments use the recorded double and a fixture-signed webhook. Vercel's Ignored Build Step on a redeploy; Neon's pooler with the cast path's advisory locks; that Neon's owner role bypasses RLS (a one-line check is in DEPLOY.md).

Open for Shane: **D-49**: the walk's last step (clock to show night) is one-way, so each demo org is spent about an hour after someone finishes; two orgs, then a two-minute reset in Neon's SQL editor. Options (leave / reset button / nightly reset / drop the door step) are in D-49. Also noticed, not changed: a member who presses **Set clock** gets the app's error page instead of a refusal message (`AuthzError` thrown by the action; Earmark's D-57 is the same family); `docs/RELEASE_NOTES.md` has a stale "Cost review pending" row; the README's clone line says v1.6.1 while `FOUNDATION_VERSION` is v1.7.0; `CLAUDE.md`'s command list does not have `vercel-build` yet.

Shane's hand steps, in order (detail in `docs/DEPLOY.md`):
1. You: read the PR, check CI is green on its head commit, merge it (this deploys nothing).
2. You: Neon: create project `turnstile` (Postgres 17), suspend timeout at the minimum; copy the owner's pooled and direct connection strings; run the one-line `rolbypassrls` check. No role to create (RLS is off).
3. You: Stripe, test mode: copy the publishable and secret test keys.
4. You: Vercel: import the repo, decide the address; let the first build fail (it lists what is missing).
5. You: Stripe, test mode: create the webhook endpoint at `<PRODUCTION_URL>/api/checkout/webhook` for `payment_intent.succeeded` and `payment_intent.payment_failed`; copy its signing secret.
6. You: set the 11 variables in Vercel, Production only (names in DEPLOY.md).
7. You: redeploy; read the four steps in the build log.
8. You: smoke check: password prompt, `/api/health`, `/demo`, then the README walk once, including the first real Stripe test payment; record the PaymentIntent and Refund ids in `docs/EVAL.md` (O-8).
9. You: put the address into `README.md` and `docs/DEPLOY.md`; decide how the password reaches a hiring manager.
10. You: decide D-49; add the cost row that supersedes D-36.

---

## ▶ 2026-11-19 (Opus 5.5, scheduled design pass, branch `design/impl`): Claude Design built in. PR open, not merged.

Built: the six artboards in `docs/design/` (Event, Buy, Buy late payment, Box office, Ledger, Door) and two gap designs drawn first (`Events.dc.html`, `Design.dc.html`) into the real screens, inside `docs/DESIGN_SYSTEM.md` (no new token, font, image or dependency). Three independent reviews (design, UX, a11y) ran against a production build; accepted findings are DUX-1..13 in the PRD and D-37..D-43 in `docs/decisions.md`, fixed on the branch.
Gate (local, cloud sandbox, Postgres 16 started by hand, migrations applied with psql because the Prisma schema engine download is 403): lint 0 · typecheck clean · inventory:lint OK · inventory:eval match (2,662, commitment d4d64203…61d43) · fixtures:check OK · design:contrast OK 0 pairs under floor · vitest 54 files, 460 passed, 33 skipped, 4 failed (all in template-owned `inv-34-export.test.ts`, failing identically before any change: sandbox only, CI decides) · inventory:eval:db match, 2,662 in 61 s · e2e 34 tests: full run 30 passed / 4 failed (axe heading-order on the receipt, duplicate pager landmark), fixed, rerun of a11y+buy+door+ledger 19 passed · axe 0 violations on 8 pages × light/dark × 1280/390 · foundation:check-modules OK (with `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true`). Not run here: `prisma migrate diff` (schema engine), `foundation:drift` (needs the template tag; no template-owned path changed, checked by path).
Left / follow-ups: searchable order picker on Box office refunds (701 options); orphan refusal names no seat; seat rows wrap to 6+6 at 390 px (44 px targets); tier display names (event.json has ids only); Door.dc's sans verdict style not used.
Shane's hand steps: open the Design canvas https://claude.ai/artifact/4rzCmhQZReXpfGftuiM792 and add `Events.dc.html` and `Design.dc.html` if wanted; review the PR; merge or not.

---

## ▶ 2026-11-16 (Opus 5.5): PRs merged. Turnstile is closed and on `main`.

Shane chose to merge. PR #2 (`phase-2` → `kickoff`) merged after CI run 43806998471 passed; then PR #1 (`kickoff` → `main`). `main` matches `phase-2` exactly (`git diff` is empty). Nothing is queued for Turnstile. Loose end, optional: the Ledger page's PROJECTS list lacks `turnstile` and `earmark`, so those cards show the raw id.

---
## ▶ 2026-11-15 (Opus 5.5): closure 4 of 4 done. Turnstile is closed.

Cost review is D-36 in `docs/decisions.md`. Nothing bills: there is no Vercel project and no Neon project, CI has no `schedule` and the repo is public, there is no LLM key, Stripe is test mode only. Nothing was turned off; the restore notes are in D-36. Port 7700 is now in the global port table. All four closure deliverables are listed in `docs/RELEASE_NOTES.md`. PR #2 (`phase-2`) stays unmerged until the owner calls it.
Nothing is queued for Turnstile. Choose the next project, or merge PR #2.

---
## ▶ 2026-11-13 (Opus 5.5): closure 3 of 4 done — LinkedIn posts in the Ledger. Next: cost review.

Harvested 5 angles (waitlist head, late money, caps > room, undrainable outbox, seat guard). Shane picked 2: Ledger #170 (MarTech, late payment refunded, $76.98 at +32 min) and #171 (Scale, waitlist head never skipped), queued after Earmark #168/#169 so pillars alternate. Dropped: seat-guard story (duplicates the "tests green, still broken" theme in #147/#165/#168); caps > room (reuses the $100M anchor in #148/#153/#166). Tech source links point at `phase-2` `docs/decisions.md` (main does not have it; no WRITEUP.md exists). The Ledger page's PROJECTS list lacks `turnstile` and `earmark`, so cards show the raw id — needs a page republish if it matters.
Next: (4) cost review — not deployed (no `.vercel/`); `vercel.json` daily cron `/api/cron` unused; check CI `schedule`; record keep/slow/off + restore notes in `docs/decisions.md`. Port 7700 still missing from the port table in `~/.claude/CLAUDE.md`.

---
## ▶ 2026-11-13 (Opus 5.5): closure 2 of 4 done — exec brief published. Next: LinkedIn posts.

Built: "Turnstile in Brief" https://claude.ai/artifact/5GDjdxZcQBqCGKBHVkTqbM (private until shared), URL in `docs/RELEASE_NOTES.md`. Numbers re-run 2026-11-13: `npm test` 341 passed / 33 skipped; `inventory:eval` 2,662 commands match, commitment d4d64203…61d43; `fixtures:check` OK; `inventory:lint` OK. e2e (25) quoted from closure, not re-run. No screenshots (no capture spec), matching Earmark's brief. Five calls: waitlist head never skipped; late money refunded; countdown decides nothing; outbox undrainable; failure = Seat guard refusing HELD>HELD found by eval:db (D-21 as built).
Next, in order: (3) LinkedIn posts into the Ledger (mine the five calls + CI red at 3.8 + the D-35 clock); (4) cost review (not deployed: no `.vercel/`; `vercel.json` daily cron unused; check CI `schedule`). Port 7700 is still missing from the port table in `~/.claude/CLAUDE.md`.

---
## ▶ 2026-11-12 (Sonnet 5.5): closure 1 of 4 done — `docs/DEMO.md` written, every command run. Next: exec brief.

Built: `docs/DEMO.md` (commands run 2026-11-12: seed, load, load again → refused, eval, fixtures:check, inventory:lint, eval:db, dev server, demo sign-in, all screens 200, globex ledger CSV 452 lines = 4,618,132 / 137,682 / 4,480,450 ¢). Added `scripts/turnstile-cast.ts` + `npm run turnstile:cast -- --org <slug>` (end-of-night view in the dev DB, 33.8 s, refuses a second run); tsc and eslint clean. The live click path (hold, pay, webhook, refund, door) was not re-driven by hand; e2e covers it (25 passed). Live Stripe (O-8) still yours. `AGENTS.md` is untracked (Next dev wrote it), left out of the commit.
Next, in order: (2) exec brief via `exec-brief`; (3) LinkedIn posts into the Ledger; (4) cost review (`vercel.json` has a daily cron `/api/cron` at 0 6 * * *, check CI schedule and whether it is deployed at all). Record artifact URLs here or in `docs/RELEASE_NOTES.md`.

---
## ▶ 2026-11-11 (Sonnet 5.5): Phase 3 CI green. Next: closure deliverables.

CI was red from 3.8 on: `modules-removed` failed because `notices.ts` imports the notifications module. Fixed by `REQUIRED_MODULES = ['notifications']` in `src/app/required-modules.ts` (3e22f32). Run 43063558361: `ci (off)` and `modules-removed` both success; URL recorded in `docs/EVAL.md`. PR #2 stays unmerged.
Next session, in order: (1) `docs/DEMO.md`, running every command in it once; (2) exec brief via `exec-brief`; (3) LinkedIn posts into the Ledger (mine Defects Found / Hardest Bug, the CI red above is one); (4) cost review (no crons or Neon here? check `vercel.json`, CI schedule). Record artifact URLs in `docs/RELEASE_NOTES.md`. Writing, so Sonnet is enough.

---
## ▶ 2026-11-11 (Phase 3 task 3.10, Sonnet 5.5): EVAL.md Phase 3 section written. Next: push, record the CI run URL, then closure deliverables.

Built: `docs/EVAL.md` Phase 3 section (screen numbers traced to the read model, e2e 25/0/0, axe 14 scans 0 violations, lint grep). Numbers copied from the 3.2–3.9 gate lines; no command rerun this session. CI run URL for Phase 3 not yet recorded (placeholder in the heading and "Not run here").
Left: confirm CI green on `phase-2` and paste the URL into EVAL.md; closure (DEMO.md run command by command, exec brief via `exec-brief`, LinkedIn posts into the Ledger, cost review); PR stays unmerged.

---
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
