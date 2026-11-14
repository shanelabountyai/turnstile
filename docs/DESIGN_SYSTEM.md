# Turnstile design system

Ported from Quorum's (D-35, lineage in `docs/decisions.md`), trimmed to what the five screens use. Stylesheet: `src/app/turnstile.css`. Components: `src/components/ui.tsx`, `pill.tsx`. Live reference: `/o/<org>/design`.

## Principles
1. **A claim travels with its limit.** A count is shown with the rule it was judged under ("87 remaining · 0 available — pool sold out").
2. **An outcome is a word first, then a glyph, then a colour.** Colour is never the only signal.
3. **Integers as stored.** Cents, counts and `YYYY-MM-DDTHH:MM:SS` strings are shown as they are; no arithmetic in components (D-31).
4. **Semantic HTML carries the design.** Element styles come first; classes exist for a handful of components.
5. **One stylesheet, no dependency, no web font, no image.**

## Tokens
Three layers in one file: primitives (`--n-*` neutral, `--a-*` accent, type, space, radius), semantic (`--bg --sf --sf-2 --ink --mu --ln --ln-strong --ac --acf`; dark mode remaps this layer only), components. Status families `good · risk · hold · info · done` are a hue plus per-mode lightness, exposed as `--k-bg/--k-fg/--k-dot` on any `data-k` element.

Turnstile's mapping: `good` available / paid / checked in, `risk` sold out / refused, `hold` a timed hold or offer, `info` on sale, `done` closed / refunded.

## Components
`PageHeader` (the only `<h1>`), `Section`, `Stat`/`Stats`, `Pill`, `Notice`, `EmptyState`, `LinkButton`. Dropped from Quorum: `MeetingTabs`, `resultKind`, `violationKind`, the archived banner, the swatch.

## Accessibility, measured
`npm run design:contrast` parses the stylesheet and checks the token pairs in both schemes (text 4.5:1, borders and status edges 3:1); exits 1 under any floor. axe in e2e arrives with task 3.9. Not yet tested with real users.

## Changing it
Change the token here and in `turnstile.css` together, run `npm run design:contrast`, add a decisions row if a rule changes.
