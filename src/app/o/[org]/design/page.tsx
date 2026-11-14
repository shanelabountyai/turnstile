import { requireOrg } from '@/core/authz/guards';
import { EmptyState, Notice, PageHeader, Pill, Section, Stat, Stats, type PillKind } from '@/components/ui';

const KINDS: [PillKind, string][] = [['good', 'Available'], ['risk', 'Sold out'], ['hold', 'Held'], ['info', 'On sale'], ['done', 'Closed']];

// The live reference for docs/DESIGN_SYSTEM.md: every token family drawn by the real stylesheet. Static text only.
export default async function Design({ params }: { params: Promise<{ org: string }> }) {
  await requireOrg((await params).org);
  return (
    <main>
      <PageHeader eyebrow="Design system" title="Turnstile design system" lead="Tokens and components, drawn by the real stylesheet." />
      <Section id="status" title="Status families">
        <p className="cluster">{KINDS.map(([k, w]) => <Pill key={k} k={k}>{w}</Pill>)}</p>
      </Section>
      <Section id="stats" title="Stats">
        <Stats>
          <Stat label="Door" value="87" sub="remaining · 0 available" k="risk" />
          <Stat label="Floor" value="800" sub="of 800 sold" k="good" />
        </Stats>
      </Section>
      <Section id="notices" title="Notices">
        <Notice k="hold" title="Pool sold out">The shared pool is full, whatever a tier has left.</Notice>
      </Section>
      <Section id="empty" title="Empty state"><EmptyState>No orders yet.</EmptyState></Section>
    </main>
  );
}
