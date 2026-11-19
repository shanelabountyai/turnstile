import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eventNow } from '@/checkout/clock';
import { axis, count, day, refundWords, stamp, tierState, time } from '@/checkout/format';
import { dollars, eventByKey, percent, previewRefund, readEvent } from '@/checkout/read';
import { codeKind, sayCode } from '@/checkout/words';
import { requireOrg } from '@/core/authz/guards';
import { withOrg } from '@/core/db/rls';
import { ActionForm } from '@/core/ui/action-form';
import { EmptyState, EventTabs, Notice, PageHeader, Pill, Section, Stat, Stats } from '@/components/ui';
import type { Command } from '@/inventory/types';
import { holdTickets } from '../buy/actions';
import { confirmRefund } from './actions';

// Task 3.5, design pass (D-37, artboard docs/design/Box.dc.html): the box office. A window sale is the Buy screen's own
// HOLD action cast as the customer at the counter (the same castCommand, D-32), so it lands on Buy with the result;
// balcony seats are picked there. Waitlists are shown in FIFO order with the head marked and no control to skip it
// (non-negotiable 6); a refund is previewed by running the command on the engine in memory (previewRefund) before
// staff confirm the cast.

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
  const rules = v.event.rules;
  const refundable = v.orders.filter((o) => o.states.includes('ISSUED'));
  const order = v.orders.find((o) => o.order === q.order);
  const picked = order ? list(q.t).filter((t) => order.tickets.includes(t)) : [];
  const preview = order && picked.length > 0 && !result
    ? await previewRefund(ctx.orgId, ev.id, { cmd_id: 'PREVIEW', at, kind: 'REFUND_REQUEST', customer: order.customer, ref: order.order, tier_id: '', qty: 0, seats: [], payment_id: '', target: '', tickets: picked, note: 'preview' } satisfies Command)
    : null;
  const kindOf = new Map(v.pools.map((x) => [x.pool, x.kind]));
  const ga = v.tiers.filter((t) => kindOf.get(t.pool) === 'GA');
  const onSale = v.tiers.filter((t) => t.onSale);
  const poolLimited = ga.filter((t) => t.onSale && t.soldOut === 'SOLD_OUT_POOL' && t.remaining > 0);
  const poolOf = new Map(v.pools.map((x) => [x.pool, x]));
  const wl = v.ledger.waitlist;
  const customerSelect = (
    <label>Customer at the window{' '}
      <select name="customer" defaultValue="" required>
        <option value="" disabled>Pick one</option>
        {customers.map((c) => <option key={c.customerId} value={c.customerId}>{c.customerId} · {c.name}</option>)}
      </select>
    </label>
  );

  return (
    <>
      <EventTabs base={base} current="box" />
      <main>
        <PageHeader
          eyebrow={`Box office · ${day(v.asOf)} · ${time(v.asOf)}`}
          title="Window sales"
          status={<Pill k="info">Event clock {axis(v.asOf)}</Pill>}
          lead={<>The window sells against the same counts as the website. If the web can&rsquo;t sell it, neither can you. Times are the event clock ({v.event.timezoneLabel}); <Link href={`${base}#clock`}>change it on the event page</Link>.</>}
        />

        <Stats>
          {v.pools.map((x) => (
            <Stat key={x.pool} label={`${x.pool} available`} value={count(x.remaining)} k={x.remaining > 0 ? 'good' : 'risk'}
              sub={x.remaining > 0
                ? `✓ of ${count(x.capacity)}${x.kind !== 'GA' && rules.prevent_orphan_seats ? ' · single-seat rule applies' : ''}`
                : `✕ pool sold out · ${count(x.sold)} of ${count(x.capacity)} sold`} />
          ))}
          <Stat label="Waiting" value={count(v.waiting.parties)} k="hold" sub={`◆ parties, ${count(v.waiting.seats)} seats wanted`} />
          <Stat label="On sale now" value={count(onSale.length)} k="info" sub={onSale.length ? `● ${onSale.map((t) => `${t.tier} until ${time(t.offSaleAt)}`).join(' · ')}` : '■ no tier is on sale'} />
        </Stats>

        <div className="split">
          <Section id="sale" title="Sell at the window">
            {poolLimited.map((t) => {
              const pl = poolOf.get(t.pool)!;
              return (
                <Notice key={t.tier} k="risk" title={`${t.tier}: pool sold out (SOLD_OUT_POOL)`}>
                  {t.tier} shows {t.remaining} remaining because that is its own allotment. The {pl.pool} pool holds {pl.capacity} and has none left. {v.pools.some((x) => x.remaining > 0) ? 'Offer another pool instead.' : ''}
                </Notice>
              );
            })}
            <ActionForm action={holdTickets.bind(null, ctx.slug)}>
              <input type="hidden" name="event" value={ev.eventKey} />
              <div className="cluster" style={{ alignItems: 'flex-end' }}>
                {customerSelect}
                <label>Tier{' '}
                  <select name="tier" required>
                    {ga.map((t) => { const st = tierState(t, v.asOf); return <option key={t.tier} value={t.tier}>{t.tier} · {dollars(t.priceCents)} · {t.available} available{st.k === 'good' ? '' : ` · ${st.word.toLowerCase()}`}</option>; })}
                  </select>
                </label>
                <label>Quantity <input name="qty" type="number" min={1} max={rules.max_tickets_per_order} defaultValue={2} required /></label>
              </div>
              <button type="submit">Hold and take payment</button>
            </ActionForm>
            <p className="hint">The hold is cast as the customer and opens on the Buy screen, where it is paid; a refusal is shown there in words.</p>
            <form method="get" action={`${base}/buy`} className="cluster" style={{ alignItems: 'flex-end' }}>
              <label>Customer{' '}
                <select name="as" defaultValue="" required>
                  <option value="" disabled>Pick one</option>
                  {customers.map((c) => <option key={c.customerId} value={c.customerId}>{c.customerId} · {c.name}</option>)}
                </select>
              </label>
              <button type="submit" className="secondary">Pick balcony seats as this customer</button>
            </form>
          </Section>

          <Section id="refund" title="Refund a ticket">
            {result && (
              <Notice k={codeKind(result.status, result.code)} title={sayCode(result.code) ?? `${result.kind} → ${result.code}`}>
                <span className="muted" data-testid="result">{result.status} {result.code}{result.detail && ` · ${result.detail}`} · at {axis(result.at)}</span>
              </Notice>
            )}
            <form method="get" action={`${base}/box#refund`} className="cluster" style={{ alignItems: 'flex-end' }}>
              <label>Order{' '}
                <select name="order" defaultValue={order?.order ?? ''} required>
                  <option value="" disabled>Pick one</option>
                  {refundable.map((o) => <option key={o.order} value={o.order}>{o.order} · {o.customer} · {o.tier} × {o.qty}</option>)}
                </select>
              </label>
              <button type="submit" className="secondary">Open order</button>
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
                <button type="submit" className="secondary">Preview refund</button>
              </form>
            )}

            {order && preview && (
              <div className="stack" data-testid="preview">
                <dl>
                  <dt>Order</dt><dd>{order.order} · {order.customer} · {order.tier}</dd>
                  <dt>Paid</dt><dd>{dollars(order.grossCents)} for {order.qty}, fees included</dd>
                  <dt>When</dt><dd>{stamp(preview.result.at)} · {preview.daysBefore} days before the show</dd>
                  <dt>Window</dt><dd>{refundWords(preview.refundBps, preview.feeRefunded)}</dd>
                </dl>
                <p className="hint">As of {axis(preview.result.at)}: {preview.daysBefore} days before the start, so the window is {percent(preview.refundBps)} of the price{preview.feeRefunded ? ' plus the fee' : ', fee kept'}.</p>
                {preview.result.status === 'REJECT' ? (
                  <Notice k="risk" title={sayCode(preview.result.code) ?? preview.result.code}><span data-testid="preview-code">{preview.result.code}{preview.result.detail && ` · ${preview.result.detail}`}</span></Notice>
                ) : (
                  <>
                    <div className="receipt stack" style={{ gap: 'var(--s-1)' }}>
                      <span className="eyebrow">Customer gets back</span>
                      <span className="fig-lg" data-testid="preview-total">{dollars(preview.totalCents)}</span>
                      <span className="hint">Price × {percent(preview.refundBps)} per ticket, rounded down to the cent{preview.feeRefunded ? ', plus the fee' : ''}. The seat goes back to its pool.</span>
                    </div>
                    <table>
                      <caption>Refund for {order.order}</caption>
                      <thead><tr><th scope="col">Ticket</th><th scope="col" className="num">Price</th><th scope="col" className="num">Fee</th><th scope="col" className="num">Refund</th></tr></thead>
                      <tbody>{preview.lines.map((l) => <tr key={l.ticket}><td>{l.ticket}{l.seat && ` · ${l.seat}`}</td><td className="num">{dollars(l.priceCents)}</td><td className="num">{dollars(l.feeCents)}</td><td className="num">{dollars(l.amountCents)}</td></tr>)}</tbody>
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
        </div>

        <Section id="waitlist" title="Waitlists">
          {v.waitlists.length === 0 ? <EmptyState>Nobody is waiting.</EmptyState> : (
            <>
              <table>
                <caption className="hint">Each line in FIFO order; the first in line blocks it until their group fits</caption>
                <thead><tr><th scope="col">Waiting for</th><th scope="col" className="num">Parties</th><th scope="col" className="num">Seats wanted</th><th scope="col">First in line</th></tr></thead>
                <tbody>
                  {v.waitlists.map((w) => (
                    <tr key={w.target}>
                      <td>{w.target}</td><td className="num">{w.waiting.length}</td><td className="num">{w.seatsWanted}</td>
                      <td>{w.waiting[0] ? <>{w.waiting[0].entry} · wants {w.waiting[0].qty} · <span className="muted">blocks the line until {w.waiting[0].qty} fit</span></> : w.offered.length ? <Pill k="hold">offer out</Pill> : 'Nobody waiting'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {v.waitlists.map((w) => (
                <table key={w.target} data-testid={`waitlist-${w.target}`}>
                  <caption>{w.target}: {w.waiting.length} waiting{w.offered.length > 0 && `, ${w.offered.length} offered`}</caption>
                  <thead><tr><th scope="col">Position</th><th scope="col">Entry</th><th scope="col">Customer</th><th scope="col" className="num">Qty</th><th scope="col">Since</th></tr></thead>
                  <tbody>
                    {w.offered.map((x) => (
                      <tr key={x.entry} data-testid={`entry-${x.entry}`}><td><Pill k="hold">offered</Pill></td><td>{x.entry}</td><td>{x.customer}</td><td className="num">{x.qty}</td><td>offer {x.offer} until {axis(x.expiresAt)}</td></tr>
                    ))}
                    {w.waiting.map((x) => (
                      <tr key={x.entry} data-testid={`entry-${x.entry}`}><td>{x.position}{x.position === 1 && <> <Pill k="info">head</Pill></>}</td><td>{x.entry}</td><td>{x.customer}</td><td className="num">{x.qty}</td><td>{axis(x.joinedAt)}</td></tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </>
          )}
          <p className="hint">
            Over the event: {count(v.ledger.offersMade)} offers made, {count(wl.FULFILLED ?? 0)} fulfilled, {count(wl.OFFER_EXPIRED ?? 0)} expired unanswered.
            {' '}{count(wl.CLOSED_OFF_SALE ?? 0)} entries closed when their tier went off sale. There is no skip: if the head&rsquo;s group does not fit, nobody behind it is offered instead.
          </p>
        </Section>
      </main>
    </>
  );
}
