import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eventNow } from '@/checkout/clock';
import { axis, count, time } from '@/checkout/format';
import { eventByKey, readEvent } from '@/checkout/read';
import { requireOrg } from '@/core/authz/guards';
import { withOrg } from '@/core/db/rls';
import { ActionForm } from '@/core/ui/action-form';
import { Announce } from '@/components/announce';
import { EventTabs, Notice, PageHeader, Pill, Stat } from '@/components/ui';
import { scanTicket } from './actions';

// Task 3.6, design pass (D-37, artboard docs/design/Door.dc.html, 390 px first): the door. One scan = one CHECK_IN
// cast; the answer is read back from the CommandLog and spelled out, so a refused scan says why (D-18 precedence:
// unknown → refunded → doors not open → already checked in). Counts are the read model's. The artboard's prototype
// buttons are not built: staff type or paste a real code.

const SAY: Record<string, (detail: string) => string> = {
  CHECKED_IN: (d) => `Admit. Ticket ${d} is checked in.`,
  TICKET_UNKNOWN: (d) => `No ticket for this event matches “${d}”. Do not admit.`,
  TICKET_REFUNDED: (d) => `Ticket ${d} was refunded and is not valid for entry.`,
  DOORS_NOT_OPEN: (d) => `Doors are not open yet; they open at ${axis(d)}.`,
  ALREADY_CHECKED_IN: (d) => `Already scanned: this ticket was first checked in at ${axis(d)}.`,
};

export const metadata = { title: 'Door · Turnstile' };

export default async function Door({ params, searchParams }: { params: Promise<{ org: string; event: string }>; searchParams: Promise<{ r?: string }> }) {
  const ctx = await requireOrg((await params).org);
  const p = await params;
  const q = await searchParams;
  const ev = await eventByKey(ctx.orgId, p.event);
  if (!ev) notFound();
  const v = await readEvent(ctx.orgId, ev.id, eventNow(new Date(), ev));
  const result = q.r ? await withOrg(ctx, (tx) => tx.commandLog.findUnique({ where: { eventId_cmdId: { eventId: ev.id, cmdId: q.r! } }, select: { status: true, code: true, detail: true, at: true } }), { atomic: false }) : null;
  const base = `/o/${ctx.slug}/events/${ev.eventKey}`;
  const ok = result?.status === 'OK';

  return (
    <>
      <EventTabs base={base} current="door" />
      <main id="main">
        <PageHeader
          eyebrow={v.event.name}
          title="Door"
          status={<><Pill k="info">Doors open {time(v.event.doorsAt)}</Pill><Pill k="info">Event clock {axis(v.asOf)}</Pill></>}
          lead={<>Doors open {axis(v.event.doorsAt)} ({v.event.timezoneLabel}); <Link href={`${base}#clock`}>change the event clock on the event page</Link>.</>}
        />

        <div className="stats pair">
          <Stat label="Checked in" value={<span data-testid="checked-in">{count(v.ledger.checkedIn)}</span>} k="good" sub="✓ admitted" />
          <Stat label="Live tickets" value={<span data-testid="live">{count(v.ledger.ticketsLive)}</span>} sub={`${count(v.ledger.toArrive)} to arrive`} />
        </div>

        <section aria-labelledby="scan" className="wide">
          <h2 id="scan">Scan</h2>
          {result && (
            <>
            <Notice k={ok ? 'good' : 'risk'} title={ok ? 'ADMIT' : 'DO NOT ADMIT'} verdict>
              <p data-testid="result">{(SAY[result.code] ?? ((d: string) => d))(result.detail)} · at {axis(result.at)}</p>
              <code>{result.code}</code>
            </Notice>
            <Announce assertive text={`${ok ? 'Admit' : 'Do not admit'}. ${(SAY[result.code] ?? ((d: string) => d))(result.detail)}`} />
            </>
          )}
          <ActionForm action={scanTicket.bind(null, ctx.slug)}>
            <input type="hidden" name="event" value={ev.eventKey} />
            <label>Ticket code <input name="code" autoComplete="off" autoFocus required /></label>
            <button type="submit">Check in</button>
          </ActionForm>
          <p className="hint">The 20-character code on the ticket, or its ticket number. Refusals are checked in this order: unknown, refunded, doors not open, already scanned.</p>
        </section>
      </main>
    </>
  );
}
