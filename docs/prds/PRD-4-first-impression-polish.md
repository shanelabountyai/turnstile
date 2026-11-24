# PRD-4 — First impression and screen polish

**Status:** Built (draft PR), 2026-11-24: items 13, 14, 15, 16, 17 and 19 (D-75 to D-80), on branch `prd-4/first-impression-polish`, stacked on PRD-3. Not merged. Left out: the org bar trim (item 14's optional part, a follow-up). Item 14 follows D-63. The browser checks were written as Playwright specs; see the PR for which ran here.
**Source:** `docs/audits/FIVE-LENS-2026-11-21.md` §3 PRD-4; review items 13, 14, 15, 16, 17, 19.
**Evidence:** file:line at `9d8b434`, as the review cites it. #9 did not touch these files.
**Rule that applies:** question, result and notice wording is Shane's. Copy changes here are proposals for him to edit.

## Problem

The first page after sign-in reads as empty, and its skip link points at nothing. The main forms and the seat grid look unfinished at 1280 and 390:
- buttons sit at label height on every form;
- seat rows break in half on a phone;
- a stale "Payment started" banner stays up;
- plurals are wrong ("1 orders");
- an orphan refusal clears the pick and names no seat.

## Evidence

| Item | Findings | Evidence (at `9d8b434`) |
|---|---|---|
| 13 | DES-1: `align-self: flex-start` on buttons beats the cluster's `align-items: flex-end`; six inline overrides are dead; `fieldset.plain` has no gap | `src/app/turnstile.css:139` vs `:288`; `buy/page.tsx:235`, `:285`, `:314`; `box/page.tsx:103`, `:115`, `:135` |
| 14 | UX-7, DES-3, A11Y-3, DES-4, UX-8 (part): the org home is the template's "Nothing here yet"; `<main>` has no `id="main"` (axe `skip-link` and `region` on 4 runs); the org bar has nine template links against the artboard's three | `src/app/o/[org]/page.tsx:8-10`; `src/app/o/[org]/layout.tsx:16`, `:20-28` |
| 15 | DES-2, A11Y-4: at 390, 12-seat rows wrap 6 + 6; seat names are "A-A-01 open" while the visible text is "1" (WCAG 2.5.3) | `src/app/turnstile.css:264-266`; `buy/page.tsx:268-275`, `:270-271` |
| 16 | A11Y-2: the spoken warning reads "left on time left on H-…"; the zero message may be lost when the refresh unmounts its region (suspected) | `buy/page.tsx:168`; `src/components/countdown.tsx:36` |
| 17 | UX-11, DES-11, UX-17, DES-7 (item 7), UX-9: the "Payment started" banner stays after tickets issue; "1 orders" and "1 lines"; the customer picker moves about 2,400 px down at 1280 with no "change" link | `buy/page.tsx:110-117`, `:120`, `:341`; `ledger/page.tsx:73`, `:84` |
| 19 | UX-14: an orphan refusal drops the picked seats and names no seat | `buy/actions.ts:30` |

Items 15 and 19 were already follow-ups in NEXT.md 2026-11-19. D-38 placed the picker, and a link does not move it.

## Scope

1. **Buttons (item 13).**
   - Drop `align-self: flex-start` from the base button rule, or set `align-self: auto` inside `.cluster`.
   - Delete the six inline `alignItems` styles.
   - Give `fieldset.plain` a flex column with `gap: var(--s-3)`.
   - No new token.
2. **Org home (item 14), after Decision 5.**
   - Keep the text `onboarding.spec` asserts. Add `id="main"` and an event card or link under a `PageHeader`.
   - Trim the org bar toward the artboard set, with settings under one item. This is the M part and optional for the first pass.
3. **Seats at 390 (item 15).**
   - Each row stays on one line: either a focusable scroll region per section, or seats that shrink to fit 12 across while keeping at least 24 px (WCAG 2.5.8).
   - Seat accessible names start with the visible number.
4. **Countdown (item 16).**
   - Pass `label={h.hold}` so the warning reads "Two minutes or less left on H-…".
   - Put the zero message in a region that survives the refresh.
5. **Small screen fixes (item 17).**
   - Hide or restyle the result banner once the hold has moved on.
   - Pluralise "order" and "line".
   - Add a "change customer" link by the Buy title, jumping to `#as`.
6. **Orphan refusal (item 19).** Carry the picked seats back as ticks and name the seat that would be stranded. The engine is unchanged: the seat is worked out for display only, from the refused pick and the read model.

## Out of scope

- The visual polish batch (item 26), the seat-grid keyboard model (item 28) and template screens (item 27). They are in PRD-5.
- Redirecting the org home to Events (Decision 5 option c). It breaks template e2e.
- Any change to `src/inventory/` or the `ORPHAN_SEAT` rule.

## Acceptance tests

- In every `.cluster` form at 1280, the button's bottom edge is within 1 px of the field's bottom edge (Playwright bounding boxes).
- At 390, the 12 seats of a row share one line or one scroll region. Each seat's accessible name starts with its visible number.
- `/o/acme`: axe reports 0 violations (the skip link resolves), a link to the event is present, and template `onboarding.spec` still passes.
- The two-minute announcement reads "Two minutes or less left on H-…" (no repeated "time left").
- Once the order exists, the "Payment started" banner is gone. The ledger reads "1 order" and "1 line".
- An orphan refusal names the stranded seat and keeps the picked seats ticked.
- `design:contrast` finds 0 pairs under the floor, and axe finds 0 violations on every Turnstile page, light and dark, at 1280 and 390.
- `inventory:lint` is OK (no arithmetic in screen files).

## Review items covered

13, 14, 15, 16, 17, 19. None is covered by #9.
