# Phase 3 — UI surface (draft at the Phase 2 gate; for Shane's review)

Phase 2 made the engine true in a database: every write goes through `castCommand` (`src/checkout/cast.ts`), the `CommandLog` is the source of truth, and Stripe sits behind one interface. Phase 3 puts five screens on top (PRD P0-10) and adds **no rule**: every number a screen shows is read from the engine hydrated from stored rows, never computed in a component, and every button casts one command and renders its code. Stripe stays test mode; Elements runs only where the publishable key is set (D-26).

**Owner decisions needed before 3.1 (defaults take effect on "go"):**

| # | Decision | Recommendation | Alternative |
|---|---|---|---|
| D-31 | **How screens read state.** One server-side read model per event, `readEvent(orgId, eventId, at)`: hydrate + `advance(at)` in memory, *no write* (expiry is only written by the next cast). Screens show "as of `at`". | Read-through hydrate (one code path with the cast; the formula exists once) | A stored projection table (faster reads, a second place the formula could drift) |
| D-32 | **Who the buyer is.** The fixture customers are synthetic rows, not users. The Buy screen acts as a chosen customer (a picker, staff-only, labelled "acting as C-00042"); no public sign-up. | Staff-only "act as customer" | Public buyer accounts on the foundation's auth (real sign-up flow, out of scope for a learning project) |
| D-33 | **Where notices stop.** Queued with `attempts = MAX_ATTEMPTS` so the template-owned drain never selects them (the draft's "worker skips by type" would edit a drift-guarded file); a test drains and asserts zero `sendEmail` calls. Recorded in `docs/decisions.md` D-33. | Queued, undrainable, tested | Leave `RESEND_API_KEY` unset and rely on the throw |
| D-34 | **The clock in the UI.** The axis `now` comes from `src/checkout/clock.ts` (`axisNow`, event zone). The countdowns are display-only; the server decides expiry at the inclusive second (non-negotiable 3). | Server clock decides; client countdown is cosmetic | Client-driven expiry (would let a browser decide a rule) |

## Tasks

- [x] **3.0 Plan check.** Read the donors: Quorum `docs/DESIGN_SYSTEM.md`, `src/components/ui.tsx`, `tools/contrast.py` (D-57 there); the foundation's outbox (`src/core/email/transport.ts` and its worker) and an existing `src/app/o/` page for the org layout. Record D-31..D-34 as taken, the lineage in `docs/decisions.md`, then start 3.1.
- [x] **3.1 Design system port.** `src/components/ui.tsx` and `docs/DESIGN_SYSTEM.md` from Quorum, trimmed to what the five screens use; `tools/contrast.py` passes on the token set. *Acceptance:* contrast OK; one page renders with the tokens in light and dark.
- [x] **3.2 Read model (D-31).** `src/checkout/read.ts`: pool and tier cards (remaining vs available, with the formula inputs), seats per section, waitlists with positions, orders, ledger totals. *Acceptance:* a vitest that loads the fixture, casts the 2,662 commands, and asserts the read model's end-of-stream numbers equal `expected_summary.json` (FLOOR 800/800, DOOR 87 remaining / 0 available, BALCONY 204 sold / 12 available; captured 4,618,132 ¢, refunded 137,682 ¢, net 4,480,450 ¢).
- [x] **3.3 Event screen.** Pool and tier cards; the formula on hover; on-sale windows; rules read-only; `SOLD_OUT_POOL` vs `SOLD_OUT_TIER` worded differently. *Acceptance:* e2e on the loaded fixture shows Door "87 remaining · 0 available — pool sold out".
- [x] **3.4 Buy screen (D-32, D-34, D-35).** GA quantity or balcony seat picker (rows as lists; an orphan-making pick shows `ORPHAN_SEAT` before checkout); hold countdown; Stripe Elements test checkout behind `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`; order with ticket codes; waitlist join and offer acceptance with countdown. *Acceptance:* e2e with `StripeRecorded` (no key in CI): hold → pay → webhook fixture → tickets shown; an expired hold shows the code, not a spinner. Live Elements is Shane's by-hand O-8. *As built:* `e2e/buy.spec.ts` (event clock moved into the window, hold ADV×2 → Pay → `PAYING pi_rec_… 7698` → signed fixture webhook `CONFIRMED` → two ticket codes; a stale tab's Pay after the clock passes the hold → `REJECT HOLD_EXPIRED`; seats A-A-01 + A-A-03 → `REJECT ORPHAN_SEAT`). Waitlist join/leave and offer pay/decline are built; their e2e is not (an offer needs a sold-out target) — 3.5's box-office spec is the natural place.
- [ ] **3.5 Box office.** Window sale through the same `castCommand`; waitlist per target with positions (head marked; no skip control exists); refunds show the computed amount and window before confirming. *Acceptance:* e2e: a refund preview equals the amount the cast then records, to the cent.
- [ ] **3.6 Door.** Check-in by code; the four refusals spelled out (`TICKET_UNKNOWN`, `TICKET_REFUNDED`, `DOORS_NOT_OPEN`, `ALREADY_CHECKED_IN` with the first scan time); live count. *Acceptance:* e2e covers all four and a success.
- [ ] **3.7 Ledger.** Captured, refunded, net; per order; CSV export (own writer, no CSV library). *Acceptance:* the CSV's totals equal 3.2's numbers.
- [ ] **3.8 Outbox notices (D-33).** Order confirmation and offer notice written in the cast transaction; the worker skips them. *Acceptance:* the drain test; outbox row counts after eval:db stated in EVAL.md.
- [ ] **3.9 Accessibility and e2e gate.** axe on every Turnstile page in e2e (Quorum pattern); production build per house rule. *Acceptance:* CI green.
- [ ] **3.10 `docs/EVAL.md` Phase 3 section + closure deliverables prompt** (DEMO.md, exec brief, LinkedIn posts, cost review — global definition of done).

**Exit criteria:** 3.1–3.9 green in CI; every screen number traced to the read model (no arithmetic in components, checked by a grep in `inventory:lint` extended to `src/app/o/**/turnstile`); PR open, not merged.

**CI-only / by-hand expected:** e2e and axe run in CI (local only for the specs touched); live Elements and the O-8 round trip are Shane's.

**Not built (seams only):** QR images and signed codes (P1), seat-map SVG (P1), public buyer accounts, sending any email.
