# Design handoff

Source of truth for the UI built on branch `design/impl`. Exported 2026-11-18 from the Claude Design canvas so cloud runs don't depend on artifact access.

- Canvas: https://claude.ai/artifact/4rzCmhQZReXpfGftuiM792
- Brief: https://claude.ai/artifact/NiysEbYRU9Rpw7jC47kMvj

## Artboards (`docs/design/*.dc.html`)

Each file is a self-contained Design Component: HTML with inline styles, `{{holes}}` filled by the `renderVals()` script at the bottom. Read the markup and the script together; the script holds the sample data.

| File | Screen | Frame |
| --- | --- | --- |
| `Main.dc.html` | Buy — Dev's waitlist offer (desktop, clickable) | 1280×1180 |
| `Event.dc.html` | Event — pools and tiers (desktop) | 1280×1180 |
| `Box.dc.html` | Box office — Priya (desktop) | 1280×1180 |
| `Ledger.dc.html` | Ledger (desktop) | 1280×1180 |
| `Door.dc.html` | Door — Theo's scans (390 px, clickable) | 390×1000 |
| `BuyPhone.dc.html` | Buy — Marisol's slow payment (390 px) | 390×1000 |

## Owner calls (binding)

- Reopened for a design polish pass inside docs/DESIGN_SYSTEM.md: no new tokens, no web font, no image, no dependency. (Shane, 2026-11-18)
- Balcony seats stay rows-as-lists; no drawn seat map (P0-10).

## Gaps: screens the PRD needs that no artboard covers

- Events list (/o/[org]/events)
- Design reference page (/o/[org]/design) updated for any component change

Design each gap as a new `docs/design/<Name>.dc.html` in the same look before building it.

## Placeholders

Figures come from the frozen fixture end state; the Section C seat layout and Dev's place in line are labelled sample states.
