# Design lens — Turnstile live release (main 9d8b434)

Scope: visual design only (hierarchy, spacing, type, colour, consistency, mobile at 390, dark scheme, token use, artboard divergence). Read-only; nothing in the repo was changed.
Inputs: 33 screenshots in `review/shots/` (production build, seeded like production; INDEX.md), `docs/DESIGN_SYSTEM.md`, `src/app/turnstile.css`, `src/components/{ui,pill}.tsx`, the six event screens under `src/app/o/[org]/events/**`, `src/app/o/[org]/{page,layout}.tsx`, `docs/design/*.dc.html` + `HANDOFF.md`, decisions D-37..D-43.
Given, not re-run: `npm run design:contrast` OK, 0 pairs under floor.

Severity totals: **Blocker 0 · Major 3 · Minor 10**

---

## DES-1 Inline buttons sit at the label's height, not the field's
- **Severity:** Major
- **Where:** `src/app/turnstile.css:139` (`button, .button { … align-self: flex-start }`) defeats `turnstile.css:288` (`.cluster:has(> label) { align-items: flex-end }`) and the inline `alignItems: 'flex-end'` at `buy/page.tsx:235, 285, 314` and `box/page.tsx:103, 115, 135`; also `[event]/page.tsx:122` (Set clock). Screens: 04-event-1280 (Set clock), 05-buy-before-acting-1280 (Act as), 06-buy-hold-c0001-1280 (Hold tickets, Join the Section A waitlist, Join waitlist, Act as), 07, 06b.
- **Observed:** On every form with a field and a button in one row, the button's top lines up with the label text and its bottom sits about halfway down the input. The intended bottom-alignment exists in CSS twice and inline six times, but `align-self` on the button overrides the container's `align-items` every time. Related: "Hold seats in A" sits flush under seat row F with almost no gap (06, 07), because the nested `fieldset.plain` (`buy/page.tsx:262`, `turnstile.css:289`) is not a flex column, so the `--s-3` gap does not apply.
- **Why it matters:** These are the main actions on Buy, Box office and Event, and they look misaligned on every screen at 1280. It is the most visible unfinished detail in the product, and the six inline overrides show someone tried to fix it and it did not take.
- **Recommended fix:** Drop `align-self: flex-start` from the base button rule (or add `.cluster > button, .cluster > .button { align-self: auto }`), then delete the six inline `alignItems` styles. Give `fieldset.plain` `display:flex; flex-direction:column; gap:var(--s-3)`.
- **Verified:** read the CSS and the code, and seen in the screenshots listed.

## DES-2 Seat rows break in half at 390, which hides which seats are next to each other
- **Severity:** Major
- **Where:** `turnstile.css:264` (`.seats { flex-wrap: wrap }`) with 44 px seats (`:266`), `buy/page.tsx:268-275`. Screen: 06-buy-hold-c0001-390 (also 07/06b at 390).
- **Observed:** At 390 each 12-seat row wraps to two lines of 6 (1–6, then 7–12). Six rows therefore look like twelve. Seat 6 sits at the right edge and seat 7 starts the next line, so they no longer look adjacent.
- **Why it matters:** The whole balcony rule (ORPHAN_SEAT) is about adjacency, and the legend says "Rows read left to right". On a phone, the layout breaks the spatial model the user needs in order to avoid a refused pick. P0-10 (rows as lists, no drawn map) is not in question; the issue is only the wrap. No phone artboard covered this screen (HANDOFF lists BuyPhone as the late-payment receipt only).
- **Recommended fix:** Keep each row on one line. Either use `flex-wrap: nowrap` inside a focusable horizontal scroll region per section (the `ScrollTable` pattern), or below 640 px shrink seats to fit 12 across (318 px of card width fits 12 × 24 px + 2 px gaps, which still meets the WCAG 2.5.8 24 px minimum). If wrapping stays, add a visible "continues →" marker between 6 and 7.
- **Verified:** seen in the screenshot; the width arithmetic comes from the CSS tokens.

## DES-3 After signing in, the first org page is the template's "Nothing here yet"
- **Severity:** Major
- **Where:** `src/app/o/[org]/page.tsx:8-9` (clone-owned; its own comment says "The clone replaces this page with its own home"). Screens: 02-org-home-1280 / -390. The nav's first item, "Home", links here (`src/app/o/[org]/layout.tsx:20`).
- **Observed:** A bare `<h1>Nothing here yet</h1>` and "Invite your team to get started". There is no PageHeader, eyebrow or rule, and no pointer to the seeded event, even though the org has a live event with sales open. It is the only clone page that does not use the design system's page structure.
- **Why it matters:** Reviewers and hiring managers who come from /demo meet a page that reads as empty and unfinished, one click before the polished screens. D-38 keeps it unchanged because template e2e `onboarding.spec` expects it. That explains the decision but does not fix the first impression.
- **Recommended fix:** Keep whatever text `onboarding.spec` asserts, and add the Events card (or a one-line "Your event: Synthetic Night → Open event") under a PageHeader. Alternatively, make the wordmark/Home both point to Events, as the wordmark already does (`layout.tsx:18`).
- **Verified** (page content and code). **Suspected:** whether a visitor lands here directly. `/demo/signin` redirects to `/onboarding` (template), and I did not trace the next hop.

## DES-4 The org bar carries ten template items; the artboard had three
- **Severity:** Minor
- **Where:** `src/app/o/[org]/layout.tsx:20-28` (clone-owned). Artboard `docs/design/Events.dc.html` nav: Events, Members, Audit log, then Your orgs / Account. Screens: every signed-in 1280 shot; 03/04/09-390 (org bar cut at "P", event tabs cut at "Ledger").
- **Observed:** The bar shows Home, Events, Projects, Members, Audit log, Security, SSO, API keys, Export or delete. Projects is template scaffolding. SSO and API keys are unwired (D-6). "Events", the product, is one item in nine. At 390 the bar and the event tabs scroll sideways (by design, DESIGN_SYSTEM.md §Design pass), but nothing shows that they scroll: no fade or chevron, and items are cut mid-word.
- **Why it matters:** The org bar diverges from the artboard more than D-38 accounts for (D-38 names only members, audit and account). It also dilutes the hierarchy on every page.
- **Recommended fix:** Trim to the artboard set and move the other settings under Account or a "Settings" item. On a phone, add an edge fade on `.org-nav` / `.event-tabs` when they overflow.
- **Verified.**

## DES-5 "Why N available" is a disclosure that looks like a heading
- **Severity:** Minor
- **Where:** `turnstile.css:152` (`details > summary { display: flex }` removes the `::marker` triangle in Chromium); `[event]/page.tsx:83-86`. The artboard has the same rule (`Event.dc.html:64`). Screens: 04-event-1280, 04-event-1280-dark, 11-globex-event-1280.
- **Observed:** "Why 200 available" renders as a bold line with nothing under it and no triangle, plus/minus or chevron, so it reads as an orphaned subheading. The tier card also repeats its numbers: the `dl.figs` grid gives Remaining/Available, and then `page.tsx:82` prints "200 remaining · 200 available" again. That line is not on the artboard.
- **Why it matters:** The explanation of the pool-versus-tier rule, which is the product's core idea, is hidden behind a control nobody can recognise. The repeated numbers lengthen every tier card by two lines.
- **Recommended fix:** Add a `summary::before` glyph that rotates on `[open]` (CSS only, no new token). Drop the repeated count line, or keep only its "— pool sold out" reason when there is one; the `title` formula can move onto the figs.
- **Verified.**

## DES-6 Pills wrap to two or three lines
- **Severity:** Minor
- **Where:** `turnstile.css:293` (`.pill { white-space: normal }`) overrides `:225` (`nowrap`). Screens: 04-event-1280 (DOOR "On sale from Mar 20, 2027 · 5:00 PM"), 11-globex-event-1280 (all four "Off sale since …" pills), 12-globex-ledger-1280 ("1 of 2 tickets refunded", "Refunded in full · paid after the hold ended"), 06-buy-hold-c0001-390 (a three-line oval in the tier table).
- **Observed:** Long pill text wraps inside the rounded shape and turns into lozenges of uneven height. The artboards keep pills on one line (`Ledger.dc.html:72` `white-space: nowrap`).
- **Why it matters:** Pills are the status system's main mark. Wrapped pills break row rhythm in the tier grid and the ledger, and look unfinished.
- **Recommended fix:** Keep pills `nowrap` with short words ("Off sale", "Refunded", "On sale 5:00 PM"), and move the date or detail into the adjacent muted text, as D-41 already does for the reason.
- **Verified.**

## DES-7 Ledger table: ids break, the table doesn't fill its card, the pager sits between the two tables, and at 390 the key columns are off screen
- **Severity:** Minor
- **Where:** `ledger/page.tsx:50-58, 87-100`; `turnstile.css:303` (`.table-wrap > table { display: table }`, no width). Screens: 09-ledger-1280, 12-globex-ledger-1280, 09-ledger-390, 12-globex-ledger-390.
- **Observed:**
  1. At 1280, "ORD-00001" breaks onto two lines at the hyphen on every row. The Tickets column, which carries seat lists, takes the width.
  2. In 09 the table stops at about 60% of the card width, while the artboard has `width: 100%` (`Ledger.dc.html:55`).
  3. "Lines 1–50 of 452 · Next 50" (`:94`) sits right under the one-row late-money table, so it reads as that table's pager.
  4. The late-money caption is body text while the main caption is `.hint`.
  5. At 390, Net and Status (the reconciling figures) are off screen to the right and the caption is clipped mid-word ("in payment c").
  6. The seven stat cards stack one per row at 390. Door's `.stats.pair` shows the fix already exists.
  7. "1 orders" (`:73`) and "1 lines" (`:84`) are unpluralised.
- **Why it matters:** The ledger is the "to the cent" proof screen, and it looks the least finished at both widths.
- **Recommended fix:** `width:100%` on tables in `.table-wrap`; `white-space:nowrap` on the Order column; put seats on a second muted line in Tickets; put the top pager after the main caption; use one caption style; use `.stats.pair` for the four count stats; pluralise.
- **Verified.**

## DES-8 Event page at 390: the rules list squeezes its values into a narrow column, and the refund table hides a column
- **Severity:** Minor
- **Where:** `turnstile.css:167` (`dl { grid-template-columns: max-content 1fr }`), `[event]/page.tsx:94-111`. Screen: 04-event-390 (lower half).
- **Observed:** The longest `dt` ("Payment must land within") takes the max-content column, leaving about 110 px for values, which then wrap one or two words per line (e.g. "A hold may / not leave one / seat stranded…"). In the refund-windows table the 4th column ("In words") is off screen inside its scroll region, and each row is about 3× taller because that column wraps to its min-content width.
- **Why it matters:** The Rules card is the page's plain-language summary, and on a phone it is the hardest block to read.
- **Recommended fix:** Below 640 px, set `dl:not(.figs):not(.stat)` to one column (dt above dd). For the refund table, either `white-space:nowrap` on `td` so it scrolls cleanly, or drop the "Refund / Service fee" columns on a phone since "In words" says both.
- **Verified.**

## DES-9 Buy has up to four filled primary buttons at once
- **Severity:** Minor
- **Where:** `buy/page.tsx:176, 242, 279, 322`. Screens: 06-buy-hold-c0001-1280, 06b, 07.
- **Observed:** With a live hold, "Pay $76.98", "Hold tickets", "Hold seats in A" and "Join waitlist" are all filled oxblood, so the one action on a timer gets no more weight than the rest. DESIGN_SYSTEM's rule is "one per form", which holds, but nothing sets page-level priority.
- **Recommended fix:** While a hold or offer is live, render the other primaries as `.secondary`, so Pay is the only filled button on the page.
- **Verified.**

## DES-10 Status colour on neutral or zero figures, and the clock shares the "on sale" colour
- **Severity:** Minor
- **Where:** `box` stats (Waiting with a `hold` amber edge at 0; 08a), `door` (Checked in with a `good` green edge and ✓ at 0; 10a/10b), events list pool stats (`events/page.tsx:38`). The event-clock pill is `info` on every page (`[event]/page.tsx:41`, buy/box/door/ledger headers), the same family as "On sale".
- **Observed:** Coloured edges appear on cards whose value is not a status, such as "0 waiting" in amber or "0 admitted" with a green check. The clock, a neutral fact, wears the same blue dot as "On sale".
- **Why it matters:** DESIGN_SYSTEM maps families to meanings (good = available/paid/checked in, hold = timed hold, info = on sale). Using them for plain counts weakens the signal where it matters.
- **Recommended fix:** Colour an edge only when the figure carries a judgement, e.g. hold only when someone is waiting. Show the clock as a neutral `.receipt`-style chip or plain muted text.
- **Verified.**

## DES-11 An amber "Payment started" banner stays up after the tickets show green "Paid"
- **Severity:** Minor (the UX lens may own the flow side)
- **Where:** Buy result notice; screen 06b-buy-paid-c0001-1280/-390.
- **Observed:** The top notice (hold family, ◆) says "Payment started. The tickets are issued when the payment is confirmed." Directly under it, "Your tickets" shows a green Paid pill and two ISSUED tickets. Two colour families tell two different stories on one screen.
- **Recommended fix:** When the result being echoed is older than the current state (the order exists), either drop the banner or restyle it as `done` with "Earlier: payment started …".
- **Verified** (screenshot). The flow that produced it was a recorded webhook (INDEX.md).

## DES-12 Type scale and spacing drift from the tokens; inline styles repeat patterns
- **Severity:** Minor
- **Where:** `turnstile.css` after line 90: `font-size` 12px ×4, 14px ×2, 16px ×3, 34px ×1, which sit outside the 13/15/17/20/24/30/40 scale (`:30`). Spacing outside the 4 px grid: 10px, 14px, 6px, 22px, 2px. Its own header (`:3`) says "Nothing below uses a raw value". Event screens: **no raw hex, no px, no oklch in any `.tsx`** under `src/app/o/[org]/events/**`. There are 14 inline `style=` props, all layout-only and token-based: `justifyContent:'space-between'` ×3 (plus `ui.tsx:27`), `alignItems:'flex-end'` ×6 (dead, see DES-1), list reset ×2, `gap: var(--s-1)` ×2, `margin:0` ×1.
- **Why it matters:** In practice the scale has 11 sizes instead of 7, and eyebrow (12), table header (12), org name (14), body-in-cards (16) and body (17) differ by 1 px steps that read as inconsistency rather than hierarchy. The repeated inline patterns are missing utilities.
- **Recommended fix:** Map 12→`--t-xs`, 14/16→`--t-sm`/`--t-base`, 34→a token. Add `.cluster.between` and `.bare` (list reset) and remove the inline styles. Or update the header comment to say which raw values are allowed.
- **Verified** (grep).

## DES-13 Template screens (/demo, error page) look like a different, plainer product
- **Severity:** Minor
- **Where:** `src/app/(public)/demo/page.tsx` (template-owned, on the drift list `scripts/foundation-drift.ts:11`); the app error page. Screens: 01-demo-1280/-390, 13-member-set-clock-1280.
- **Observed:** Both use Turnstile's tokens (paper background, serif h1, oxblood button), so the colour is consistent. But /demo is a bulleted list of six full-weight primary buttons with the role on the line below each, with no wordmark, header or grouping by org. The error page is an h1, an error id and "Try again", with no org bar or way back. They are the first and the worst screens in the visitor walk.
- **Recommended fix:** Within template ownership, propose upstream (FOUNDATION_PATCHES.md) grouping demo accounts by org with role as a pill and secondary buttons. Locally, add a clone `error.tsx` under `/o/[org]` that keeps the org bar. The member Set-clock 500 itself is known (NEXT.md) and belongs to the code lens.
- **Verified.**

---

## Artboard divergence (design pass D-37, artboards in docs/design/)
| Screen | Divergence | Explained? |
|---|---|---|
| Event | Tier ids (EARLY/ADV/…) instead of "Early bird/Advance" | Yes, D-41 |
| Event | Extra "N remaining · N available" line under the figs (DES-5) | No |
| Event | On-sale windows as axis strings `2026-12-01 10:00:00` vs "Dec 1, 2026 10:00 AM" | Not by D-38/41. DESIGN_SYSTEM principle 3 ("strings shown as they are") may cover it; the header lead already uses formatted dates, so the page mixes both |
| Event | Event clock section at the foot | Yes, D-38 |
| Buy | No "seats together" auto-pick; section waitlist under the rows | Yes, D-38(1) |
| Buy | Acting-as picker card | Yes, D-38 |
| BuyPhone | No "Your order" h1 | Yes, D-38(4) |
| Door | Serif verdict instead of the artboard's sans 34 px | Yes, D-42 (declined) |
| Ledger | "Per payment" + Customer column + paging; table not full width; pills wrap (DES-6/7) | Paging yes (D-42); column, width and wrap no |
| Org bar | Ten items vs three (DES-4) | Partly. D-38 names members/audit/account only |
| Org home | Unchanged template empty state (DES-3) | Yes, D-38 (template e2e). Explains it but doesn't solve the problem |

## Checked and clean
- **Dark scheme** (04-event-1280-dark): every surface, line, pill family, the scope bar and the primary button remap through the semantic layer. No hard-coded light colour leaks, and hierarchy holds. Only the event page was captured dark.
- **Token use in Turnstile `.tsx`:** no raw hex, px or colour functions in any event screen. Components (`PageHeader`, `Section`, `Stat`, `Pill`, `Notice`, `EmptyState`, `ScrollTable`, `EventTabs`) are used consistently across Events, Event, Buy, Box, Door and Ledger.
- **Status glyphs:** every pill and notice pairs a glyph, a word and a colour (principle 2).
- **No sideways page scroll at 390** on any captured page. Tables and nav scroll inside themselves, as documented.
- **Door at 390:** the verdict above the field, the full-width input and button, and the two-up stats read well at arm's length.
- **Box office refund preview** (08b): clear hierarchy, with the amount as `fig-lg` in a receipt well and the per-ticket table below it.
- **Consistency across the six Turnstile screens:** the same page head (eyebrow, serif h1, clock pill, lead, rule), the same card treatment and the same container width.

## Not reviewed / could not check
- The real Stripe Elements form (not rendered; no key).
- Taken, held or picked seat states in the seat grid. Every captured seat was OPEN, so the struck-through and ✓ styles were read from CSS only (`turnstile.css:271-273`).
- Door ADMIT and other verdicts (only DOORS_NOT_OPEN was captured); the waitlist-offer state on Buy; the late-money receipt on Buy.
- Dark scheme on every screen except Event; hover states; the `/o/<org>/design` reference page (not captured).
- Real Safari/macOS font rendering. Screenshots use Linux Chromium fallbacks for `ui-serif`/`system-ui`, so heading shapes will differ on a Mac.
- I did not re-run `design:contrast` or axe (given as OK).
