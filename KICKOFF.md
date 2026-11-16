# Kickoff — Turnstile (Build Log #13, Event Venue / Ticketing)

Cloud-session variant. Paste the block below into a Claude Code cloud session on Fable (`/model claude-fable-5-1`) with the `shanelabountyai/saas-foundation` and the new, empty, **public** `shanelabountyai/turnstile` repos attached. The kit lives in this directory; nothing has been cloned, installed or committed yet. There is no `~/Projects` and no `reuse-scan.py` in the cloud. **No Stripe key is attached to this session and none is needed** (D-5).

```
Turnstile — event venue ticketing: capacity that cannot lie (Build Log #13, main track).
The kickoff kit is in the turnstile-kickoff directory attached to this session. Nothing exists
yet besides the kit and an empty public repo shanelabountyai/turnstile.

Read, in order, from the kit: CLAUDE.md, prd-turnstile.md, docs/decisions.md (authoritative),
docs/domain-brief.md, docs/portfolio-overlap.md, docs/phase-1-tasks.md.

Steps, in order:
1. Port check. Port 7700 is proposed (D-4). You cannot read ~/.claude/CLAUDE.md from here;
   check saas-foundation/CLONES.md for a clash (7300 ledgerleave, 7400 coursework, 7600
   earmark are known; look for commons). If 7700 appears there, stop and tell me. Otherwise
   continue and record "7700 proposed; port-table row is Shane's" in docs/decisions.md D-4
   and in NEXT.md.
2. Clone the template with shared history (NOT the GitHub template button):
     git clone <saas-foundation url> turnstile && cd turnstile
     git remote rename origin template
     git checkout -B main v1.6.1
     npm ci
     npm run new-project -- turnstile 7700
   Do not run new-project twice. Copy the kit in: CLAUDE.md, KICKOFF.md, NEXT.md,
   prd-turnstile.md, docs/*.md, tools/*.py, fixtures/ (all of it, as-is), .claude/settings.json
   (merge the model pin; keep anything the template put there). Add the scope-honesty banner
   from the PRD to README.md verbatim. Add STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY and
   STRIPE_WEBHOOK_SECRET to .env.example with empty values and the D-5 sentence.
3. Put ?connection_limit=10&pool_timeout=20 on the local DATABASE_URLs in the env examples
   and db-setup output. Confirm vercel.json has the house ignoreCommand. Confirm the CI
   workflow sets TZ=America/Chicago and carries no Stripe secret. Remove billing and leave
   share links, SSO and API keys unwired per D-6 (use foundation:check-modules' path list if
   there is no switch) and record what you did.
4. npm run foundation:drift must pass before any Turnstile code exists. Try npm run db:setup
   and npm test; if Prisma engines or Playwright browsers cannot be downloaded in this
   sandbox, record exactly which command failed and why in NEXT.md and continue — CI decides
   (D-7).
5. Oracle check, all with python3 -I:
     tools/golden_answers.py                                   -> ends with OK
     tools/build_fixtures.py --seed 20261109 --out /tmp/fx     -> prints 2662 commands, 79 traps
     tools/reference_alloc.py --fixtures /tmp/fx --write-expected --shuffle 5
     tools/verify_fixtures.py                                  -> ends with OK (against fixtures/)
   Compare every sha256 of /tmp/fx with fixtures/MANIFEST.json and docs/domain-brief.md §12,
   and the printed table with fixtures/reference_output.txt. Report any mismatch; do not fix
   either side.
6. Reuse scan: skipped (not reachable from the cloud). Record that in docs/decisions.md
   with the sentence from CLAUDE.md §Session 0.
7. Read every doc. List anything that contradicts itself or can't be built as written, and
   anything in docs/portfolio-overlap.md whose donor path you could not find when you read
   the donor repos you have access to (quorum is public; read its src/tally/commit.ts,
   src/meetings/db.ts and prisma/migrations first). Don't resolve these yourself.
8. Commit on branch `kickoff`, naming files explicitly (never git add -A), in three commits:
   (a) the new-project rewrite (package.json, playwright.config.ts, CI workflow, README.md,
       vercel.json, .env.example) plus the D-6 module removal;
   (b) the kickoff docs and tools (CLAUDE.md, KICKOFF.md, NEXT.md, prd-turnstile.md,
       docs/*.md, tools/*.py, .claude/settings.json);
   (c) the fixtures (fixtures/*) — show me the hash table first.
   Before the first push run git ls-files | grep -iE "\.env|secret|credential|\.pem$|\.key$"
   (only .env.example may appear) and confirm .gitignore covers .env and .env*.local.
   Push `kickoff` to origin (shanelabountyai/turnstile) and open a PR against main. Do not
   merge. Then open a separate PR on saas-foundation adding the CLONES.md row:
   turnstile | shanelabountyai/turnstile (public) | v1.6.1 | 2026-11-09; event venue
   ticketing: shared-pool capacity under over-allotted GA tiers + reserved seats with an
   orphan rule, timed holds and the hold-vs-webhook race, HEAD_BLOCKS waitlist, refund policy
   as data, Stripe test mode (keys never in repo/CI), port 7700; synthetic only; not deployed;
   tools/ (Python stdlib oracles), fixtures/ are clone-owned.
   Show me both PR links.
9. Plan first: write the Phase 1 plan as the order you will do tasks 1.1 to 1.14 in, which
   donor you will read for each port in 1.3, and which commands you expect to be CI-only.
   Stop and show me the plan, the step 5 output, the contradictions list and the step 4
   record before writing any product code.

Stop there. Do not create Prisma models, migrations, UI, Stripe code or engine code before I
have reviewed the plan. Update NEXT.md before you stop.

Rules from the first commit: the engine under src/inventory/ imports no database, clock,
randomness, network, Stripe or model client and is order-independent; the pool is the truth
and available is derived; expiry runs before the command and the expiry second is inclusive;
a PAYING hold is not expired by the cart TTL and late money is refunded, never seated; the
waitlist head is never skipped; thresholds and policies are data; fixtures are never
generated or read by product code; money is integer cents and proportions are basis points;
timestamps are strings on one axis; never edit an expected value to pass a test; never edit
template-owned paths (src/core/**, tests/invariants/**, core migrations); no new dependencies
without asking; Stripe keys never enter the repo, the cloud or CI; never "never oversells"
without the number and the D-24 limits; branch + PR, never merge.
```

## Still to do by hand

- Create the empty public repo `shanelabountyai/turnstile` before the session and attach both repos. Do **not** attach Stripe or any Stripe key.
- `~/.claude/CLAUDE.md`: add the port-table row (turnstile → 7700, or the next free slot) on the Mac; the cloud session cannot.
- Review and merge the two PRs (turnstile `kickoff`; saas-foundation CLONES row).
- Build-log card #13: name **Turnstile**, PRD and repo links, status `in progress`, chips per `docs/portfolio-overlap.md` "Suggested card chips".
- Stripe: create (or reuse) a Stripe account in **test mode**; put the test keys in the local `.env` and, if ever deployed, the Vercel project. Needed at the Phase 2 gate, not before. The live test-mode round trip (O-8) is yours to run and record in `docs/EVAL.md`.
- Neon and Vercel only if this is ever deployed (not planned; synthetic data).
- Decide O-1..O-9 when they come up; defaults are in force.
- Re-run `reuse-scan.py` against `docs/phase-1-tasks.md` the next time the repo is open on the Mac and record the result.
