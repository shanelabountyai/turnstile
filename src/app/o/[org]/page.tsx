import Link from 'next/link';
import { eventNow } from '@/checkout/clock';
import { otherDemoOrg, usedUp } from '@/checkout/demo';
import { axis, day, saleState, time } from '@/checkout/format';
import { usedUpWords } from '@/checkout/prd3-wording';
import { readEvent } from '@/checkout/read';
import { demoEnabled } from '@/core/auth/demo';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { withOrg } from '@/core/db/rls';
import { LinkButton, PageHeader, Pill } from '@/components/ui';

// The clone's org home (D-63, PRD-4 item 14; revisits D-38). An org with no event keeps the template's text, which the
// template's onboarding.spec asserts for a new org. An org with an event shows it as a card under a PageHeader, so the
// first page after sign-in points at the walk instead of reading as empty. `id="main"` is the skip link's target
// (A11Y-3). The org bar in layout.tsx is not trimmed here: that is the optional part of item 14, left as a follow-up.
export const metadata = { title: 'Home · Turnstile' };

export default async function OrgHome({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const org = await db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  const events = await withOrg({ orgId: ctx.orgId }, (tx) => tx.event.findMany({ where: { orgId: ctx.orgId }, orderBy: { startsAt: 'asc' }, select: { id: true, eventKey: true, timezoneLabel: true, clockOffsetSeconds: true } }));
  const invite = <>This org is ready. <Link href={`/o/${ctx.slug}/settings/members`}>Invite your team</Link> to get started.</>;
  if (events.length === 0) {
    return (
      <main id="main">
        <PageHeader eyebrow={org.name} title="Nothing here yet" lead={invite} />
      </main>
    );
  }
  const views = await Promise.all(events.map(async (e) => ({ e, v: await readEvent(ctx.orgId, e.id, eventNow(new Date(), e)) })));
  return (
    <main id="main">
      <PageHeader eyebrow="Home" title={org.name} />
      {views.map(({ e, v }) => {
        const base = `/o/${ctx.slug}/events/${e.eventKey}`;
        const [k, word] = saleState(v);
        return (
          <section key={e.eventKey} aria-labelledby={`home-${e.eventKey}`} data-testid={`home-event-${e.eventKey}`}>
            <div className="cluster" style={{ justifyContent: 'space-between' }}>
              <h2 id={`home-${e.eventKey}`}><Link href={base}>{v.event.name}</Link></h2>
              <Pill k={k}>{word}</Pill>
            </div>
            {usedUp(demoEnabled(), { asOf: v.asOf, ...v.event }) && <p className="limit">{usedUpWords(otherDemoOrg(ctx.slug))}</p>}
            <p className="muted">{v.event.venue} · {day(v.event.startsAt)} · doors {time(v.event.doorsAt)} · event clock {axis(v.asOf)}</p>
            {/* not a <nav>: the template's demo.spec expects one navigation landmark on this page (the org bar) */}
            <div className="cluster">
              <LinkButton href={base}>Open event</LinkButton>
              <LinkButton href={`${base}/buy`} variant="secondary">Buy</LinkButton>
              <LinkButton href={`${base}/box`} variant="secondary">Box office</LinkButton>
              <LinkButton href={`${base}/door`} variant="secondary">Door</LinkButton>
              <LinkButton href={`${base}/ledger`} variant="secondary">Ledger</LinkButton>
            </div>
          </section>
        );
      })}
      <p className="muted">{invite}</p>
    </main>
  );
}
