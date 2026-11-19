import { notFound } from 'next/navigation';
import { eventNow } from '@/checkout/clock';
import { axis, count } from '@/checkout/format';
import { dollars, eventByKey, readEvent, type EventView } from '@/checkout/read';
import { requireOrg } from '@/core/authz/guards';
import { EventTabs, LinkButton, PageHeader, Pill, Section, Stat, Stats, type PillKind } from '@/components/ui';

// Task 3.7, design pass (D-37, artboard docs/design/Ledger.dc.html): the ledger. Captured, refunded and net come from
// the engine's summary; one line per captured payment (late money has no order), and the CSV is the same lines. No
// arithmetic here: every number is the read model's.

type Line = EventView['payments'][number];
type Ord = EventView['orders'][number];

function status(x: Line, o: Ord | undefined): [PillKind, string] {
  if (x.late) return ['done', x.late === 'PAID_AFTER_CANCEL' ? 'Refunded in full · paid after cancel' : 'Refunded in full · paid after the hold ended'];
  if (x.refundedCents === 0) return ['good', 'Paid'];
  if (x.refundedCents === x.capturedCents) return ['done', 'Refunded in full'];
  const n = o ? o.states.filter((s) => s === 'REFUNDED').length : 0;
  return ['done', `${n} of ${x.qty} tickets refunded`];
}

export default async function Ledger({ params }: { params: Promise<{ org: string; event: string }> }) {
  const ctx = await requireOrg((await params).org);
  const p = await params;
  const ev = await eventByKey(ctx.orgId, p.event);
  if (!ev) notFound();
  const v = await readEvent(ctx.orgId, ev.id, eventNow(new Date(), ev));
  const base = `/o/${ctx.slug}/events/${ev.eventKey}`;
  const orderOf = new Map(v.orders.map((o) => [o.order, o]));
  const late = v.payments.filter((x) => x.late);
  const l = v.ledger;

  return (
    <>
      <EventTabs base={base} current="ledger" />
      <main>
        <PageHeader
          eyebrow={`${v.event.name} · Stripe test mode, synthetic customers`}
          title="Ledger"
          status={<Pill k="info">Event clock {axis(v.asOf)}</Pill>}
          lead="Captured minus refunded equals net, to the cent. Every figure is a sum of stored payments and refunds, in integer cents; the CSV has the same lines as the table."
          actions={<LinkButton href={`${base}/ledger/csv`} variant="secondary">Download CSV</LinkButton>}
        />

        <Stats>
          <Stat label="Captured" value={<span data-testid="captured">{dollars(l.capturedCents)}</span>} sub={`${count(l.capturedCents)}¢ · ${count(l.orders)} orders and ${count(late.length)} late payment${late.length === 1 ? '' : 's'}`} />
          <Stat label="Refunded" value={<span data-testid="refunded">{dollars(l.refundedCents)}</span>} sub={`${count(l.refundedCents)}¢ · ${count(l.refunds)} refunds, ${count(late.length)} of them late money`} />
          <Stat label="Net" value={<span data-testid="net">{dollars(l.netCents)}</span>} k="good" sub={`✓ ${count(l.capturedCents)} − ${count(l.refundedCents)} = ${count(l.netCents)}¢`} />
        </Stats>
        <Stats>
          <Stat label="Tickets issued" value={count(l.ticketsIssued)} />
          <Stat label="Live" value={count(l.ticketsLive)} />
          <Stat label="Refunded" value={count(l.ticketsRefunded)} />
          <Stat label="Checked in" value={count(l.checkedIn)} />
        </Stats>

        <Section id="payments" title="Per payment" aside={<span className="muted">{count(v.payments.length)} lines</span>}>
          {v.payments.length === 0 ? <p>No payments captured yet.</p> : (
            <table>
              <caption className="hint">One line per captured payment; late money has no order</caption>
              <thead><tr><th scope="col">Order</th><th scope="col">Tickets</th><th scope="col">Customer</th><th scope="col" className="num">Captured</th><th scope="col" className="num">Refunded</th><th scope="col" className="num">Net</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {v.payments.map((x) => {
                  const o = x.order ? orderOf.get(x.order) : undefined;
                  const [k, word] = status(x, o);
                  return (
                    <tr key={x.payment} data-testid={`pay-${x.payment}`}>
                      <td>{x.order ?? <code>{x.payment}</code>}</td>
                      <td>{x.order ? <>{x.qty} × {x.tier}{o && o.seats.length > 0 && <> · {o.seats.join(', ')}</>}</> : <>No order · {x.qty} × {x.tier}</>}</td>
                      <td>{x.customer}</td>
                      <td className="num">{dollars(x.capturedCents)}</td><td className="num">{x.refundedCents ? dollars(x.refundedCents) : '—'}</td><td className="num">{dollars(x.netCents)}</td>
                      <td><Pill k={k}>{word}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Section>
      </main>
    </>
  );
}
