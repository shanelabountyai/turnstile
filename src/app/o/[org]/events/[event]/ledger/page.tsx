import { notFound } from 'next/navigation';
import { eventNow } from '@/checkout/clock';
import { axis, count, pageOf } from '@/checkout/format';
import { dollars, eventByKey, readEvent, type EventView } from '@/checkout/read';
import { requireOrg } from '@/core/authz/guards';
import Link from 'next/link';
import { EventTabs, LinkButton, PageHeader, Pill, ScrollTable, Section, Stat, Stats, type PillKind } from '@/components/ui';

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

export const metadata = { title: 'Ledger · Turnstile' };

export default async function Ledger({ params, searchParams }: { params: Promise<{ org: string; event: string }>; searchParams: Promise<{ page?: string }> }) {
  const ctx = await requireOrg((await params).org);
  const p = await params;
  const ev = await eventByKey(ctx.orgId, p.event);
  if (!ev) notFound();
  const v = await readEvent(ctx.orgId, ev.id, eventNow(new Date(), ev));
  const base = `/o/${ctx.slug}/events/${ev.eventKey}`;
  const orderOf = new Map(v.orders.map((o) => [o.order, o]));
  const late = v.payments.filter((x) => x.late);
  const l = v.ledger;
  const pg = pageOf(v.payments, Number.parseInt((await searchParams).page ?? '1', 10), 50);
  const pager = (where: string) => pg.pages > 1 && (
    <nav aria-label={`Ledger pages, ${where}`} className="cluster">
      {pg.page > 1 && <Link className="button secondary" href={`${base}/ledger?page=${pg.page - 1}#payments`}>Previous 50</Link>}
      <span className="muted">Lines {pg.from}–{pg.to} of {count(pg.total)} · page {pg.page} of {pg.pages}</span>
      {pg.page < pg.pages && <Link className="button secondary" href={`${base}/ledger?page=${pg.page + 1}#payments`}>Next 50</Link>}
    </nav>
  );

  const row = (x: Line) => {
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
  };
  const head = <thead><tr><th scope="col">Order</th><th scope="col">Tickets</th><th scope="col">Customer</th><th scope="col" className="num">Captured</th><th scope="col" className="num">Refunded</th><th scope="col" className="num">Net</th><th scope="col">Status</th></tr></thead>;

  return (
    <>
      <EventTabs base={base} current="ledger" />
      <main id="main">
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
            <>
              {late.length > 0 && (
                <ScrollTable label="Late money">
                  <caption>Late money: paid after the hold ended or the event was cancelled, refunded in full</caption>
                  {head}
                  <tbody>{late.map(row)}</tbody>
                </ScrollTable>
              )}
              {pager('top')}
              <ScrollTable label="Ledger lines">
                <caption className="hint">One line per captured payment, in payment order; the CSV has every line</caption>
                {head}
                <tbody>{pg.rows.map(row)}</tbody>
              </ScrollTable>
              {pager('bottom')}
            </>
          )}
        </Section>
      </main>
    </>
  );
}
