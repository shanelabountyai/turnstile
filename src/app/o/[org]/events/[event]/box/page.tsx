import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eventNow } from '@/checkout/clock';
import { dollars, eventByKey, percent, previewRefund, readEvent } from '@/checkout/read';
import { requireOrg } from '@/core/authz/guards';
import { withOrg } from '@/core/db/rls';
import { ActionForm } from '@/core/ui/action-form';
import { EmptyState, Notice, PageHeader, Pill, Section } from '@/components/ui';
import type { Command } from '@/inventory/types';
import { confirmRefund } from './actions';

// Task 3.5: the box office. Window sales go through the Buy screen acting as the customer (the same castCommand, D-32);
// waitlists are shown in FIFO order with the head marked and no control to skip it (non-negotiable 6); a refund is
// previewed by running the command on the engine in memory (previewRefund) before staff confirm the cast.

const when = (t: string) => t.replace('T', ' ');
const list = (x: string | string[] | undefined) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

export default async function BoxOffice({ params, searchParams }: { params: Promise<{ org: string; event: string }>; searchParams: Promise<{ order?: string; t?: string | string[]; r?: string }> }) {
  const ctx = await requireOrg((await params).org);
  const p = await params;
  const q = await searchParams;
  const ev = await eventByKey(ctx.orgId, p.event);
  if (!ev) notFound();
  const at = eventNow(new Date(), ev);
  const v = await readEvent(ctx.orgId, ev.id, at);
  const { customers, result } = await withOrg(ctx, async (tx) => ({
    customers: await tx.customer.findMany({ where: { orgId: ctx.orgId }, orderBy: { customerId: 'asc' }, select: { customerId: true, name: true } }),
    result: q.r ? await tx.commandLog.findUnique({ where: { eventId_cmdId: { eventId: ev.id, cmdId: q.r } }, select: { kind: true, status: true, code: true, detail: true, at: true } }) : null,
  }), { atomic: false });
  const base = `/o/${ctx.slug}/events/${ev.eventKey}`;
  const refundable = v.orders.filter((o) => o.states.includes('ISSUED'));
  const order = v.orders.find((o) => o.order === q.order);
  const picked = order ? list(q.t).filter((t) => order.tickets.includes(t)) : [];
  const preview = order && picked.length > 0 && !result
    ? await previewRefund(ctx.orgId, ev.id, { cmd_id: 'PREVIEW', at, kind: 'REFUND_REQUEST', customer: order.customer, ref: order.order, tier_id: '', qty: 0, seats: [], payment_id: '', target: '', tickets: picked, note: 'preview' } satisfies Command)
    : null;

  return (
    <main>
      <PageHeader
        eyebrow={v.event.name}
        title="Box office"
        status={<Pill k="info">Event clock {when(v.asOf)}</Pill>}
        lead={<>Times are the event clock ({v.event.timezoneLabel}); <Link href={`${base}#clock`}>change it on the event page</Link>.</>}
      />

      <Section id="sale" title="Window sale">
        <form method="get" action={`${base}/buy`} className="cluster">
          <label>Customer{' '}
            <select name="as" defaultValue="" required>
              <option value="" disabled>Pick one</option>
              {customers.map((c) => <option key={c.customerId} value={c.customerId}>{c.customerId} · {c.name}</option>)}
            </select>
          </label>
          <button type="submit">Sell as this customer</button>
        </form>
        <p className="hint">A window sale is the same hold and payment the web uses, cast as the customer at the counter.</p>
      </Section>

      <Section id="waitlist" title="Waitlists">
        {v.waitlists.length === 0 ? <EmptyState>Nobody is waiting.</EmptyState> : v.waitlists.map((w) => (
          <table key={w.target} data-testid={`waitlist-${w.target}`}>
            <caption>{w.target}: {w.waiting.length} waiting{w.offered.length > 0 && `, ${w.offered.length} offered`}</caption>
            <thead><tr><th scope="col">Position</th><th scope="col">Entry</th><th scope="col">Customer</th><th scope="col">Qty</th><th scope="col">Since</th></tr></thead>
            <tbody>
              {w.offered.map((x) => (
                <tr key={x.entry} data-testid={`entry-${x.entry}`}><td><Pill k="hold">offered</Pill></td><td>{x.entry}</td><td>{x.customer}</td><td>{x.qty}</td><td>offer {x.offer} until {when(x.expiresAt)}</td></tr>
              ))}
              {w.waiting.map((x) => (
                <tr key={x.entry} data-testid={`entry-${x.entry}`}><td>{x.position}{x.position === 1 && <> <Pill k="info">head</Pill></>}</td><td>{x.entry}</td><td>{x.customer}</td><td>{x.qty}</td><td>{when(x.joinedAt)}</td></tr>
              ))}
            </tbody>
          </table>
        ))}
        <p className="hint">First in line by join time is offered first. If the head&rsquo;s quantity does not fit, nobody behind it is offered instead; there is no skip.</p>
      </Section>

      <Section id="refund" title="Refund">
        {result && (
          <Notice k={result.status === 'OK' ? 'good' : 'risk'} title={`${result.kind} → ${result.code}`}>
            <span data-testid="result">{result.status} {result.code}{result.detail && ` · ${result.detail}`} · at {when(result.at)}</span>
          </Notice>
        )}
        <form method="get" action={`${base}/box#refund`} className="cluster">
          <label>Order{' '}
            <select name="order" defaultValue={order?.order ?? ''} required>
              <option value="" disabled>Pick one</option>
              {refundable.map((o) => <option key={o.order} value={o.order}>{o.order} · {o.customer} · {o.tier} × {o.qty}</option>)}
            </select>
          </label>
          <button type="submit">Open order</button>
        </form>

        {order && (
          <form method="get" action={`${base}/box#refund`} className="stack">
            <input type="hidden" name="order" value={order.order} />
            <fieldset>
              <legend>{order.order} · {order.customer} · paid {dollars(order.grossCents)}</legend>
              {order.tickets.map((t, i) => (
                <label key={t} className="choice">
                  <input type="checkbox" name="t" value={t} defaultChecked={picked.includes(t)} disabled={order.states[i] !== 'ISSUED'} />
                  {t}{order.seats[i] && ` · ${order.seats[i]}`} · {order.states[i]}
                </label>
              ))}
            </fieldset>
            <button type="submit">Preview refund</button>
          </form>
        )}

        {order && preview && (
          <div className="stack" data-testid="preview">
            <p>As of {when(preview.result.at)}: {preview.daysBefore} days before the start, so the window is {percent(preview.refundBps)} of the price{preview.feeRefunded ? ' plus the fee' : ', fee kept'}.</p>
            {preview.result.status === 'REJECT' ? (
              <Notice k="risk" title={preview.result.code}><span data-testid="preview-code">{preview.result.code}{preview.result.detail && ` · ${preview.result.detail}`}</span></Notice>
            ) : (
              <>
                <table>
                  <caption>Refund for {order.order}</caption>
                  <thead><tr><th scope="col">Ticket</th><th scope="col">Price</th><th scope="col">Fee</th><th scope="col">Refund</th></tr></thead>
                  <tbody>{preview.lines.map((l) => <tr key={l.ticket}><td>{l.ticket}{l.seat && ` · ${l.seat}`}</td><td>{dollars(l.priceCents)}</td><td>{dollars(l.feeCents)}</td><td>{dollars(l.amountCents)}</td></tr>)}</tbody>
                  <tfoot><tr><th scope="row" colSpan={3}>Total</th><td data-testid="preview-total">{dollars(preview.totalCents)}</td></tr></tfoot>
                </table>
                <ActionForm action={confirmRefund.bind(null, ctx.slug)}>
                  <input type="hidden" name="event" value={ev.eventKey} />
                  <input type="hidden" name="order" value={order.order} />
                  {picked.map((t) => <input key={t} type="hidden" name="tickets[]" value={t} />)}
                  <button type="submit">Refund {dollars(preview.totalCents)}</button>
                </ActionForm>
              </>
            )}
          </div>
        )}
      </Section>
    </main>
  );
}
