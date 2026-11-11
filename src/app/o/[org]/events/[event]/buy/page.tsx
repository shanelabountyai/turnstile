import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eventNow } from '@/checkout/clock';
import { stripePublishableKey } from '@/checkout/env';
import { dollars, eventByKey, readEvent } from '@/checkout/read';
import { stripeGateway } from '@/checkout/stripe';
import { requireOrg } from '@/core/authz/guards';
import { withOrg } from '@/core/db/rls';
import { env } from '@/core/env';
import { ActionForm } from '@/core/ui/action-form';
import { Countdown } from '@/components/countdown';
import { StripePay } from '@/components/stripe-pay';
import { EmptyState, Notice, PageHeader, Pill, Section } from '@/components/ui';
import { holdTickets, joinWaitlist, leaveWaitlist, payHold, releaseHold } from './actions';

// Task 3.4: buy as a chosen fixture customer (D-32), on the event clock (D-35). Every number is the read model's
// (D-31); every button casts one command and the result is read back from the CommandLog by cmd_id, so a rejected
// command shows its code. Countdowns are display-only; the server decides expiry (D-34).

const when = (t: string) => t.replace('T', ' ');
// The code the engine gives a command against a hold that has ended this way (requireHeld); other states read as themselves.
const ENDED: Record<string, string> = { EXPIRED: 'HOLD_EXPIRED', RELEASED: 'HOLD_RELEASED' };

export default async function BuyScreen({ params, searchParams }: { params: Promise<{ org: string; event: string }>; searchParams: Promise<{ as?: string; r?: string }> }) {
  const ctx = await requireOrg((await params).org);
  const p = await params;
  const q = await searchParams;
  const ev = await eventByKey(ctx.orgId, p.event);
  if (!ev) notFound();
  const v = await readEvent(ctx.orgId, ev.id, eventNow(new Date(), ev));
  const { customers, result } = await withOrg(ctx, async (tx) => ({
    customers: await tx.customer.findMany({ where: { orgId: ctx.orgId }, orderBy: { customerId: 'asc' }, select: { customerId: true, name: true } }),
    result: q.r ? await tx.commandLog.findUnique({ where: { eventId_cmdId: { eventId: ev.id, cmdId: q.r } }, select: { kind: true, status: true, code: true, detail: true, at: true } }) : null,
  }), { atomic: false });
  const me = customers.find((c) => c.customerId === q.as);
  const slug = ctx.slug;
  const self = `/o/${slug}/events/${ev.eventKey}/buy${me ? `?as=${me.customerId}` : ''}`;
  const pk = stripePublishableKey();
  const stripe = stripeGateway();

  const holds = me ? v.holds.filter((h) => h.customer === me.customerId) : [];
  const live = holds.filter((h) => h.state === 'HELD' || h.state === 'PAYING');
  const ended = holds.filter((h) => h.state !== 'HELD' && h.state !== 'PAYING' && h.state !== 'CONFIRMED');
  const orders = me ? v.orders.filter((o) => o.customer === me.customerId) : [];
  const lists = me ? v.waitlists.map((w) => ({ target: w.target, waiting: w.waiting.filter((x) => x.customer === me.customerId), offered: w.offered.filter((x) => x.customer === me.customerId) })).filter((w) => w.waiting.length || w.offered.length) : [];
  const ga = v.tiers.filter((t) => v.pools.find((x) => x.pool === t.pool)?.kind === 'GA');
  const tierOfPool = new Map(v.tiers.map((t) => [t.pool, t.tier]));
  const secrets = new Map(await Promise.all(live.filter((h) => h.state === 'PAYING' && h.paymentId && pk).map(async (h) => [h.hold, await stripe.clientSecret(h.paymentId!)] as const)));
  const hidden = me && <><input type="hidden" name="event" value={ev.eventKey} /><input type="hidden" name="customer" value={me.customerId} /></>;

  return (
    <main>
      <PageHeader
        eyebrow={v.event.name}
        title={me ? <>Buy · acting as {me.customerId}</> : 'Buy'}
        status={<Pill k="info">Event clock {when(v.asOf)}</Pill>}
        lead={<>Staff act as a synthetic customer; there is no public sign-up. Times are the event clock ({v.event.timezoneLabel}); <Link href={`/o/${slug}/events/${ev.eventKey}#clock`}>change it on the event page</Link>.</>}
      />

      {result && (
        <Notice k={result.status === 'OK' ? 'good' : 'risk'} title={`${result.kind} → ${result.code}`}>
          <span data-testid="result">{result.status} {result.code}{result.detail && ` · ${result.detail}`} · at {when(result.at)}</span>
        </Notice>
      )}

      <Section id="as" title="Acting as">
        <form method="get" className="cluster">
          <label>Customer{' '}
            <select name="as" defaultValue={me?.customerId ?? ''} required>
              <option value="" disabled>Pick one</option>
              {customers.map((c) => <option key={c.customerId} value={c.customerId}>{c.customerId} · {c.name}</option>)}
            </select>
          </label>
          <button type="submit">Act as</button>
        </form>
      </Section>

      {me && hidden && (
        <>
          <Section id="holds" title="Holds">
            {live.length === 0 && ended.length === 0 ? <EmptyState>No holds for {me.customerId}.</EmptyState> : (
              <ul className="stack">
                {live.map((h) => (
                  <li key={h.hold} data-testid={`hold-${h.hold}`} className="stack">
                    <p className="cluster">
                      <strong>{h.kind === 'OFFER' ? 'Waitlist offer' : 'Hold'} {h.hold}</strong>
                      <Pill k="hold">{h.state}</Pill>
                      <span>{h.tier} · {h.seats.length ? h.seats.join(' ') : `${h.qty} ticket${h.qty === 1 ? '' : 's'}`} · {dollars(h.amountCents)} incl. fees</span>
                    </p>
                    {h.secondsLeft !== null && (
                      <p className="muted">{h.state === 'HELD' ? 'Cart hold ends' : 'Payment times out'} at {when(h.deadline!)} · <Countdown key={h.deadline} seconds={h.secondsLeft} label={`time left on ${h.hold}`} /></p>
                    )}
                    {h.state === 'HELD' && (
                      <div className="cluster">
                        <ActionForm action={payHold.bind(null, slug)}>{hidden}<input type="hidden" name="hold" value={h.hold} /><button type="submit">Pay</button></ActionForm>
                        <ActionForm action={releaseHold.bind(null, slug)}>{hidden}<input type="hidden" name="hold" value={h.hold} /><button type="submit" className="button" data-variant="secondary">{h.kind === 'OFFER' ? 'Decline offer' : 'Release'}</button></ActionForm>
                      </div>
                    )}
                    {h.state === 'PAYING' && (secrets.get(h.hold)
                      ? <StripePay publishableKey={pk!} clientSecret={secrets.get(h.hold)!} returnUrl={`${env.APP_URL}${self}`} />
                      : <p className="hint" data-testid="paying">PaymentIntent {h.paymentId}. {pk ? 'Stripe returned no client secret.' : 'Recorded Stripe (no publishable key here): the tickets are issued when the signed webhook arrives.'} Refresh to see it land.</p>)}
                  </li>
                ))}
                {ended.map((h) => (
                  <li key={h.hold} data-testid={`hold-${h.hold}`} className="cluster">
                    <strong>{h.kind === 'OFFER' ? 'Offer' : 'Hold'} {h.hold}</strong>
                    <Pill k="done">{ENDED[h.state] ?? h.state}</Pill>
                    <span className="muted">{h.tier} · {h.seats.length ? h.seats.join(' ') : h.qty}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="orders" title="Tickets">
            {orders.length === 0 ? <EmptyState>No orders for {me.customerId} yet.</EmptyState> : (
              <table>
                <caption>Orders for {me.customerId}</caption>
                <thead><tr><th scope="col">Order</th><th scope="col">Tier</th><th scope="col">Tickets and codes</th><th scope="col">Paid</th></tr></thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.order} data-testid={`order-${o.order}`}>
                      <td>{o.order}{o.viaOffer && ' (waitlist)'}</td>
                      <td>{o.tier}</td>
                      <td><ul>{o.tickets.map((t, i) => <li key={t}>{t}{o.seats[i] && ` · ${o.seats[i]}`} · <code>{o.codes[i]}</code></li>)}</ul></td>
                      <td>{dollars(o.grossCents)}{o.refundedCents > 0 && <> · {dollars(o.refundedCents)} refunded</>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section id="ga" title="General admission">
            <ActionForm action={holdTickets.bind(null, slug)}>
              {hidden}
              <div className="cluster">
                <label>Tier{' '}
                  <select name="tier" required>
                    {ga.map((t) => <option key={t.tier} value={t.tier}>{t.tier} · {dollars(t.priceCents)} · {t.available} available{t.onSale ? '' : ' · off sale'}</option>)}
                  </select>
                </label>
                <label>Quantity <input name="qty" type="number" min={1} max={v.event.rules.max_tickets_per_order} defaultValue={1} required /></label>
                <button type="submit">Hold tickets</button>
              </div>
            </ActionForm>
            <p className="hint">Up to {v.event.rules.max_tickets_per_order} per order. A hold lasts {v.event.rules.hold_ttl_minutes} min; paying gives Stripe {v.event.rules.payment_timeout_minutes} min.</p>
          </Section>

          <Section id="seats" title="Reserved seats">
            <p className="hint">Rows read left to right. A pick that would leave one open seat between taken ones is refused as ORPHAN_SEAT before checkout.</p>
            {v.sections.map((s) => (
              <ActionForm key={s.section} action={holdTickets.bind(null, slug)}>
                {hidden}
                <input type="hidden" name="tier" value={tierOfPool.get(s.pool)} />
                <fieldset>
                  <legend>Section {s.section}</legend>
                  {s.rows.map((r) => (
                    <div key={r.row} className="cluster" role="group" aria-label={`Section ${s.section} row ${r.row}`}>
                      <span>Row {r.row}</span>
                      {r.seats.map((st) => (
                        <label key={st.seat} className="choice" title={`${st.seat} ${st.state}`}>
                          <input type="checkbox" name="seats[]" value={st.seat} disabled={st.state !== 'OPEN'} aria-label={`${st.seat} ${st.state.toLowerCase()}`} />
                          {st.num}
                        </label>
                      ))}
                    </div>
                  ))}
                  <button type="submit">Hold seats in {s.section}</button>
                </fieldset>
              </ActionForm>
            ))}
          </Section>

          <Section id="waitlist" title="Waitlist">
            {lists.length > 0 && (
              <ul className="stack">
                {lists.map((w) => (
                  <li key={w.target}>
                    {w.waiting.map((x) => (
                      <div key={x.entry} className="cluster" data-testid={`entry-${x.entry}`}>
                        <span>{x.entry} · {w.target} × {x.qty} · position {x.position}{x.position === 1 && ' (next to be offered)'}</span>
                        <ActionForm action={leaveWaitlist.bind(null, slug)}>{hidden}<input type="hidden" name="entry" value={x.entry} /><button type="submit">Leave</button></ActionForm>
                      </div>
                    ))}
                    {w.offered.map((x) => <p key={x.entry} data-testid={`entry-${x.entry}`}>{x.entry} · {w.target}: offered as {x.offer} until {when(x.expiresAt)}. Pay or decline it under Holds.</p>)}
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={joinWaitlist.bind(null, slug)}>
              {hidden}
              <div className="cluster">
                <label>For{' '}
                  <select name="target" required>
                    {ga.map((t) => <option key={t.tier} value={t.tier}>tier {t.tier}</option>)}
                    {v.sections.map((s) => <option key={s.section} value={s.section}>section {s.section}</option>)}
                  </select>
                </label>
                <label>Quantity <input name="qty" type="number" min={1} max={v.event.rules.max_tickets_per_order} defaultValue={1} required /></label>
                <button type="submit">Join waitlist</button>
              </div>
            </ActionForm>
            <p className="hint">First in line is offered first and nobody is skipped. An offer is a hold for {v.event.rules.offer_ttl_minutes} min; an ignored one is dropped and the next in line is offered.</p>
          </Section>
        </>
      )}
    </main>
  );
}
