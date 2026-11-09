# NEXT

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
