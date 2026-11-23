# PRDs from the 2026-11-21 five-lens review

These PRDs are written from `docs/audits/FIVE-LENS-2026-11-21.md` §3 (titles, goals and tests) and its five lens files. They are documents only: nothing here is built or decided. `docs/decisions.md` outranks them.

| PRD | Review items | Status on 2026-11-23 |
|---|---|---|
| [PRD-1 Money boundary before O-8](PRD-1-money-boundary.md) | 1, 2, 4, 7 | Covered by #9 (merged, `c957f7a`). O-8 is still open (Shane). Open draft #10 refines item 2. |
| [PRD-2 Demo safe to share](PRD-2-demo-safe-to-share.md) | 3 (refuted, D-55), 5, 6, 8, 20 | Proposed. Item 20 waits for Decision 4. |
| [PRD-3 Live payment and refund resilience](PRD-3-payment-refund-resilience.md) | 9, 10, 11, 12, 18 | Proposed. Item 9 waits for Decision 3. |
| [PRD-4 First impression and screen polish](PRD-4-first-impression-polish.md) | 13, 14, 15, 16, 17, 19 | Proposed. Item 14 waits for Decision 5. |
| [PRD-5 Later hardening](PRD-5-later-hardening.md) | 21–28 (plus calls on 29, 30) | Proposed. |

Decisions for Shane, each written once: [DECISIONS-NEEDED-2026-11-22.md](DECISIONS-NEEDED-2026-11-22.md).

Every work item from the review appears in exactly one PRD. The review's "README not live" row (UX-1) is not a work item: PR #8 fixed it.

All evidence is file:line at `9d8b434`, the commit the review read. Where #9 moved a line, the PRD gives the current line too. Every figure comes from the review, `docs/decisions.md`, `docs/EVAL.md` or PRs #9 and #10. None was measured for these documents.

Synthetic data only. Stripe test mode only. No claim here that live Stripe works: O-8 has not been run (`docs/EVAL.md:174`).
