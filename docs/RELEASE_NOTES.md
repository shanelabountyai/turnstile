# Release notes — closure artifacts

| Deliverable | Where | Date |
|---|---|---|
| Demo script | `docs/DEMO.md` | 2026-11-12 |
| Exec brief — Turnstile in Brief (private until shared) | https://claude.ai/artifact/5GDjdxZcQBqCGKBHVkTqbM | 2026-11-13 |
| LinkedIn posts (Ledger #170 MarTech: late money refunded; #171 Scale: waitlist head never skipped) | https://claude.ai/artifact/Ai5xKScgT2sWtqXRQ1ZA8i | 2026-11-13 |
| Cost review — nothing bills; recorded as decision D-36 in `docs/decisions.md` | — | 2026-11-15 |

## Live release — 2026-11-21

Turnstile is live at https://turnstile.labintelligence.co behind a shared demo password (D-46) that Shane gives out.
Production deployment `dpl_8aMfYPVd5DxeyZ5bjHxXps2aYmub` (commit `9d8b434`, READY 2026-11-21 12:35 CT). Synthetic data
only; Stripe **test mode** only. Stripe claim, until EVAL O-8 is recorded: **Stripe boundary tested against recorded
payloads and a fixture signing secret.** The first real Stripe test payment has not been made.

| Deliverable | Where | Date |
|---|---|---|
| Live demo stops mapped to e2e tests (all "not yet clicked through live") | `docs/DEMO.md`, "Live demo" | 2026-11-21 |
| Exec brief — Turnstile Live in Brief (private until shared) | https://claude.ai/artifact/Y7XpxZDNWba6okaP1As1R5 | 2026-11-21 |
| LinkedIn drafts (two, unposted, not in the Ledger) | `docs/LINKEDIN_DRAFTS.md` | 2026-11-21 |
| Cost re-check — supersedes D-36; Vercel read, Neon not read | D-52 in `docs/decisions.md` | 2026-11-21 |
| Five-lens review (57 findings: 2 Blocker, 13 Major, 42 Minor; 30 work items; report only) | `docs/audits/FIVE-LENS-2026-11-21.md` | 2026-11-21 |
| README and DEPLOY.md carry the address (DEPLOY.md step 9) | `README.md`, `docs/DEPLOY.md` | 2026-11-21 |

Known limits at release: the live site has not been walked by the owner; the two demo orgs wear out one-way (D-49, open);
the review's "before O-8" and "before the password" items are open.
