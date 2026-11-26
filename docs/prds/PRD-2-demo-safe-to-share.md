# PRD-2 — Demo safe to share

**Status:** Built (draft PR), 2026-11-24: items 5, 6 and 8 on branch `prd-2/demo-safe-to-share` (D-65 to D-68), not merged, not deployed. The README wording of item 6 waits for Shane's approval. The `e2e/hosted-demo.spec.ts` member test was updated on this branch on 2026-11-24 (`3e24bb2`, Shane's call) and PR #13 is merged in (`445f47a`), so no test waits on the merge (D-82 corrects D-68 (1)). Acceptance test 2 (the README walk twice on one database) is partly met, by design (D-67, D-82). Still before the merge: the owner confirms the live `DEMO_ACCESS_PASSWORD` is 16 or more characters (D-66). Item 3 is refuted (D-55), so it is dropped. Item 20 is done by D-62.
**Source:** `docs/audits/FIVE-LENS-2026-11-21.md` §3 PRD-2; review items 3, 5, 6, 8, 20.
**Evidence:** file:line at `9d8b434`, as the review cites it. #9 did not touch these files.
**Gate:** the review ranks items 5, 6 and 8 "before the password", meaning before anyone but Shane can sign in.

## Problem

A visitor with the password should not break the demo for the next visitor or hit a crash, and the README should match the screen even when they are not the first visitor. Three gaps are still open:
- A member who presses **Set clock** gets the app's error page, not a refusal.
- Every visitor acts as the same two customers, so from the second visitor on, the README's "you should see" lines are wrong.
- Nothing checks that the shared password is long.

## Evidence

| Item | Findings | Evidence (at `9d8b434`) |
|---|---|---|
| 3 | SEC-1, SEC-2. **Refuted** (D-55): the template already refuses demo sessions through `assertNotDemo`. | security lens correction note |
| 5 | UX-5, A11Y-1, CODE-4 (`requireOrg` part), DES-13 (error page part): the Set clock form renders for every role, the action throws `AuthzError`, and the whole org layout is replaced by "Something went wrong". Focus is left on `<body>` and the title is unchanged. | `src/app/o/[org]/events/[event]/page.tsx:114-130`, `:123-124`; `src/app/o/[org]/events/[event]/actions.ts:12-13`; `src/app/error.tsx:4-11`; `src/core/authz/action.ts:29-34` |
| 6 | UX-2, UX-3 (README part), UX-10, UX-16, UX-18, CODE-9 (README part), UX-8 (starting-account line): every visitor uses `C-0001`/`C-0002` on a shared database; the Buy form defaults to EARLY × 1 while the walk needs ADV × 2; the README gives a 24-hour time that the clock field shows in 12-hour form; the "Step 7 uses the demo up" paragraph comes after step 7; the walk's figures have calendar end dates. | `README.md:26`, `:31-33`, `:37`, `:42`, `:46`, `:49-52` (at `9d8b434`; the same text is at `README.md:26`, `:37`, `:46`, `:49` on main today); `src/app/o/[org]/events/[event]/buy/page.tsx:52-56`, `:243-247` |
| 8 | SEC-4: one timing-safe compare per request with no attempt limit; the build accepts any non-empty password. | `src/core/demo-gate.ts` (template-owned); `scripts/deploy-env.ts:22` |
| 20 | SEC-5: refund, sell and check-in need only membership; only the clock needs `org.update`. No decisions row says whether that is intended. | `box/actions.ts:18`; `door/actions.ts:14`; `buy/actions.ts:37-48`; `actions.ts:12` (all under `src/app/o/[org]/events/[event]/`) |

## Scope

1. **Set clock for members (item 5).** For roles without `org.update`, either hide the form or show it read-only, with one sentence saying who can move the clock. The action returns `{ error }` (or a `Refused`) instead of throwing, so `ActionForm` shows the reason inline and the org bar stays. Clone-owned files only.
2. **README walk for the second visitor (item 6).** This is a README edit, and the README's visitor wording is Shane's. The review's suggested changes are:
   - each visitor picks a customer with no orders, and the steps say "your order" instead of "the order of `C-0001`";
   - say plainly that step 2 needs tier ADV and quantity 2;
   - give the step 7 time as it shows in a 12-hour field (20 March 2027, 7:00:05 PM, or any time after 7 PM and before 8 PM);
   - move "Step 7 uses the demo up" above step 1;
   - name the starting account (`owner@acme.demo.test`);
   - say the figures assume the event clock is more than 30 days before the show.
   D-51 left this for the owner. The e2e test below makes the walk checkable.
3. **Password length (item 8).**
   - Now: Shane checks in Vercel that `DEMO_ACCESS_PASSWORD` is 16 or more characters. No code.
   - Later: `turnstileProblems` in `scripts/deploy-env.ts` refuses a shorter password, naming the variable but never printing its value.
4. **Who may refund, sell and check in (item 20).** Add one `docs/decisions.md` row per Decision 4. If Shane picks option (b), add the permission and return a refusal, not a throw.

## Out of scope

- A proxy lockdown of `settings/{danger,members,sso,apikeys}`. It was refuted, built, broke `e2e/security-pages.spec.ts`, and was reverted (D-55).
- Changes to template-owned `/demo` or `src/core/demo-gate.ts`. `foundation:drift` forbids them. UX-8's account hint goes in the README.
- On-screen "spent org" lines and the clock warning (item 9). They are in PRD-3.
- A Vercel Firewall rule on 401s (SEC-4's other option). That is a Vercel setting, so it is Shane's.

## Acceptance tests

- A member on the event page sees no active Set clock form, and a sentence says who can move the clock. Posting the action directly returns an inline refusal. The org bar stays and there is no HTTP 500.
- e2e runs the README walk twice on one database, the second time as a different fresh customer per the README. Every "you should see" check passes both times.
- `deploy-env` refuses a `DEMO_ACCESS_PASSWORD` under 16 characters and prints the name only, never the value. `tests/checkout/deploy-env.test.ts` gains the case.
- `docs/decisions.md` has a row on who may refund, sell and check in.
- `foundation:drift` stays clean (no template-owned path changes).
- Removed with item 3: the review's "demo owner's POST to `settings/{danger,…}` gets 403" test. The template's own refusal is already asserted in `e2e/security-pages.spec.ts:28,33`.

## Review items covered

3 (refuted, D-55; no work), 5, 6, 8, 20. None is covered by #9.
