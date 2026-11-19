import { requireOrg } from '@/core/authz/guards';
import { EmptyState, Notice, PageHeader, Pill, Section, Stat, Stats, type PillKind } from '@/components/ui';

const KINDS: [PillKind, string][] = [['good', 'Available'], ['risk', 'Pool sold out'], ['hold', 'Held for you'], ['info', 'On sale'], ['done', 'Off sale']];

// The live reference for docs/DESIGN_SYSTEM.md: every component the screens use, drawn by the real stylesheet. Static
// text only, placeholders in brackets (gap artboard docs/design/Design.dc.html, D-37).
export default async function Design({ params }: { params: Promise<{ org: string }> }) {
  await requireOrg((await params).org);
  return (
    <main>
      <PageHeader eyebrow="Design system" title="Turnstile design system" lead="Every component the five screens use, drawn by the real stylesheet. No new tokens: the design-pass parts below are compositions of existing ones." />
      <Section id="status" title="Status families · word, glyph, colour">
        <p className="cluster">{KINDS.map(([k, w]) => <Pill key={k} k={k}>{w}</Pill>)}</p>
      </Section>
      <Section id="tabs" title="Event tabs">
        <nav aria-label="Example event screens" className="tabs">
          <a href="#tabs" aria-current="page">Event</a><a href="#tabs">Buy</a><a href="#tabs">Box office</a><a href="#tabs">Door</a><a href="#tabs">Ledger</a>
        </nav>
        <p className="hint">A second row under the org bar on every event screen; the current one is bold and underlined.</p>
      </Section>
      <Section id="stats" title="Stats">
        <Stats>
          <Stat label="[tier]" value="[remaining]" sub="remaining · [available] available" k="risk" />
          <Stat label="[pool]" value="[sold]" sub="of [capacity] sold" k="good" />
        </Stats>
        <dl className="figs">
          <div><dt>Allotment</dt><dd>[n]</dd></div><div><dt>Sold</dt><dd>[n]</dd></div><div><dt>Remaining</dt><dd>[n]</dd></div><div><dt>Available</dt><dd>[n]</dd></div>
        </dl>
      </Section>
      <Section id="seats" title="Seats in a row">
        <form className="stack" aria-label="Example seat row">
          <ol className="seat-rows">
            <li>
              <span className="row-id">Row [r]</span>
              <span className="seats" role="group" aria-label="Example row">
                <label className="seat" data-k="hold"><input type="checkbox" aria-label="Example seat 1 open" />1</label>
                <label className="seat" data-k="hold"><input type="checkbox" defaultChecked aria-label="Example seat 2 open, picked" />2</label>
                <label className="seat" data-k="hold"><input type="checkbox" disabled aria-label="Example seat 3 sold" />3</label>
              </span>
            </li>
          </ol>
        </form>
        <p className="hint">Open: outlined. Picked: the hold family and a ✓. Sold or held: filled, struck through and disabled. Each seat is a real checkbox in a 44 px label; its id and state are its name.</p>
      </Section>
      <Section id="notices" title="Notices">
        <Notice k="hold" title="Held for you: [seats]">[countdown] to pay.</Notice>
        <Notice k="risk" title="DO NOT ADMIT" verdict><p>Already scanned: first checked in at [time].</p><code>ALREADY_CHECKED_IN</code></Notice>
        <Notice k="good" title="ADMIT" verdict><p>Ticket [ticket] is checked in.</p><code>CHECKED_IN</code></Notice>
      </Section>
      <Section id="receipt" title="Receipt figure and steps">
        <div className="receipt stack" style={{ gap: 'var(--s-1)' }}>
          <span className="eyebrow">Customer gets back</span>
          <span className="fig-lg">[amount]</span>
          <span className="hint">Price × [window %] per ticket, rounded down to the cent.</span>
        </div>
        <ol className="steps"><li>Pick tickets or seats</li><li aria-current="step">Pay while held (the current step)</li><li>Tickets</li></ol>
      </Section>
      <Section id="empty" title="Empty state"><EmptyState>No orders yet.</EmptyState></Section>
    </main>
  );
}
