# PRD-5 — Later hardening

**Status:** proposed. Not built. Take this after PRD-2 to PRD-4, when the demo is stable.
**Source:** `docs/audits/FIVE-LENS-2026-11-21.md` §3 PRD-5; review items 21 to 28. Items 29 and 30 are "do not do" calls. They are listed below so the calls get recorded.
**Evidence:** file:line at `9d8b434`, as the review cites it.

## Problem

Several Minor findings are left open. None of them blocks the walk, but each one either bites on a date or a reset, or leaves no second line of defence.

## Evidence

| Item | Findings | Evidence (at `9d8b434`) |
|---|---|---|
| 21 | CODE-8: the seed loads the event and sets its clock in two transactions. A failure between them leaves offset 0 forever. | `scripts/seed-hosted.ts:25-34` |
| 22 | CODE-10: the event clock jumps at DST. Reproduced with Node `Intl`: +3,601 s at 2027-03-14, −3,599 s at 2027-11-07. | `src/checkout/clock.ts:6-16` |
| 23 | CODE-5, CODE-4 case 4: about 17 statements per read and 20+ per command, by count; Prisma's default transaction limits; latency **not measured** | `src/checkout/read.ts:116-127`; `src/checkout/cast.ts:30-38`, `:118-160`; `src/core/db/rls.ts:16` |
| 24 | SEC-6: the CSP is `frame-ancestors 'none'` only | `next.config.ts:7`; `e2e/headers.spec.ts` |
| 25 | SEC-8: no limit on cast actions in demo mode; the log is append-only (impact **suspected**) | `src/app/o/[org]/events/[event]/{door,buy,box}/actions.ts`; `door/actions.ts:21` |
| 26 | DES-5, DES-6, DES-7 (1-6), DES-8, DES-9, DES-10, DES-12, UX-12, UX-13: disclosure marker, wrapped pills, ledger width and pager, rules list at 390, four filled buttons, status colour on zero counts, type-scale drift, D-numbers in copy, times without dates | `src/app/turnstile.css:152`, `:167`, `:293`, `:303`; `[event]/page.tsx:82-86`; `ledger/page.tsx:50-58`, `:87-100`; `buy/page.tsx:86` |
| 27 | DES-13, UX-8: `/demo` and the error page look like a different product | `src/app/(public)/demo/page.tsx` (template-owned); `src/app/error.tsx` |
| 28 | A11Y-5: 72 Tab stops through an empty section; taken seats are not focusable | `buy/page.tsx:262-279` |
| 29 | SEC-7: `npm audit --omit=dev` gives 0 critical and 3 high, all one `effect` ReDoS advisory in the Prisma CLI chain. npm's fix is a major downgrade. **Review call: do not do.** | `package.json:66` |
| 30 | CODE-2 alternative: an engine rule for a success on a `FAILED` payment. **Review call: do not do now** (Decision 6). | `src/inventory/engine.ts:360` |

## Scope

1. **Seed (item 21).** Set `clockOffsetSeconds` inside `loadFixtureEvent`'s transaction, or have the seed set it whenever the event's CommandLog is empty and the offset is 0.
2. **DST (item 22).** Either document the jump in D-34/D-35, or derive the axis "now" from a fixed UTC offset stored on the event. The second is a behaviour change, so it needs a decisions row first.
3. **Latency (item 23).** Measure first. Log the durations of `readEvent`/`hydrated` and `castCommand` on the live site and record them in `docs/EVAL.md`. Only then consider one lock per event, a single event query, and explicit `{ maxWait, timeout }`. No figure is claimed before it is measured.
4. **CSP (item 24).**
   - Add `script-src`, `frame-src` and `connect-src` allowing Stripe's hosts and nothing else external.
   - Ship it report-only first.
   - Extend `e2e/headers.spec.ts`.
5. **Cast rate limit (item 25).** Either add a per-session or per-org limit in demo mode, using core's Postgres rate limiter, or record in D-46 that there is none.
6. **Polish batch (item 26).** Each sub-item is small. Copy changes are proposals for Shane.
7. **Template screens (item 27).**
   - Propose a grouped `/demo` upstream in `FOUNDATION_PATCHES.md`; do not edit it here.
   - Add a clone `error.tsx` under `/o/[org]` that keeps the org bar.
8. **Seat grid keyboard (item 28).**
   - One Tab stop per row, with arrow keys between seats (or a skip link).
   - Taken seats use `aria-disabled` so they can be focused and are announced.
9. **Record the two "do not do" calls (items 29, 30).**
   - Item 29: one decisions row, "wait for a Prisma 7.x that bumps `effect`", as BACKLOG F-16 does.
   - Item 30: Decision 6.

## Out of scope

- Any template-owned edit (`src/core/**`, `/demo`). `foundation:drift` enforces this.
- The Prisma downgrade (item 29).
- Load testing beyond the timing logs. Gavel owns contention (PRD non-goal).

## Acceptance tests

- The seed's load and clock offset commit in one transaction: a forced failure after the load leaves no event.
- D-34/D-35 state the DST behaviour, or a test across 2027-03-14 shows no jump.
- Logged durations for `readEvent` and `castCommand` on the live site are recorded in `docs/EVAL.md` before any performance change.
- `headers.spec` checks that `script-src`, `frame-src` and `connect-src` allow Stripe and nothing else external.
- D-46 records the cast rate-limit call, or a test shows the limit refuses requests past its threshold.
- The polish batch (item 26) keeps axe and `design:contrast` at 0.
- A clone `error.tsx` under `/o/[org]` renders the org bar and a `<title>` that names the error.
- In the seat grid, Tab reaches "Hold seats in A" in at most one stop per row plus the controls, and a taken seat is announced as sold or held.
- `docs/decisions.md` records the SEC-7 call.

## Review items covered

21, 22, 23, 24, 25, 26, 27, 28. Items 29 and 30 are recorded as calls only. None is covered by #9.
