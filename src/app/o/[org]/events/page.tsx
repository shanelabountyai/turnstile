import Link from 'next/link';
import { eventNow } from '@/checkout/clock';
import { axis, count, day, saleState, time } from '@/checkout/format';
import { readEvent } from '@/checkout/read';
import { requireOrg } from '@/core/authz/guards';
import { db } from '@/core/db';
import { withOrg } from '@/core/db/rls';
import { EmptyState, LinkButton, PageHeader, Pill } from '@/components/ui';

// Design pass (D-37, gap artboard docs/design/Events.dc.html): one card per event, each read through the read model on
// its own event clock (D-31, D-35), with the pools' counts and the five screens. One event per org in this build.
export default async function Events({ params }: { params: Promise<{ org: string }> }) {
  const ctx = await requireOrg((await params).org);
  const org = await db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  const events = await withOrg({ orgId: ctx.orgId }, (tx) => tx.event.findMany({ where: { orgId: ctx.orgId }, orderBy: { startsAt: 'asc' }, select: { id: true, eventKey: true, timezoneLabel: true, clockOffsetSeconds: true } }));
  const views = await Promise.all(events.map(async (e) => ({ e, v: await readEvent(ctx.orgId, e.id, eventNow(new Date(), e)) })));
  return (
    <main>
      <PageHeader eyebrow={`${org.name} · synthetic fixture data`} title="Events" lead="One card per event. Counts are worked out from sold and held tickets on the event clock when the page loads." />
      {views.length === 0 ? (
        <EmptyState action={<code>npm run turnstile:load -- --org {ctx.slug}</code>}>No event is loaded in this organisation yet. Load the fixture event and its synthetic customers from a terminal:</EmptyState>
      ) : views.map(({ e, v }) => {
        const base = `/o/${ctx.slug}/events/${e.eventKey}`;
        const [k, word] = saleState(v);
        return (
          <section key={e.eventKey} aria-labelledby={`ev-${e.eventKey}`}>
            <div className="cluster" style={{ justifyContent: 'space-between' }}>
              <h2 id={`ev-${e.eventKey}`}><Link href={base}>{v.event.name}</Link></h2>
              <Pill k={k}>{word}</Pill>
            </div>
            <p className="muted">{v.event.venue} · {day(v.event.startsAt)} · doors {time(v.event.doorsAt)} · event clock {axis(v.asOf)}</p>
            <div className="stats">
              {v.pools.map((x) => (
                <dl key={x.pool} className="stat" data-k={x.remaining > 0 ? 'good' : 'risk'}>
                  <dt>{x.pool} · {x.kind === 'GA' ? 'general admission' : 'reserved'}</dt>
                  <dd className="fig">{count(x.remaining)}</dd>
                  <dd className="sub">{x.remaining > 0 ? '✓ Seats available' : '✕ Pool sold out'} · left of {count(x.capacity)}</dd>
                </dl>
              ))}
            </div>
            <nav aria-label={`${v.event.name} screens`} className="cluster">
              <LinkButton href={base}>Open event</LinkButton>
              <LinkButton href={`${base}/buy`} variant="secondary">Buy</LinkButton>
              <LinkButton href={`${base}/box`} variant="secondary">Box office</LinkButton>
              <LinkButton href={`${base}/door`} variant="secondary">Door</LinkButton>
              <LinkButton href={`${base}/ledger`} variant="secondary">Ledger</LinkButton>
            </nav>
          </section>
        );
      })}
      <p className="limit">One event per organisation in this build (PRD non-goal: multi-event scheduling).</p>
    </main>
  );
}
