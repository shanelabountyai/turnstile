import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eventNow } from '@/checkout/clock';
import { eventByKey, readEvent } from '@/checkout/read';
import { requireOrg } from '@/core/authz/guards';
import { withOrg } from '@/core/db/rls';
import { ActionForm } from '@/core/ui/action-form';
import { Notice, PageHeader, Pill, Section, Stat, Stats } from '@/components/ui';
import { scanTicket } from './actions';

// Task 3.6: the door. One scan = one CHECK_IN cast; the answer is read back from the CommandLog and spelled out, so a
// refused scan says why (D-18 precedence: unknown → refunded → doors not open → already checked in). Counts are the
// read model's.

const when = (t: string) => t.replace('T', ' ');
const SAY: Record<string, (detail: string) => string> = {
  CHECKED_IN: (d) => `Admit. Ticket ${d} is checked in.`,
  TICKET_UNKNOWN: (d) => `No ticket for this event matches “${d}”. Do not admit.`,
  TICKET_REFUNDED: (d) => `Ticket ${d} was refunded and is not valid for entry.`,
  DOORS_NOT_OPEN: (d) => `Doors are not open yet; they open at ${when(d)}.`,
  ALREADY_CHECKED_IN: (d) => `Already scanned: this ticket was first checked in at ${when(d)}.`,
};

export default async function Door({ params, searchParams }: { params: Promise<{ org: string; event: string }>; searchParams: Promise<{ r?: string }> }) {
  const ctx = await requireOrg((await params).org);
  const p = await params;
  const q = await searchParams;
  const ev = await eventByKey(ctx.orgId, p.event);
  if (!ev) notFound();
  const v = await readEvent(ctx.orgId, ev.id, eventNow(new Date(), ev));
  const result = q.r ? await withOrg(ctx, (tx) => tx.commandLog.findUnique({ where: { eventId_cmdId: { eventId: ev.id, cmdId: q.r! } }, select: { status: true, code: true, detail: true, at: true } }), { atomic: false }) : null;
  const base = `/o/${ctx.slug}/events/${ev.eventKey}`;

  return (
    <main>
      <PageHeader
        eyebrow={v.event.name}
        title="Door"
        status={<Pill k="info">Event clock {when(v.asOf)}</Pill>}
        lead={<>Doors open {when(v.event.doorsAt)} ({v.event.timezoneLabel}); <Link href={`${base}#clock`}>change the event clock on the event page</Link>.</>}
      />

      <Stats>
        <Stat label="Checked in" value={<span data-testid="checked-in">{v.ledger.checkedIn}</span>} />
        <Stat label="Live tickets" value={<span data-testid="live">{v.ledger.ticketsLive}</span>} sub="issued, not refunded" />
        <Stat label="Still to arrive" value={v.ledger.ticketsLive - v.ledger.checkedIn} />
      </Stats>

      <Section id="scan" title="Scan">
        {result && (
          <Notice k={result.status === 'OK' ? 'good' : 'risk'} title={result.code}>
            <span data-testid="result">{(SAY[result.code] ?? ((d: string) => d))(result.detail)} · at {when(result.at)}</span>
          </Notice>
        )}
        <ActionForm action={scanTicket.bind(null, ctx.slug)}>
          <input type="hidden" name="event" value={ev.eventKey} />
          <div className="cluster">
            <label>Ticket code <input name="code" autoComplete="off" autoFocus required /></label>
            <button type="submit">Check in</button>
          </div>
        </ActionForm>
        <p className="hint">The 20-character code on the ticket, or its ticket number.</p>
      </Section>
    </main>
  );
}
