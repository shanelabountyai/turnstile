# Decisions needed from Shane — from the 2026-11-21 five-lens review

Each decision is written once here. The PRDs point to this file and do not repeat it. Numbers are the review's (§4 of `docs/audits/FIVE-LENS-2026-11-21.md`), so cross-references still work. Decision 7 comes from NEXT.md, not the review (see its entry).

The order below is the order I suggest taking them in. **Nothing here is decided.** Each recommendation is a recommendation only. Record your answer in `docs/decisions.md`, which outranks the PRDs.

**Already settled, listed so they are not asked again:**
- **Decision 1** (does O-8 wait for the money fixes): **(a) wait**, D-54. #9 is merged. O-8 itself is still open (`docs/EVAL.md:174`).
- **Decision 2** (what the shared password exposes): **moot**, D-55. SEC-1 and SEC-2 were refuted because the template's `assertNotDemo` already refuses those actions.

**Answer these together with open draft PR #10:** it asks six product calls of its own. Two of them overlap with this file:
- #10 call 1 (paid-after-failed) is the same question as Decision 6. It is answered once, below.
- #10 calls 3 and 5 (refund retry; Stripe errors on Pay) are PRD-3 items 12 and 11. They are left in #10 and not repeated here.

---

## 1st — Decision 3: D-49, the demo wears out one way

**Question:** how should a spent or damaged demo org recover?

**Why now:**
- `e2e/hosted-demo.spec.ts:50` stops running its hold/release branch once the wall clock passes 2026-12-01 10:00 (CODE-9).
- A D-49 reset after that date seeds offset 0, which moves the demo's end to the real 2027-03-20 dates and puts the DST jump inside the sales window (CODE-8, CODE-10).
- PRD-3 item 9 (on-screen warnings) waits for this answer.

| Option | What it means | Trade-offs |
|---|---|---|
| (a) Leave it (current call), plus item 9's on-screen lines | The README and the screen tell visitors to use `globex`. Shane resets by hand in Neon (`docs/DEPLOY.md`). | No D-21 exception and nothing new to build. But each org is spent about an hour after any visitor finishes step 7, and nothing heals until Shane acts. |
| (b) A "start the night again" button for demo sessions | A visitor resets their own org. | Heals on demand. But any visitor can wipe the org another visitor is using mid-walk. It deletes append-only `CommandLog`, `Order` and `Refund` rows, so it needs a D-21 exception. More UI to build and test. |
| (c) A nightly reset in the clone cron, with the seed always placing the clock at sales open on a fresh load | Every night both orgs go back to sales open. | Heals spent orgs and expiring figures without Shane opening Neon. Also needs a D-21 exception scoped to `DEMO_MODE` (the code lens confirmed the guards allow `TRUNCATE`). A visitor mid-walk at reset time loses their state. Mints new event UUIDs, so open PaymentIntents point at a deleted event (#10 S4; #10 call 4 suggests cancelling them as a reset step). |
| (d) Drop the door step from the public walk | The clock is never moved, so the org is never spent. | Smallest change. Loses check-in (PRD P0-7) from the walk, and does not fix calendar expiry (UX-18). |

**Recommendation: (c), with item 9's warnings.** This is the review's call too. It is the only option that also fixes the calendar end dates and any other damage without a hand step. Its cost is one written exception to D-21, limited to `DEMO_MODE`. If you would rather not touch D-21 yet, (a) plus item 9 is the safe holding position. In that case, PRD-3 item 18 (e2e sets its own clock) still needs doing before 2026-12-01.

---

## 2nd — Decision 7: what the public repo says about open weaknesses

**Source:** NEXT.md 2026-11-21, item (7), raised by the overnight review on PR #8. It is not in the five-lens report, but it applies to this PR: the PRD files restate the review's evidence in the public repo (D-1).

**Question:** should detailed findings about the live site stay in the public repo?

| Option | Trade-offs |
|---|---|
| (a) Move the lens detail out of the repo and keep a summary | Less published detail. But the pushed history still holds it (no force-push, by rule), so it only reduces discoverability. It also breaks the PRDs' file:line evidence trail. |
| (b) Keep it, and hand out no password until the fixes that matter have landed | Keeps the audit trail that the build log values. The exposure is bounded by who has the password. |
| (c) Leave it and hand out the password as planned | No extra steps. But open items stay published while access widens. |

**Recommendation: (b).** The money items the lenses found are closed by #9 (D-56). SEC-1 and SEC-2 were refuted (D-55). #10 found one remaining money hole and has a fix waiting. So the password gate can be "#10 merged, plus PRD-2 items 5, 6 and 8", which matches the review's "before the password" line. Choose (a) as well only if the repo should look cleaner to readers, knowing that history keeps the detail.

---

## 3rd — Decision 4: who may refund? (SEC-5)

**Question:** should refunds (and perhaps sales and check-in) need a permission above membership?

| Option | Trade-offs |
|---|---|
| (a) Every member is box-office staff; record it as a decisions row | One row and no code beyond PRD-2 item 5. Matches D-32 ("staff-only" Buy screen). A reader of the code then finds a stated policy instead of an apparent oversight. |
| (b) Gate refunds (perhaps also sell and check-in) behind a permission, returning a refusal, not a throw | Makes the owner/admin/member split visible in the demo. Costs a permission, refusal wording, tests, and README text for which account to use at step 5. |

**Recommendation: (a)**, as in the review. In the demo every role is one click away on `/demo`, so (b) changes what a reviewer sees without protecting anything.

---

## 4th — Decision 5: the org home (revisits D-38)

**Question:** what should `/o/<org>` show after sign-in?

| Option | Trade-offs |
|---|---|
| (a) Keep it as is (D-38) | No work. The first page still reads "Nothing here yet", and axe still fails it (skip link with no target, A11Y-3). |
| (b) Keep the text `onboarding.spec` asserts; add the event card and `id="main"` | Keeps D-38's reason (template e2e passes) and fixes the empty first impression and the axe violation. Small (PRD-4 item 14). |
| (c) Redirect the org home to Events | Cleanest for visitors, but it breaks template e2e, which is the reason D-38 exists. |

**Recommendation: (b)**, as in the review.

---

## 5th — Decision 6: engine rule for a success on a failed payment (CODE-2 alternative; same as PR #10 call 1)

**Question:** when Stripe captures money on a payment the engine already marked `FAILED`, should the boundary handle it, or should the engine get a rule?

| Option | Trade-offs |
|---|---|
| (a) No rule change: the boundary handles it (#9's cancel; #10's boundary refund keyed `<event UUID>:paid-after-failed:<PaymentIntent id>`, D-58, if #10 is merged) | No fixture or oracle change (non-negotiables 9 and 10 untouched). But #10 says the refund has no ledger row, so the Ledger and the recount do not show it. The only trace is a log line and Stripe's record. |
| (b) Add the rule: a success on a `FAILED` payment is late money, with a full refund, like `PAID_AFTER_TIMEOUT` | The ledger and recount show it, and it is one rule in one place. Needs `docs/decisions.md` first, an oracle change in `tools/`, regenerated fixtures and a new golden, under the fixture procedure in CLAUDE.md. |
| (c) Both: (a) now, (b) later replacing it | Closes the hole today and gets the ledger right later. Briefly two code paths for one outcome. |

**Recommendation: (a) now, and (b) when the engine is next opened, which together amount to (c).** Both the review and #10 recommend (a) now. Revisit (b) after O-8 shows how Stripe behaves after a cancel, or sooner if a refund missing from the ledger matters for the demo's "to the cent" claim.
