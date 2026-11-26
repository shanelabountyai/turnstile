# PRDs from the 2026-11-21 five-lens review

These PRDs are written from `docs/audits/FIVE-LENS-2026-11-21.md` §3 (titles, goals and tests) and its five lens files. They are documents only: nothing here is built or decided. `docs/decisions.md` outranks them.

| PRD | Review items | Status on 2026-11-23 |
|---|---|---|
| [PRD-1 Money boundary before O-8](PRD-1-money-boundary.md) | 1, 2, 4, 7 | Covered by #9 (merged, `c957f7a`). O-8 is still open (Shane). Open draft #10 refines item 2. |
| [PRD-2 Demo safe to share](PRD-2-demo-safe-to-share.md) | 3 (refuted, D-55), 5, 6, 8, 20 | Built (draft PR), 2026-11-24: items 5, 6, 8 (D-65 to D-68; D-82 corrects D-68 (1)). Not merged. Item 20 is done by D-62 (a decisions row). |
| [PRD-3 Live payment and refund resilience](PRD-3-payment-refund-resilience.md) | 9, 10, 11, 12, 18 | Built (draft PR), 2026-11-24: items 9, 10, 11, 12 and the nightly reset (D-69 to D-74). Not merged. Left out: item 18 (covered by #13) and the retry of refunds older than 23 hours (owner's call, D-70). Item 10 is inferred from code until O-8. |
| [PRD-4 First impression and screen polish](PRD-4-first-impression-polish.md) | 13, 14, 15, 16, 17, 19 | Proposed. Item 14 follows D-63. |
| [PRD-5 Later hardening](PRD-5-later-hardening.md) | 21–28 (plus calls on 29, 30) | Proposed. |

Decisions for Shane, each written once: [DECISIONS-NEEDED-2026-11-22.md](DECISIONS-NEEDED-2026-11-22.md). **All five were taken as recommended on 2026-11-23: D-60 to D-64 in `docs/decisions.md`.** This means:
- PRD-2 item 20 is done by D-62.
- PRD-3 item 9 and PRD-4 item 14 are unblocked.
- PRD-3 gains the nightly reset (D-60).

Every work item from the review appears in exactly one PRD. The review's "README not live" row (UX-1) is not a work item: PR #8 fixed it.

All evidence is file:line at `9d8b434`, the commit the review read. Where #9 moved a line, the PRD gives the current line too. Every figure comes from the review, `docs/decisions.md`, `docs/EVAL.md` or PRs #9 and #10. None was measured for these documents.

Synthetic data only. Stripe test mode only. No claim here that live Stripe works: O-8 has not been run (`docs/EVAL.md:174`).
